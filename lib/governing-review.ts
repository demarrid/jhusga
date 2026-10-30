import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { amendmentPassage, titleKey } from "@/lib/amendment-passage";
import { checkAmendmentClearance } from "@/lib/amendment-clearance";
import { governingLineageKey } from "@/lib/lineage";
import { deriveDescription } from "@/lib/markdown";

const REVIEW_VERSION = "amendment-clearance-v2";
const GOVERNING_KINDS = ["guiding.constitution", "guiding.bylaws"];
const BILL_KINDS = ["bill.constitution_amendment", "bill.bylaws_amendment", "bill.bylaws_constitution_amendment"];

const sourceSelect = {
    id: true, driveFileId: true, title: true, displayTitle: true, content: true,
    contentHash: true, kind: true, sessionNumber: true, datedAt: true,
    driveModifiedTime: true, lineageKey: true, reviewState: true,
    revisions: { select: { id: true, content: true, contentHash: true, driveModifiedTime: true, fetchedAt: true }, orderBy: { id: "asc" } },
} satisfies Prisma.DocumentSelect;
type Source = Prisma.DocumentGetPayload<{ select: typeof sourceSelect }>;
const heldSelect = {
    id: true, title: true, kind: true, content: true, contentHash: true,
    sessionNumber: true, lineageKey: true, heldRevisionId: true, reviewState: true,
    heldRevision: { select: { id: true, documentId: true, content: true, contentHash: true, driveModifiedTime: true } },
} satisfies Prisma.DocumentSelect;
type Held = Prisma.DocumentGetPayload<{ select: typeof heldSelect }>;
type Db = Pick<Prisma.TransactionClient, "document">;

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));

/** Only archived snapshots demonstrably no later than the passage day qualify.
 * Date-only votes cannot order same-day edits. A prior snapshot must also
 * have been observed after passage, so an old draft is not presumed final. */
export function billVersionAtPassage<T extends {
    content: string; contentHash: string; driveModifiedTime: Date | null;
    revisions: { id: string; content: string; contentHash: string; driveModifiedTime: Date | null; fetchedAt: Date }[];
}>(bill: T, when: Date) {
    const startOfDay = Date.UTC(when.getUTCFullYear(), when.getUTCMonth(), when.getUTCDate());
    const endOfDay = startOfDay + 86_400_000;
    const snapshots = [
        { id: null as string | null, content: bill.content, contentHash: bill.contentHash, driveModifiedTime: bill.driveModifiedTime, fetchedAt: new Date() },
        ...bill.revisions,
    ].filter(row => row.driveModifiedTime && row.driveModifiedTime.getTime() < startOfDay && row.fetchedAt.getTime() >= endOfDay)
        .sort((a, b) => b.driveModifiedTime!.getTime() - a.driveModifiedTime!.getTime());
    const latest = snapshots[0];
    if (!latest) return null;
    // Conflicting exports with the same recorded edit time cannot identify the version.
    if (snapshots.some(row => row.driveModifiedTime!.getTime() === latest.driveModifiedTime!.getTime() &&
        row.contentHash !== latest.contentHash)) return null;
    return latest;
}

async function sourcesFor(db: Db, document: Held): Promise<Source[]> {
    // No date cutoff here: a late-published meeting record can clear an old hold,
    // and contradictory records must not disappear from the evidence set.
    return db.document.findMany({
        where: {
            OR: [
                { kind: { in: BILL_KINDS }, sessionNumber: document.sessionNumber },
                { kind: "minutes.senate", sessionNumber: document.sessionNumber },
                { title: { contains: "Bill Voting Record", mode: "insensitive" } },
            ],
        },
        select: sourceSelect,
        orderBy: { id: "asc" },
    });
}

export function reviewFingerprint(document: Held, sources: Source[], asOf: Date): string {
    return digest(JSON.stringify({
        version: REVIEW_VERSION,
        provider: process.env.AI_PROVIDER, model: process.env.AI_MODEL,
        day: asOf.toISOString().slice(0, 10),
        document,
        sources: [...sources].sort((a,b) => a.id.localeCompare(b.id)).map(source => ({
            ...source, revisions: [...source.revisions].sort((a,b) => a.id.localeCompare(b.id)),
        })),
    }));
}

function candidateBills(document: Held, sources: Source[]) {
    const target = governingLineageKey(document.kind, document.title);
    return sources.filter(bill => {
        if (!BILL_KINDS.includes(bill.kind) || bill.reviewState !== "published") return false;
        if (document.sessionNumber == null || bill.sessionNumber !== document.sessionNumber) return false;
        if (bill.kind === "bill.bylaws_constitution_amendment") {
            return target === "sga constitution" || target === "sga bylaws";
        }
        return governingLineageKey(bill.kind, bill.title) === target;
    });
}

async function assess(document: Held, sources: Source[], deadline: number, asOf: Date) {
    if (sources.some(source => source.reviewState === "held" &&
        (source.kind === "minutes.senate" || /bill voting records?/i.test(source.title)))) {
        return { clear: false, reason: "A Senate passage source has an unreviewed revision; its result needs verification first.", audit: [], match: null };
    }
    const published = sources.filter(source => source.reviewState === "published");
    const records = published.filter(source => /bill voting records?/i.test(source.title));
    const minutes = published.filter(source => source.kind === "minutes.senate");
    const decisions = candidateBills(document, sources).map(bill => {
        const keys = new Set([bill.title, bill.displayTitle].filter(Boolean).map(titleKey));
        const collision = sources.some(other => other.id !== bill.id && BILL_KINDS.includes(other.kind) &&
            other.sessionNumber === bill.sessionNumber &&
            [other.title, other.displayTitle].filter(Boolean).some(title => keys.has(titleKey(title))));
        const passage = amendmentPassage({ bill: { ...bill, allowTitleFallback: !collision }, records, minutes, asOf });
        const version = passage.status === "passed" && passage.when ? billVersionAtPassage(bill, passage.when) : null;
        return { bill, passage, version };
    });
    const bills = decisions.filter(row => row.passage.status === "passed" && row.version).map(row => ({
        id: row.bill.id, title: row.bill.title, kind: row.bill.kind,
        content: row.version!.content,
        passage: {
            status: row.passage.status,
            sourceId: row.passage.evidence.find(item => item.outcome === "passed")?.documentId ?? "",
            evidence: row.passage.evidence.map(item => item.quote).join("\n\n"),
        },
    }));
    const audit = decisions.map(row => ({
        billId: row.bill.id, title: row.bill.title, passage: row.passage,
        version: row.version ? { id: row.version.id, contentHash: row.version.contentHash,
            driveModifiedTime: row.version.driveModifiedTime } : null,
        versionReason: row.passage.status === "passed" && !row.version
            ? "No archived bill text observed after passage with an edit timestamp strictly before the passage day." : null,
    }));
    if (!document.heldRevision || document.heldRevision.documentId !== document.id) {
        return { clear: false, reason: "Held revision does not belong to this document.", audit, match: null };
    }
    if (document.sessionNumber == null) {
        return { clear: false, reason: "The governing document's session is unknown.", audit, match: null };
    }
    if (!bills.length) {
        return { clear: false, reason: "No amendment has both verified passage and an archived text version from that passage.", audit, match: null };
    }
    if (bills.length > 12) {
        return { clear: false, reason: "More than twelve passed amendments require a scoped review; no evidence was discarded.", audit, match: null };
    }
    const match = await checkAmendmentClearance({
        before: document.content, after: document.heldRevision.content,
        target: { kind: document.kind, title: document.title }, bills,
        deadline, allowModel: Boolean(process.env.AI_API_KEY),
    });
    return { clear: match.clear, reason: match.reason, audit, match };
}

export type GoverningReviewResult = {
    documentId: string; title: string; status: "published" | "ready" | "pending" | "error" | "changed";
    reason: string; cached?: boolean;
};

/** Resume derived-data work after an interrupted publication. */
async function refreshPublished(key: string, documentId: string, content: string) {
    const { indexDocumentPassages } = await import("@/lib/search");
    const { reanchorDocument, recordContributors } = await import("@/lib/sync");
    await recordContributors(documentId, content);
    await indexDocumentPassages(documentId, content);
    await reanchorDocument(documentId, content);
    await prisma.amendmentClearance.update({ where: { key }, data: { derivedUpdatedAt: new Date() } });
}

/** All writes are conditional on the same baseline, held revision, and evidence.
 * No AI request or external network call runs inside the transaction. */
async function publish(document: Held, sources: Source[], inputHash: string, key: string, asOf: Date) {
    if (!document.heldRevision) return false;
    const held = document.heldRevision;
    const published = await prisma.$transaction(async tx => {
        const current = await tx.document.findUnique({ where: { id: document.id }, select: heldSelect });
        if (!current || current.reviewState !== "held" ||
            current.heldRevisionId !== held.id || current.contentHash !== document.contentHash) return false;
        const currentSources = await sourcesFor(tx, current);
        if (reviewFingerprint(current, currentSources, asOf) !== inputHash) return false;
        // The full source set is checked, not just the successful bill: new
        // contradictory evidence or a newly-held source invalidates clearance.
        if (currentSources.length !== sources.length) return false;
        const changed = await tx.document.updateMany({
            where: { id: document.id, reviewState: "held", heldRevisionId: held.id, contentHash: document.contentHash },
            data: {
                content: held.content, contentHash: held.contentHash,
                description: deriveDescription(held.content), reviewState: "published",
                heldRevisionId: null, heldReason: "", heldAt: null,
            },
        });
        if (!changed.count) return false;
        await tx.documentRevision.update({
            where: { id: held.id }, data: { reviewedAt: new Date(), reviewedBy: `automated amendment verification: ${key}` },
        });
        await tx.documentSummary.updateMany({ where: { documentId: document.id, status: "fresh" }, data: { status: "stale" } });
        await tx.amendmentClearance.update({ where: { key }, data: { status: "published", publishedAt: new Date() } });
        return true;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    if (published) await refreshPublished(key, document.id, held.content);
    return published;
}

/** Called after all files have been ingested, even when no file changed. */
export async function reviewGoverningChanges(options: {
    apply?: boolean; documentId?: string; deadline?: number; limit?: number;
} = {}): Promise<GoverningReviewResult[]> {
    const apply = options.apply ?? true;
    const deadline = options.deadline ?? Date.now() + 45_000;
    const asOf = new Date();
    const results: GoverningReviewResult[] = [];
    if (apply) {
        // Fail closed if the migration has not been installed. Publication
        // without an audit record must never be a fallback.
        const unfinished = await prisma.amendmentClearance.findMany({
            where: { publishedAt: { not: null }, derivedUpdatedAt: null },
            take: 2, orderBy: { checkedAt: "asc" },
        });
        for (const row of unfinished) {
            const doc = await prisma.document.findUnique({ where: { id: row.documentId }, select: { content: true, contentHash: true } });
            const revision = await prisma.documentRevision.findUnique({ where: { id: row.revisionId }, select: { contentHash: true } });
            if (doc && doc.contentHash === revision?.contentHash) await refreshPublished(row.key, row.documentId, doc.content);
        }
    }
    const documents = await prisma.document.findMany({
        where: { reviewState: "held", kind: { in: GOVERNING_KINDS }, ...(options.documentId ? { id: options.documentId } : {}) },
        select: heldSelect,
        orderBy: { heldAt: "asc" },
    });
    let attempted = 0;
    for (const document of documents) {
        if (Date.now() >= deadline || attempted >= (options.limit ?? 3)) break;
        if (!document.heldRevision) continue;
        const sources = await sourcesFor(prisma, document);
        const inputHash = reviewFingerprint(document, sources, asOf);
        const key = digest(document.heldRevision.id + ":" + inputHash);
        const cached = await prisma.amendmentClearance.findUnique({ where: { key } }).catch(() => null);
        if (cached?.status === "pending") {
            results.push({ documentId: document.id, title: document.title, status: "pending", reason: cached.reason, cached: true });
            continue;
        }
        attempted++;
        try {
            const decision = await assess(document, sources, deadline, asOf);
            if (!apply) {
                results.push({ documentId: document.id, title: document.title, status: decision.clear ? "ready" : "pending", reason: decision.reason });
                continue;
            }
            await prisma.amendmentClearance.upsert({
                where: { key },
                create: {
                    key, documentId: document.id, revisionId: document.heldRevision.id, inputHash,
                    status: decision.clear ? "ready" : "pending", reason: decision.reason,
                    evidence: json({ version: REVIEW_VERSION, baselineHash: document.contentHash,
                        heldHash: document.heldRevision.contentHash, decisions: decision.audit, match: decision.match }),
                },
                update: {
                    status: decision.clear ? "ready" : "pending", reason: decision.reason,
                    evidence: json({ version: REVIEW_VERSION, baselineHash: document.contentHash,
                        heldHash: document.heldRevision.contentHash, decisions: decision.audit, match: decision.match }),
                    checkedAt: new Date(),
                },
            });
            const cleared = decision.clear && await publish(document, sources, inputHash, key, asOf);
            results.push({
                documentId: document.id, title: document.title,
                status: cleared ? "published" : decision.clear ? "changed" : "pending",
                reason: decision.clear && !cleared ? "The document or evidence changed during review; it will be checked again." : decision.reason,
            });
        } catch (error) {
            results.push({ documentId: document.id, title: document.title, status: "error",
                reason: error instanceof Error ? error.message : String(error) });
        }
    }
    return results;
}
