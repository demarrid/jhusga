/** npm run people -- [--short [--dry-run]] [--limit 20] [--session 114] [--document <id>] */
import path from "node:path";

process.loadEnvFile(path.join(process.cwd(), ".env"));

const USAGE = "Usage: npm run people -- [--short [--dry-run]] [--limit 20] [--session 114] [--document <id>]";

function readArgs(argv: string[]) {
    const options = new Map<string, string>();
    let short = false;
    let dryRun = false;
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index]!;
        if (arg === "--short") {
            short = true;
            continue;
        }
        if (arg === "--dry-run") {
            dryRun = true;
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
    if (dryRun && !short) throw new Error("--dry-run only applies to --short");
    return { short, dryRun, options, limit: number("--limit") ?? Infinity, sessionNumber: number("--session") };
}

async function main() {
    const { short, dryRun, options, limit, sessionNumber } = readArgs(process.argv.slice(2));
    const { prisma } = await import("../lib/prisma");
    let processed = 0;
    let failed = 0;
    let skipped = 0;
    try {
        if (short) {
            const result = await linkShortNames(prisma, { limit, sessionNumber, documentId: options.get("--document"), dryRun });
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
    scope: { limit: number; sessionNumber?: number; documentId?: string; dryRun?: boolean },
) {
    const { nameKey } = await import("../lib/contributors");
    const { hasUniversityTitleNear, isLinkableFullName, matchShortName, SHORT_SOURCE, shortNameMentions, textHasFullName, textNamesPerson } = await import("../lib/short-names");
    const { nameTokens } = await import("../lib/names");
    const { parseExtractedPeople } = await import("../lib/people-extraction");
    const rows = await prisma.hopkinsAffiliate.findMany({
        select: {
            id: true,
            name: true,
            hopkinsRelationships: {
                where: { hopkinsCategory: { type: "position" } },
                select: { startedAt: true, endedAt: true },
            },
            contributions: {
                select: { evidence: true, role: true, source: true, document: { select: { sessionNumber: true, datedAt: true } } },
            },
        },
    });
    const roster = rows.flatMap((person) => {
        if (nameKey(person.name).split(" ").length < 2 || !isLinkableFullName(person.name)) return [];
        // This linker's own guesses do not count as evidence: a "Wilson" it
        // once read as Woodrow Wilson must not make him look like a dean, or
        // like somebody who attends.
        const sourced = person.contributions.filter((item) => item.source !== SHORT_SOURCE);
        const universityTitled = sourced.some((item) =>
            hasUniversityTitleNear(item.evidence, person.name.trim().split(/\s+/).at(-1) ?? ""));
        return [{
            id: person.id,
            name: person.name,
            seats: person.hopkinsRelationships,
            // Administrators are mostly only mentioned too; a university title
            // in the record is what separates Dean Schlesinger from Woodrow Wilson.
            onlyMentioned: person.hopkinsRelationships.length === 0 && !universityTitled &&
                sourced.every((item) => item.role === "mentioned"),
            universityTitled,
            appearances: person.contributions.flatMap((item) => textNamesPerson(item.evidence, person.name) ? [{
                sessionNumber: item.document.sessionNumber,
                datedAt: item.document.datedAt,
                evidence: item.evidence.slice(0, 500),
            }] : []),
        }];
    });
    const documents = await prisma.document.findMany({
        where: { id: scope.documentId, sessionNumber: scope.sessionNumber },
        select: {
            id: true, title: true, kind: true, content: true, datedAt: true, sessionNumber: true, meetingKey: true,
            peopleExtraction: { select: { people: true } },
        },
        orderBy: { id: "asc" },
    });
    if (scope.documentId && !documents.length) throw new Error("Document not found in the selected scope");
    // The AI pass's cached people, read as stored: no model is called here.
    // parseExtractedPeople drops any quote the current text no longer holds.
    const discoveredPeople = (document: (typeof documents)[number]) => {
        if (!document.peopleExtraction) return [];
        try {
            return parseExtractedPeople({ people: document.peopleExtraction.people }, document.content);
        } catch {
            return [];
        }
    };
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
        const mentions = shortNameMentions(document.content, document.title, document.kind, discoveredPeople(document));
        const fromParser = scope.dryRun
            ? new Set(shortNameMentions(document.content, document.title, document.kind).map((m) => `${m.name}\n${m.evidence}`))
            : null;
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
            if (scope.dryRun) {
                for (const { mention, person } of resolved) {
                    const linked = person && existing.some((row) =>
                        row.hopkinsAffiliateId === person.id && row.role === mention.role);
                    const ai = fromParser && !fromParser.has(`${mention.name}\n${mention.evidence}`) ? "ai " : "   ";
                    changes.push(`${linked ? "=" : person ? "+" : " "} ${ai}${mention.name}/${mention.role} -> ${person?.name ?? "(unresolved)"}` +
                        (person && !linked ? `  | ${mention.evidence.slice(0, 140).replace(/\s+/g, " ")}` : ""));
                }
                processed += 1;
                console.log(`${document.id} ${document.title} (dry run):\n  ${changes.join("\n  ")}`);
                continue;
            }
            // "Senator Mays, Senator Emeritus Fang" is one line naming two
            // people. Each is resolved from the same evidence, so neither
            // row is stale just because the other mention found someone else.
            const resolvedOnLine = new Map<string, Set<string>>();
            for (const { mention, person } of resolved) {
                if (!person) continue;
                const evidence = mention.evidence.slice(0, 300);
                resolvedOnLine.set(evidence, (resolvedOnLine.get(evidence) ?? new Set()).add(person.id));
            }
            await prisma.$transaction(async (tx) => {
                for (const { mention, person } of resolved) {
                    const evidence = mention.evidence.slice(0, 300);
                    // Only an earlier reading of this same short name is stale:
                    // "IA" left unresolved on a line says nothing about the
                    // Schatmeyer row the same line produced. And an unresolved
                    // name only withdraws this linker's own guesses, never the
                    // resolver's, which a reprocess would write straight back.
                    const stale = existing.filter((row) =>
                        (row.source === SHORT_SOURCE || (person && row.source === "parsed")) &&
                        row.evidence === evidence &&
                        nameTokens(row.hopkinsAffiliate.name).includes(nameKey(mention.name)) &&
                        !textHasFullName(row.evidence, row.hopkinsAffiliate.name) &&
                        row.hopkinsAffiliateId !== person?.id &&
                        !resolvedOnLine.get(evidence)?.has(row.hopkinsAffiliateId));
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
