/**
 * Re-derive everything that is computed from already-stored document text:
 * descriptions, contributor rows, meeting pairings, the cross-document link
 * graph, Drive account matches, and leftover image markup in `content`.
 *
 *   npm run reprocess
 *
 * This exists because improving a parser should not cost a full Drive walk.
 * Content is only rewritten when sanitizeExport still finds image leftovers;
 * citation offsets are re-anchored in that case. Drive is never contacted.
 */

import path from "node:path";

process.loadEnvFile(path.join(process.cwd(), ".env"));

async function main() {
    const { prisma } = await import("../lib/prisma");
    const { createHash } = await import("node:crypto");
    const { deriveDescription, sanitizeExport } = await import("../lib/markdown");
    const {
        recordContributors,
        reanchorDocument,
        recordMeetings,
        recordTitles,
        recordKinds,
        rebuildReferences,
        recordDriveAccounts,
    } = await import("../lib/sync");
    const { recordDirectory } = await import("../lib/directory");
    const { pruneStaleAliases, resetNameResolverCache } = await import("../lib/names");
    const { SESSION_NUMBER } = await import("../config/session");

    const documents = await prisma.document.findMany({
        select: { id: true, title: true, description: true, content: true },
    });

    let descriptionsChanged = 0;
    let contentsCleaned = 0;
    let contributors = 0;

    // An alias recorded when the archive knew fewer people can now point at
    // the wrong one, so it goes before anything reads it.
    const prunedAliases = await pruneStaleAliases();

    // Who holds which seat is established first, because reading "Amy" in a
    // set of minutes depends on knowing that Amy Xu is the sitting Treasurer.
    resetNameResolverCache();
    await recordDirectory(SESSION_NUMBER);

    // Two passes: the first creates full-name people, the second can fold
    // "Sumi" / "Jazz" onto those regulars now that they exist.
    resetNameResolverCache();

    for (const document of documents) {
        const content = sanitizeExport(document.content);
        const description = deriveDescription(content);

        if (content !== document.content) {
            await prisma.document.update({
                where: { id: document.id },
                data: {
                    content,
                    contentHash: createHash("sha256").update(content).digest("hex"),
                    description,
                },
            });
            await reanchorDocument(document.id, content);
            contentsCleaned += 1;
            descriptionsChanged += 1;
        } else if (description !== document.description) {
            await prisma.document.update({
                where: { id: document.id },
                data: { description },
            });
            descriptionsChanged += 1;
        }

        contributors += await recordContributors(document.id, content);
    }

    resetNameResolverCache();
    contributors = 0;
    for (const document of documents) {
        const content = sanitizeExport(document.content);
        contributors += await recordContributors(document.id, content);
    }

    // People whose every mention has just been reparsed away would otherwise
    // linger in the person filter forever.
    const directory = await recordDirectory(SESSION_NUMBER);

    // Drive accounts are matched against the people the passes above just
    // established, so this has to come after them.
    const meetings = await recordMeetings();
    const renamed = await recordTitles();
    const reclassified = await recordKinds();
    const references = await rebuildReferences();
    const driveAccounts = await recordDriveAccounts();

    const orphaned = await prisma.hopkinsAffiliate.deleteMany({
        where: {
            contributions: { none: {} },
            hopkinsRelationships: { none: {} },
            userId: null,
            email: null,
        },
    });

    console.log(
        `${documents.length} documents; ${contentsCleaned} cleaned of leftover images; ` +
        `${descriptionsChanged} descriptions rewritten; ${contributors} contributions; ` +
        `${prunedAliases} outgrown aliases dropped; ` +
        `${orphaned.count} unreferenced people removed; ` +
        `${directory.members} directory members (${directory.emails} emails, ${directory.offices} offices); ` +
        `${meetings.keyed} meeting documents (${meetings.paired} agenda/minutes pairs); ` +
        `${renamed} documents shown under a standardised name; ` +
        `${reclassified} documents reclassified; ` +
        `${references} cross-document references; ${driveAccounts} Drive accounts matched`,
    );

    await prisma.$disconnect();
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
