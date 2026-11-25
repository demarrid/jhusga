import path from "node:path";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, appendFile, rm } from "node:fs/promises";
import { prisma } from "../lib/prisma";
import { generateJson } from "../lib/ai";
import { SECONDARY_KINDS } from "../lib/kinds";
import {
    acceptedDocumentDate,
    documentDateSourceHash,
    DOCUMENT_DATE_PROMPT,
    sessionYearMap,
    sessionYearsFor,
    validateDocumentDate,
} from "../lib/document-date-ai";
import { normalizedDateSortAnchor } from "../lib/document-date-value";

process.loadEnvFile(path.join(process.cwd(), ".env"));

const secondary = new Set<string>(SECONDARY_KINDS);
const select = {
    id: true,
    title: true,
    kind: true,
    folderPath: true,
    content: true,
    sessionNumber: true,
    datedAt: true,
    updatedAt: true,
    aiDateValue: true,
    aiDateSourceHash: true,
} as const;

type DateRow = {
    id: string;
    title: string;
    kind: string;
    folderPath: string;
    content: string;
    sessionNumber: number | null;
    datedAt: Date | null;
    updatedAt: Date;
    aiDateValue: string;
    aiDateSourceHash: string;
};

type Change = {
    id: string;
    updatedAt: Date;
    datedAt: Date | null;
    aiDateValue: string;
    aiDateSourceHash: string;
    value: string;
    sourceHash: string;
};

async function main() {
    const args = process.argv.slice(2);
    let limit = Infinity;
    let documentId: string | undefined;
    const apply = args.includes("--apply");
    for (let index = 0; index < args.length; index++) {
        if (args[index] === "--apply" || args[index] === "--cached-only") continue;
        if (args[index] === "--limit") {
            limit = Number(args[++index]);
            if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("--limit needs a positive integer");
        } else if (args[index] === "--document") {
            documentId = args[++index];
            if (!documentId || documentId.startsWith("--")) throw new Error("--document needs an ID");
        } else throw new Error(`Unknown option: ${args[index]}`);
    }
    if (args.includes("--cached-only")) limit = 0;

    if (documentId) {
        const targeted = await prisma.document.findUnique({ where: { id: documentId }, select: { kind: true } });
        if (!targeted) throw new Error("Document not found");
        if (secondary.has(targeted.kind)) throw new Error("Secondary sources keep the publication byline assigned at ingest.");
    }

    const directory = ".archive-local/document-dates";
    await mkdir(directory, { recursive: true });
    const report: object[] = [];
    const changes: Change[] = [];
    let calls = 0;
    let skipped = 0;
    let unattempted = 0;
    const map = sessionYearMap();

    const consider = async (document: DateRow) => {
        if (acceptedDocumentDate(document)) {
            skipped++;
            return;
        }
        const sourceHash = documentDateSourceHash(document);
        const cacheKey = createHash("sha256").update(JSON.stringify([
            sourceHash,
            DOCUMENT_DATE_PROMPT,
            process.env.AI_PROVIDER ?? "anthropic",
            process.env.AI_MODEL ?? "default",
        ])).digest("hex");
        const filename = path.join(directory, `${cacheKey}.json`);
        try {
            let raw: unknown;
            let cached = true;
            try {
                raw = JSON.parse(await readFile(filename, "utf8"));
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
                cached = false;
                if (calls >= limit) {
                    unattempted++;
                    return;
                }
                calls++;
                const generated = await generateJson<unknown>({
                    system: DOCUMENT_DATE_PROMPT,
                    user: JSON.stringify({
                        title: document.title,
                        kind: document.kind,
                        folderPath: document.folderPath,
                        content: document.content,
                        knownSession: document.sessionNumber,
                        knownSessionYears: sessionYearsFor(document.sessionNumber),
                        sessionYearMap: map,
                    }),
                    maxTokens: 4096,
                });
                raw = generated.value;
                validateDocumentDate(raw, document);
                await writeFile(filename, JSON.stringify(raw, null, 2), { mode: 0o600 });
            }
            let proposal;
            try {
                proposal = validateDocumentDate(raw, document);
            } catch (error) {
                if (cached) await rm(filename, { force: true });
                throw error;
            }
            if (!proposal.value) {
                report.push({ id: document.id, title: document.title, status: "deferred", ...proposal });
                return;
            }
            changes.push({
                id: document.id,
                updatedAt: document.updatedAt,
                datedAt: document.datedAt,
                aiDateValue: document.aiDateValue,
                aiDateSourceHash: document.aiDateSourceHash,
                value: proposal.value,
                sourceHash,
            });
            report.push({
                id: document.id,
                title: document.title,
                before: document.datedAt,
                status: "proposed",
                ...proposal,
            });
        } catch (error) {
            const failure = {
                id: document.id,
                title: document.title,
                status: "failed",
                reason: error instanceof Error ? error.message : String(error),
            };
            report.push(failure);
            await appendFile(
                path.join(directory, "rejections.jsonl"),
                JSON.stringify({ timestamp: new Date().toISOString(), ...failure }) + "\n",
                { mode: 0o600 },
            );
            console.error(`Deferred ${document.id}: ${failure.reason}`);
        }
    };

    if (documentId) {
        const document = await prisma.document.findUnique({ where: { id: documentId }, select });
        if (document) await consider(document);
    } else {
        let cursor: string | undefined;
        for (;;) {
            const batch = await prisma.document.findMany({
                where: { kind: { notIn: [...SECONDARY_KINDS] }, ...(cursor ? { id: { gt: cursor } } : {}) },
                orderBy: { id: "asc" },
                take: 20,
                select,
            });
            for (const document of batch) await consider(document);
            if (batch.length < 20) break;
            cursor = batch[batch.length - 1]!.id;
        }
    }

    const stamp = Date.now();
    const reportPath = path.join(directory, `preview-${stamp}.json`);
    await writeFile(reportPath, JSON.stringify(report, null, 2), { mode: 0o600 });
    console.log({
        modelCalls: calls,
        proposed: changes.length,
        skipped,
        unattempted,
        deferred: report.length - changes.length,
        report: reportPath,
    });
    if (!apply || !changes.length) return;

    await writeFile(path.join(directory, `backup-${stamp}.json`), JSON.stringify(changes, null, 2), { mode: 0o600 });
    const precisionPath = "config/archive-date-precision.json";
    const precision = JSON.parse(await readFile(precisionPath, "utf8")) as Record<string, unknown>;
    let precisionChanged = false;
    for (const change of changes) {
        const datedAt = normalizedDateSortAnchor(change.value);
        const result = await prisma.document.updateMany({
            where: { id: change.id, updatedAt: change.updatedAt },
            data: { datedAt, aiDateValue: change.value, aiDateSourceHash: change.sourceHash },
        });
        if (result.count && precision[change.id]) {
            delete precision[change.id];
            precisionChanged = true;
        }
        console.log(`${result.count ? "applied" : "stale; skipped"} ${change.id}: ${change.value}`);
    }
    if (precisionChanged) await writeFile(precisionPath, JSON.stringify(precision, null, 2));
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
}).finally(() => prisma.$disconnect());
