/** npm run people -- [--short] [--limit 20] [--session 114] [--document <id>] */
import path from "node:path";

process.loadEnvFile(path.join(process.cwd(), ".env"));

const USAGE = "Usage: npm run people -- [--short] [--limit 20] [--session 114] [--document <id>]";

function readArgs(argv: string[]) {
    const options = new Map<string, string>();
    let short = false;
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index]!;
        if (arg === "--short") {
            short = true;
            continue;
        }
        const value = argv[index + 1];
        if (!["--limit", "--session", "--document"].includes(arg) || !value || value.startsWith("--")) {
            throw new Error(USAGE);
        }
        options.set(arg, value);
        index += 1;
    }
    const number = (flag: string) => {
        if (!options.has(flag)) return undefined;
        const value = Number(options.get(flag));
        if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${flag} needs a positive integer`);
        return value;
    };
    return { short, options, limit: number("--limit") ?? Infinity, sessionNumber: number("--session") };
}

async function main() {
    const { short, options, limit, sessionNumber } = readArgs(process.argv.slice(2));
    const { prisma } = await import("../lib/prisma");
    let processed = 0;
    let failed = 0;
    let skipped = 0;
    try {
        if (short) {
            const result = await linkShortNames(prisma, { limit, sessionNumber, documentId: options.get("--document") });
            processed = result.processed;
            failed = result.failed;
            skipped = result.skipped;
        } else {
            const counted = await extractPeople(prisma, { limit, sessionNumber, documentId: options.get("--document") });
            processed = counted.processed;
            failed = counted.failed;
            skipped = counted.skipped;
        }
        console.log(`${processed} processed; ${failed} failed; ${skipped} already current. Limit counts documents, not model calls.`);
        if (failed) process.exitCode = 1;
    } finally {
        await prisma.$disconnect();
    }
}

async function extractPeople(
    prisma: Awaited<typeof import("../lib/prisma")>["prisma"],
    scope: { limit: number; sessionNumber?: number; documentId?: string },
) {
    const { recordContributors } = await import("../lib/sync");
    const { peopleFingerprint } = await import("../lib/people-extraction");
    let processed = 0;
    let failed = 0;
    let skipped = 0;
    const documents = await prisma.document.findMany({
        where: { id: scope.documentId, sessionNumber: scope.sessionNumber },
        select: { id: true, title: true, kind: true, content: true, peopleExtraction: { select: { fingerprint: true, appliedAt: true } } },
        orderBy: { id: "asc" },
    });
    if (scope.documentId && !documents.length) throw new Error("Document not found in the selected scope");
    for (const document of documents) {
        if (document.peopleExtraction?.appliedAt && document.peopleExtraction.fingerprint === peopleFingerprint(document)) {
            skipped += 1;
            continue;
        }
        if (processed + failed >= scope.limit) break;
        try {
            const count = await recordContributors(document.id, document.content);
            processed += 1;
            console.log(`processed ${document.id} ${document.title}: ${count} people links`);
        } catch (error) {
            failed += 1;
            console.error(`failed ${document.id} ${document.title}:`, error instanceof Error ? error.message : error);
        }
    }
    return { processed, failed, skipped };
}

async function linkShortNames(
    prisma: Awaited<typeof import("../lib/prisma")>["prisma"],
    scope: { limit: number; sessionNumber?: number; documentId?: string },
) {
    const { nameKey } = await import("../lib/contributors");
    const { matchShortName, SHORT_SOURCE, shortNameMentions, textHasFullName } = await import("../lib/short-names");
    const rows = await prisma.hopkinsAffiliate.findMany({
        select: {
            id: true,
            name: true,
            hopkinsRelationships: {
                where: { hopkinsCategory: { type: "position" } },
                select: { startedAt: true, endedAt: true },
            },
            contributions: {
                select: { evidence: true, document: { select: { sessionNumber: true, datedAt: true } } },
            },
        },
    });
    const roster = rows.flatMap((person) => {
        if (nameKey(person.name).split(" ").length < 2) return [];
        return [{
            id: person.id,
            name: person.name,
            seats: person.hopkinsRelationships,
            appearances: person.contributions.flatMap((item) => textHasFullName(item.evidence, person.name) ? [{
                sessionNumber: item.document.sessionNumber,
                datedAt: item.document.datedAt,
                evidence: item.evidence.slice(0, 500),
            }] : []),
        }];
    });
    const documents = await prisma.document.findMany({
        where: { id: scope.documentId, sessionNumber: scope.sessionNumber },
        select: { id: true, title: true, kind: true, content: true, datedAt: true, sessionNumber: true, meetingKey: true },
        orderBy: { id: "asc" },
    });
    if (scope.documentId && !documents.length) throw new Error("Document not found in the selected scope");
    // Who each meeting's other records already credit, so a short name can
    // be settled by the meeting itself. See `meetingPeople` in lib/short-names.ts.
    const meetingKeys = [...new Set(documents.map((document) => document.meetingKey).filter(Boolean))];
    const meetingCredits = meetingKeys.length ? await prisma.documentContributor.findMany({
        where: { document: { meetingKey: { in: meetingKeys } } },
        select: { documentId: true, hopkinsAffiliateId: true, document: { select: { meetingKey: true } } },
    }) : [];
    const meetingPeople = (document: { id: string; meetingKey: string }) => document.meetingKey
        ? new Set(meetingCredits.filter((row) => row.document.meetingKey === document.meetingKey && row.documentId !== document.id)
            .map((row) => row.hopkinsAffiliateId))
        : undefined;

    let processed = 0;
    let failed = 0;
    let skipped = 0;
    for (const document of documents) {
        const mentions = shortNameMentions(document.content, document.title, document.kind);
        if (!mentions.length) continue;
        if (processed + failed >= scope.limit) break;
        try {
            const existing = await prisma.documentContributor.findMany({
                where: { documentId: document.id },
                select: {
                    id: true,
                    role: true,
                    source: true,
                    evidence: true,
                    hopkinsAffiliateId: true,
                    hopkinsAffiliate: { select: { name: true } },
                },
            });
            const atMeeting = meetingPeople(document);
            const resolved = mentions.map((mention) => ({
                mention,
                person: matchShortName(mention.name, roster, {
                    asOf: document.datedAt,
                    sessionNumber: document.sessionNumber,
                    text: document.content,
                    evidence: mention.evidence,
                    meetingPeople: atMeeting,
                }),
            }));
            const changes: string[] = [];
            await prisma.$transaction(async (tx) => {
                for (const { mention, person } of resolved) {
                    const evidence = mention.evidence.slice(0, 300);
                    const stale = existing.filter((row) =>
                        (row.source === "parsed" || row.source === SHORT_SOURCE) &&
                        row.evidence === evidence &&
                        !textHasFullName(row.evidence, row.hopkinsAffiliate.name) &&
                        row.hopkinsAffiliateId !== person?.id);
                    if (stale.length) {
                        await tx.documentContributor.deleteMany({ where: { id: { in: stale.map((row) => row.id) } } });
                        for (const row of stale) changes.push(`cleared ${row.hopkinsAffiliate.name}`);
                    }
                    if (!person) continue;
                    const manual = existing.some((row) =>
                        row.source === "manual" && row.hopkinsAffiliateId === person.id && row.role === mention.role);
                    if (manual) continue;
                    const current = existing.find((row) =>
                        row.hopkinsAffiliateId === person.id && row.role === mention.role && row.evidence === evidence);
                    if (current?.source === SHORT_SOURCE) continue;
                    await tx.documentContributor.upsert({
                        where: {
                            documentId_hopkinsAffiliateId_role: {
                                documentId: document.id,
                                hopkinsAffiliateId: person.id,
                                role: mention.role,
                            },
                        },
                        create: {
                            documentId: document.id,
                            hopkinsAffiliateId: person.id,
                            role: mention.role,
                            source: SHORT_SOURCE,
                            evidence,
                        },
                        update: { source: SHORT_SOURCE, evidence },
                    });
                    changes.push(`${mention.name} -> ${person.name}`);
                }
            });
            if (!changes.length) {
                skipped += 1;
                continue;
            }
            processed += 1;
            console.log(`${document.id} ${document.title}: ${changes.join("; ")}`);
        } catch (error) {
            failed += 1;
            console.error(`failed ${document.id} ${document.title}:`, error instanceof Error ? error.message : error);
        }
    }
    return { processed, failed, skipped };
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
