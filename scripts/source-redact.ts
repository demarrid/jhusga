/**
 * Redacted copies of source files, served as a document's "view source".
 *
 *   node --import tsx scripts/source-redact.ts --document ID [--document ID ...]
 *   node --import tsx scripts/source-redact.ts --flagged
 *       Build a copy and preview pages for review. Nothing is stored.
 *   ... --upload
 *       Also store each copy that passed its checks, as "pending".
 *   node --import tsx scripts/source-redact.ts --approve ID
 *       Serve a stored copy, after a person has looked at every preview page.
 *   node --import tsx scripts/source-redact.ts --withdraw ID
 *       Stop serving it; the page withholds the original again.
 *
 * `--flagged` is every document whose stored text the personal-data filter
 * changed (it carries a "[REDACTED: ...]" placeholder), News-Letter articles
 * aside. Until an approved copy exists the document page withholds the Drive
 * link for these, so the original is not one click away.
 *
 * For each document: download the source file(s) (or use .archive-local/
 * originals), join them into one PDF, find personal data on every page with the
 * text layer and local OCR, black it out (lib/source-redaction.ts decides
 * where), flatten every page to an image, then OCR the result again. A copy
 * whose re-read still finds an SSN, address or phone, or that found nothing to
 * cover in a document whose text needed redacting, is not stored: add boxes to
 * config/source-redactions.json and run it again.
 *
 * Work files and previews stay in .archive-local/redacted/<document id>/,
 * outside Git. The report printed and kept there has counts and pages, never
 * the values covered.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { hasRedactions } from "../lib/archive-redaction";
import { planRedactions, remainingFindings, sourceFileIds, type ManualRedactions, type SourcePage } from "../lib/source-redaction";

process.loadEnvFile(".env");

const WORK = path.join(".archive-local", "redacted");
const ORIGINALS = path.join(".archive-local", "originals");
const MANUAL = path.join("config", "source-redactions.json");
/** Under Vercel's 4.5 MB response cap, so the route can send the copy whole. */
const MAX_BYTES = 4 * 1024 * 1024;
const RENDERINGS = [{ dpi: 150, quality: 75 }, { dpi: 120, quality: 65 }, { dpi: 96, quality: 55 }, { dpi: 72, quality: 50 }];
const PYTHON = process.env.PYTHON ?? "python3";
const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");

function py<T>(...args: string[]): T {
    const run = spawnSync(PYTHON, ["scripts/source-redact.py", ...args], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
    if (run.status !== 0) throw new Error(`source-redact.py ${args[0]}: ${run.stderr.trim().split("\n").at(-1) ?? "failed"}`);
    return JSON.parse(run.stdout.trim().split("\n").at(-1)!) as T;
}

function argValues(flag: string): string[] {
    return process.argv.flatMap((value, i) => process.argv[i - 1] === flag ? [value] : []);
}

type Doc = { id: string; title: string; driveFileId: string; mimeType: string; content: string };
type Built = { bytes: Uint8Array<ArrayBuffer>; sourceIds: string[]; sourceSha256: string; pageCount: number; redactions: unknown; report: Record<string, unknown> };

async function fetchSources(doc: Doc, dir: string): Promise<{ inputs: string[]; ids: string[]; hash: string }> {
    const { getFile, downloadSourceFile } = await import("../lib/drive");
    const ids = sourceFileIds(doc.content, doc.driveFileId);
    if (!ids.length) throw new Error("No Drive source file to copy");
    const inputs: string[] = [];
    const hash = createHash("sha256");
    for (const [index, id] of ids.entries()) {
        const local = path.join(ORIGINALS, id);
        let file = local;
        let mime = "";
        if (!existsSync(local)) {
            const meta = id === doc.driveFileId ? { mimeType: doc.mimeType } : await getFile(id);
            if (!meta) throw new Error(`Drive will not serve source ${index + 1}`);
            const fetched = await downloadSourceFile(id, meta.mimeType);
            if (!fetched) throw new Error(`Drive will not serve source ${index + 1}`);
            if (!/^application\/pdf$|^image\//.test(fetched.mimeType)) throw new Error(`Unsupported source type ${fetched.mimeType}`);
            file = path.join(dir, `source-${index + 1}`);
            await writeFile(file, fetched.bytes);
            mime = fetched.mimeType;
        }
        hash.update(await readFile(file));
        inputs.push(mime ? `${file}:${mime}` : file);
    }
    return { inputs, ids, hash: hash.digest("hex") };
}

async function build(doc: Doc, manual: ManualRedactions | undefined): Promise<Built> {
    const dir = path.join(WORK, doc.id);
    await mkdir(dir, { recursive: true });
    const { inputs, ids, hash } = await fetchSources(doc, dir);
    const source = path.join(dir, "source.pdf");
    // OCR is most of the run; reuse it while the sources are unchanged.
    const stamp = path.join(dir, "lines.sha256");
    if (!existsSync(stamp) || (await readFile(stamp, "utf8")) !== hash || !existsSync(path.join(dir, "lines.json"))) {
        py("normalize", source, ...inputs);
        py("lines", source, path.join(dir, "lines.json"));
        await writeFile(stamp, hash);
    }
    const pages = (JSON.parse(await readFile(path.join(dir, "lines.json"), "utf8")) as { pages: SourcePage[] }).pages;
    const boxes = planRedactions(pages, manual);

    const out = path.join(dir, "redacted.pdf");
    const preview = path.join(dir, "preview");
    type Applied = { pages: number; bytes: number; textLayer: number };
    let rendered: Applied | null = null;
    for (const rendering of RENDERINGS) {
        await writeFile(path.join(dir, "plan.json"), JSON.stringify({ ...rendering, boxes }));
        const result = py<Applied>("apply", source, path.join(dir, "plan.json"), out, preview);
        rendered = result;
        if (result.bytes <= MAX_BYTES) break;
    }
    if (!rendered) throw new Error("Nothing rendered");
    const applied = rendered;

    // Read the finished copy back exactly as a stranger would: OCR every page.
    py("lines", out, path.join(dir, "check.json"), "--ocr-all");
    const remaining = remainingFindings((JSON.parse(await readFile(path.join(dir, "check.json"), "utf8")) as { pages: SourcePage[] }).pages);

    const count = (key: "kind" | "method") => boxes.reduce<Record<string, number>>((all, box) => ({ ...all, [box[key]]: (all[box[key]] ?? 0) + 1 }), {});
    const problems = [
        ...(applied.bytes > MAX_BYTES ? [`copy is ${applied.bytes} bytes, over the ${MAX_BYTES} byte limit`] : []),
        ...(applied.textLayer ? ["copy still has a text layer"] : []),
        ...(remaining.length ? [`re-read still finds ${remaining.map(r => `${r.kind} on page ${r.page}`).join(", ")}`] : []),
        ...(hasRedactions(doc.content) && boxes.length === 0 ? ["the stored text needed redacting but no box was placed; add boxes in " + MANUAL] : []),
    ];
    const report = {
        documentId: doc.id, title: doc.title, sources: ids.length, pages: applied.pages, bytes: applied.bytes,
        textRedactions: (doc.content.match(/\[REDACTED: /g) ?? []).length,
        boxes: boxes.length, byKind: count("kind"), byMethod: count("method"),
        pagesWithBoxes: [...new Set(boxes.map(b => b.page + 1))].sort((a, b) => a - b),
        manual: Boolean(manual), problems, preview: path.resolve(preview),
    };
    await writeFile(path.join(dir, "report.json"), JSON.stringify(report, null, 2));
    return {
        bytes: Uint8Array.from(await readFile(out)), sourceIds: ids, sourceSha256: hash, pageCount: applied.pages, report,
        redactions: boxes.map(({ page, kind, method }) => ({ page: page + 1, kind, method })),
    };
}

async function main() {
    const { prisma } = await import("../lib/prisma");
    try {
        for (const [flag, status] of [["--approve", "approved"], ["--withdraw", "pending"]] as const) {
            for (const id of argValues(flag)) {
                const updated = await prisma.documentRedactedSource.updateMany({ where: { documentId: id },
                    data: { status, approvedAt: status === "approved" ? new Date() : null } });
                console.log(JSON.stringify({ documentId: id, status: updated.count ? status : "no stored copy" }));
            }
        }

        const ids = argValues("--document");
        const select = { id: true, title: true, driveFileId: true, mimeType: true, content: true } as const;
        const docs: Doc[] = ids.length
            ? await prisma.document.findMany({ where: { id: { in: ids } }, select })
            : process.argv.includes("--flagged")
                ? (await prisma.document.findMany({ where: { discoveredVia: { not: "newsletter" }, content: { contains: "[REDACTED: " } }, select }))
                : [];
        if (!docs.length && !argValues("--approve").length && !argValues("--withdraw").length) {
            throw new Error("Usage: source-redact.ts (--document ID ... | --flagged) [--upload] | --approve ID | --withdraw ID");
        }

        const manual = existsSync(MANUAL) ? JSON.parse(await readFile(MANUAL, "utf8")) as Record<string, ManualRedactions> : {};
        const upload = process.argv.includes("--upload");
        for (const doc of docs) {
            try {
                const built = await build(doc, manual[doc.id]);
                const problems = built.report.problems as string[];
                let stored = "not stored (dry run)";
                if (problems.length) stored = "not stored: needs review";
                else if (upload) {
                    const data = { fileName: `${doc.title.replace(/[^\w .()-]+/g, " ").trim().slice(0, 120) || "source"} (redacted).pdf`,
                        mimeType: "application/pdf", bytes: built.bytes, sha256: sha(built.bytes), sourceFileIds: built.sourceIds,
                        sourceSha256: built.sourceSha256, redactions: built.redactions as object, pageCount: built.pageCount,
                        status: "pending", approvedAt: null };
                    await prisma.documentRedactedSource.upsert({ where: { documentId: doc.id }, create: { documentId: doc.id, ...data }, update: data });
                    stored = "stored as pending: review the preview, then --approve " + doc.id;
                }
                console.log(JSON.stringify({ ...built.report, stored }));
            } catch (error) {
                console.log(JSON.stringify({ documentId: doc.id, title: doc.title, error: error instanceof Error ? error.message : String(error) }));
                process.exitCode = 1;
            }
        }
    } finally {
        await prisma.$disconnect();
    }
}

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
