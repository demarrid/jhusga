/**
 * Exercises the database queries that the sync pipeline depends on, against a
 * throwaway document. Verifies the amendment path: a quote that survives a
 * re-export keeps working, one that does not is orphaned and the section
 * citing it goes stale.
 */

import path from "node:path";

process.loadEnvFile(path.join(process.cwd(), ".env"));

let failures = 0;
function check(label: string, condition: boolean, detail?: unknown) {
    if (condition) {
        console.log(`  ok   ${label}`);
    } else {
        failures += 1;
        console.log(`  FAIL ${label}`, detail ?? "");
    }
}

const DRIVE_FILE_ID = "__db_check_fixture__";
const SECTION_KEY = "__db_check_section__";

async function main() {
    const { prisma } = await import("../lib/prisma");
    const { reanchorDocument } = await import("../lib/sync");
    const { findQuote } = await import("../lib/anchor");

    // Clean slate from any previous run.
    await prisma.document.deleteMany({ where: { driveFileId: DRIVE_FILE_ID } });
    await prisma.generatedSection.deleteMany({ where: { key: SECTION_KEY } });

    const before = [
        "The Treasurer shall maintain the accounts of the Association.",
        "",
        "The Parliamentarian shall advise the chair on procedure.",
    ].join("\n");

    const document = await prisma.document.create({
        data: {
            driveFileId: DRIVE_FILE_ID,
            source: "https://example.invalid",
            title: "Fixture Bylaws",
            content: before,
            contentHash: "hash-v1",
            kind: "guiding.bylaws",
        },
    });

    // Compound-unique upsert, as used for revisions.
    await prisma.documentRevision.upsert({
        where: {
            documentId_contentHash: {
                documentId: document.id,
                contentHash: "hash-v1",
            },
        },
        create: {
            documentId: document.id,
            title: "Fixture Bylaws",
            content: before,
            contentHash: "hash-v1",
        },
        update: { fetchedAt: new Date() },
    });
    // Second call must update rather than violate the constraint.
    await prisma.documentRevision.upsert({
        where: {
            documentId_contentHash: {
                documentId: document.id,
                contentHash: "hash-v1",
            },
        },
        create: {
            documentId: document.id,
            title: "Fixture Bylaws",
            content: before,
            contentHash: "hash-v1",
        },
        update: { fetchedAt: new Date() },
    });
    check(
        "revision upsert is idempotent on (documentId, contentHash)",
        (await prisma.documentRevision.count({
            where: { documentId: document.id },
        })) === 1,
    );

    const survivingQuote =
        "The Treasurer shall maintain the accounts of the Association.";
    const doomedQuote =
        "The Parliamentarian shall advise the chair on procedure.";

    const surviving = await prisma.documentAnnotation.create({
        data: {
            documentId: document.id,
            content: survivingQuote,
            ...findQuote(before, survivingQuote)!,
        },
    });
    const doomed = await prisma.documentAnnotation.create({
        data: {
            documentId: document.id,
            content: doomedQuote,
            ...findQuote(before, doomedQuote)!,
        },
    });

    const section = await prisma.generatedSection.create({
        data: {
            key: SECTION_KEY,
            content: "The Treasurer keeps the accounts and the Parliamentarian advises.",
            status: "fresh",
            generatedAt: new Date(),
            citations: {
                create: [
                    { annotationId: surviving.id, ordinal: 0 },
                    { annotationId: doomed.id, ordinal: 1 },
                ],
            },
        },
    });

    // The amendment: the Parliamentarian clause is struck and text is inserted
    // above, which shifts the surviving quote's offsets.
    const after = [
        "## Article I",
        "",
        "The Treasurer shall maintain the accounts of the Association.",
    ].join("\n");

    const result = await reanchorDocument(document.id, after);

    check("one annotation orphaned", result.orphaned === 1, result);
    check("one section invalidated", result.sectionsInvalidated === 1, result);

    const survivingAfter = await prisma.documentAnnotation.findUniqueOrThrow({
        where: { id: surviving.id },
    });
    check(
        "surviving annotation was re-anchored to shifted offsets",
        survivingAfter.orphanedAt === null &&
        survivingAfter.startOffset !== null &&
        after.slice(survivingAfter.startOffset, survivingAfter.endOffset!) ===
        survivingQuote,
        {
            start: survivingAfter.startOffset,
            slice:
                survivingAfter.startOffset !== null
                    ? after.slice(
                        survivingAfter.startOffset,
                        survivingAfter.endOffset!,
                    )
                    : null,
        },
    );
    check(
        "offsets actually moved",
        survivingAfter.startOffset !== surviving.startOffset,
        { was: surviving.startOffset, now: survivingAfter.startOffset },
    );

    const doomedAfter = await prisma.documentAnnotation.findUniqueOrThrow({
        where: { id: doomed.id },
    });
    check(
        "amended-away annotation is orphaned with offsets cleared",
        doomedAfter.orphanedAt !== null &&
        doomedAfter.startOffset === null &&
        doomedAfter.endOffset === null,
        doomedAfter,
    );

    const sectionAfter = await prisma.generatedSection.findUniqueOrThrow({
        where: { id: section.id },
    });
    check("section marked stale", sectionAfter.status === "stale", sectionAfter);

    // The read path used by pages.
    const { getSection } = await import("../api/sections");
    const read = await getSection(SECTION_KEY);
    check("getSection returns both citations", read?.citations.length === 2, read?.citations.length);
    check(
        "getSection flags the orphaned citation",
        read?.citations.filter((citation) => citation.orphaned).length === 1,
        read?.citations.map((c) => ({ q: c.quote.slice(0, 20), orphaned: c.orphaned })),
    );
    check(
        "citation href deep links to the annotation",
        read?.citations[0]?.href ===
        `/documents/${document.id}#annotation-${surviving.id}`,
        read?.citations[0]?.href,
    );

    const { getDocument } = await import("../api/documents");
    await prisma.document.update({
        where: { id: document.id },
        data: { content: after },
    });
    const detail = await getDocument(document.id);
    const runs = (detail?.blocks ?? []).flatMap((block) =>
        block.kind === "paragraph" || block.kind === "heading" ? block.runs : [],
    );
    check(
        "document viewer blocks reproduce the content",
        runs.map((run) => run.text).join("\n\n") ===
        ["Article I", survivingQuote].join("\n\n"),
        runs.map((run) => run.text),
    );
    check(
        "only the surviving highlight is rendered",
        runs.filter((run) => run.annotationId !== null).length === 1,
        runs.filter((run) => run.annotationId).map((run) => run.text),
    );

    // Cascades: removing the document must not leave orphan rows behind.
    await prisma.document.delete({ where: { id: document.id } });
    check(
        "annotations cascade on document delete",
        (await prisma.documentAnnotation.count({
            where: { documentId: document.id },
        })) === 0,
    );
    check(
        "citations cascade with their annotations",
        (await prisma.citation.count({ where: { sectionId: section.id } })) === 0,
    );

    await prisma.generatedSection.deleteMany({ where: { key: SECTION_KEY } });
}

main()
    .catch((error) => {
        console.error(error);
        failures += 1;
    })
    .finally(async () => {
        const { prisma } = await import("../lib/prisma");
        await prisma.$disconnect();
        console.log(
            failures === 0 ? "\nall checks passed" : `\n${failures} failure(s)`,
        );
        process.exitCode = failures === 0 ? 0 : 1;
    });
