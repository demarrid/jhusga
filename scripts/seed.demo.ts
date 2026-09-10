/**
 * Development fixture: plausible documents and generated sections, built
 * without touching Drive or a model API, so the pages can be worked on before
 * any keys are configured.
 *
 *   npm run seed:demo
 *   npm run seed:demo -- --clear   (remove the fixtures, write nothing)
 *
 * Every row it writes has a "demo-" Drive file ID and is deleted on re-run, so
 * fixtures can never accumulate or be mistaken for synced documents.
 * Not for production -- `npm run sync` is the real path.
 */

import path from "node:path";
import { createHash } from "node:crypto";

process.loadEnvFile(path.join(process.cwd(), ".env"));

const CONSTITUTION = `# Constitution of the Student Government Association

## Article I — Name and Purpose

The name of this organization shall be the Student Government Association at the Johns Hopkins University, hereafter referred to as the SGA. The purpose of the SGA is to represent the interests of the undergraduate student body to the University administration.

## Article II — The Legislative Branch

The legislative power of the SGA shall be vested in a Senate. The Senate shall consist of Class Senators elected by each undergraduate class and School Senators elected by each undergraduate school.

Each undergraduate class shall elect four Class Senators, who shall serve a term of one academic year.

The Senate shall have the power to pass legislation, to approve the annual budget, and to confirm appointments made by the Student Body President.

### Committees

The Senate shall maintain standing committees, including the Committee on Academic Affairs, the Committee on Student Life, and the Committee on Finance.

The Committee on Academic Affairs shall consider all matters relating to curriculum, advising, and academic policy.

The Committee on Finance shall review all requests for funding from Registered Student Organizations and shall report its recommendations to the Senate.

## Article III — The Executive Branch

The executive power of the SGA shall be vested in a Student Body President, who shall be elected by the undergraduate student body in a general election held each spring.

The Student Body President shall serve a term of one academic year, and shall preside over all meetings of the Executive Board.

The Student Body President shall have the power to veto legislation passed by the Senate, provided that such veto is exercised within seven days of passage. A veto may be overridden by a two-thirds vote of the Senate.

The Executive Board shall consist of the Student Body President, the Executive Vice President, the Executive Treasurer, and the Executive Secretary.

## Article IV — The Judicial Branch

The judicial power of the SGA shall be vested in a Judiciary. The Judiciary shall consist of five Justices appointed by the Student Body President and confirmed by a majority vote of the Senate.

The Judiciary shall have jurisdiction over all disputes arising under this Constitution and the Bylaws, and shall have the power to determine whether an act of the Senate is consistent with this Constitution.
`;

// The prior session's text, differing in the ways an amendment would.
const CONSTITUTION_113TH = CONSTITUTION.replace(
    "Each undergraduate class shall elect four Class Senators, who shall serve a term of one academic year.",
    "Each undergraduate class shall elect three Class Senators, who shall serve a term of one academic year.",
)
    .replace(
        "The Judiciary shall consist of five Justices appointed by the Student Body President and confirmed by a majority vote of the Senate.",
        "The Judiciary shall consist of three Justices appointed by the Student Body President.",
    )
    .replace(
        "provided that such veto is exercised within seven days of passage. A veto may be overridden by a two-thirds vote of the Senate.",
        "provided that such veto is exercised within ten days of passage.",
    );

const BYLAWS = `# Bylaws of the Student Government Association

## Section 1 — Meetings

The Senate shall meet at least once every two weeks during the academic year. All meetings of the Senate shall be open to the public.

## Section 2 — Committee Membership

Each Senator shall serve on at least one standing committee. The chair of each standing committee shall be elected by the members of that committee.

The Chair of the Committee on Academic Affairs shall report to the Senate at least once per month.

## Section 3 — Funding

Registered Student Organizations may request funding from the SGA by submitting a written request to the Committee on Finance no later than two weeks before the funds are required.
`;

/**
 * Stands in for what generateSection would produce: prose plus quotes copied
 * verbatim out of the documents. The quotes are verified with the real
 * findQuote before anything is written, so the fixture cannot drift out of
 * agreement with the source text.
 */
const SECTIONS: {
    key: string;
    content: string;
    citations: { document: "constitution" | "bylaws"; quote: string }[];
}[] = [
        {
            key: "about.executive.overview",
            content:
                "Executive power in the SGA rests with the Student Body President, who is elected by the whole undergraduate student body in a general election each spring. The President works alongside an Executive Board made up of the Executive Vice President, the Executive Treasurer, and the Executive Secretary.",
            citations: [
                {
                    document: "constitution",
                    quote:
                        "The executive power of the SGA shall be vested in a Student Body President, who shall be elected by the undergraduate student body in a general election held each spring.",
                },
                {
                    document: "constitution",
                    quote:
                        "The Executive Board shall consist of the Student Body President, the Executive Vice President, the Executive Treasurer, and the Executive Secretary.",
                },
            ],
        },
        {
            key: "about.executive.president",
            content:
                "The Student Body President serves a one-year term and chairs every meeting of the Executive Board. The President can veto legislation the Senate has passed, but only within seven days of it passing, and the Senate can override that veto with a two-thirds vote.",
            citations: [
                {
                    document: "constitution",
                    quote:
                        "The Student Body President shall serve a term of one academic year, and shall preside over all meetings of the Executive Board.",
                },
                {
                    document: "constitution",
                    quote:
                        "The Student Body President shall have the power to veto legislation passed by the Senate, provided that such veto is exercised within seven days of passage.",
                },
            ],
        },
        {
            key: "about.legislative.overview",
            content:
                "The Senate holds the SGA's legislative power. It is made up of Class Senators, elected four per undergraduate class, and School Senators elected by each undergraduate school. The Senate passes legislation, approves the annual budget, and confirms the President's appointments. It meets at least every two weeks, and its meetings are open to the public.",
            citations: [
                {
                    document: "constitution",
                    quote:
                        "The Senate shall consist of Class Senators elected by each undergraduate class and School Senators elected by each undergraduate school.",
                },
                {
                    document: "constitution",
                    quote:
                        "The Senate shall have the power to pass legislation, to approve the annual budget, and to confirm appointments made by the Student Body President.",
                },
                {
                    document: "bylaws",
                    quote:
                        "The Senate shall meet at least once every two weeks during the academic year. All meetings of the Senate shall be open to the public.",
                },
            ],
        },
        {
            key: "about.legislative.committees",
            content:
                "The Senate keeps standing committees, among them the Committee on Academic Affairs, the Committee on Student Life, and the Committee on Finance. Academic Affairs handles curriculum, advising, and academic policy, and reports to the Senate monthly. Finance reviews every funding request from Registered Student Organizations and recommends action to the Senate. Every Senator sits on at least one committee, and each committee elects its own chair.",
            citations: [
                {
                    document: "constitution",
                    quote:
                        "The Committee on Academic Affairs shall consider all matters relating to curriculum, advising, and academic policy.",
                },
                {
                    document: "constitution",
                    quote:
                        "The Committee on Finance shall review all requests for funding from Registered Student Organizations and shall report its recommendations to the Senate.",
                },
                {
                    document: "bylaws",
                    quote:
                        "Each Senator shall serve on at least one standing committee. The chair of each standing committee shall be elected by the members of that committee.",
                },
            ],
        },
        {
            key: "about.judicial.overview",
            content:
                "The Judiciary holds the SGA's judicial power. It has five Justices, appointed by the Student Body President and confirmed by a majority of the Senate. It hears disputes arising under the Constitution and the Bylaws, and decides whether an act of the Senate is consistent with the Constitution.",
            citations: [
                {
                    document: "constitution",
                    quote:
                        "The Judiciary shall consist of five Justices appointed by the Student Body President and confirmed by a majority vote of the Senate.",
                },
                {
                    document: "constitution",
                    quote:
                        "The Judiciary shall have jurisdiction over all disputes arising under this Constitution and the Bylaws, and shall have the power to determine whether an act of the Senate is consistent with this Constitution.",
                },
            ],
        },
    ];

function hash(content: string): string {
    return createHash("sha256").update(content).digest("hex");
}

async function main() {
    const { prisma } = await import("../lib/prisma");
    const { findQuote } = await import("../lib/anchor");
    const { lineageKeyFor } = await import("../lib/lineage");
    const { indexDocumentPassages } = await import("../lib/search");
    const { SESSION_NUMBER } = await import("../config/session");

    // Annotations and citations cascade from the documents and sections.
    const removedDocuments = await prisma.document.deleteMany({
        where: { driveFileId: { startsWith: "demo-" } },
    });
    const removedSections = await prisma.generatedSection.deleteMany({
        where: { key: { in: SECTIONS.map((section) => section.key) } },
    });

    if (process.argv.includes("--clear")) {
        console.log(
            `cleared ${removedDocuments.count} document(s) and ${removedSections.count} section(s)`,
        );
        return;
    }

    const fixtures = [
        {
            driveFileId: "demo-constitution-114",
            title: "SGA Constitution",
            kind: "guiding.constitution",
            content: CONSTITUTION,
            sessionNumber: SESSION_NUMBER,
            folderPath: "Guiding Documents",
        },
        {
            driveFileId: "demo-bylaws-114",
            title: "SGA Bylaws",
            kind: "guiding.bylaws",
            content: BYLAWS,
            sessionNumber: SESSION_NUMBER,
            folderPath: "Guiding Documents",
        },
        {
            driveFileId: "demo-constitution-113",
            title: "113th SGA Constitution 2025-2026",
            kind: "guiding.constitution",
            content: CONSTITUTION_113TH,
            sessionNumber: SESSION_NUMBER - 1,
            folderPath: "113th SGA Master Folder 2025-2026/Guiding Documents",
        },
    ];

    const created = new Map<string, string>();

    for (const fixture of fixtures) {
        const document = await prisma.document.create({
            data: {
                driveFileId: fixture.driveFileId,
                source: `https://docs.google.com/document/d/${fixture.driveFileId}/edit`,
                title: fixture.title,
                description: fixture.content
                    .split(/\n\s*\n/)
                    .map((block) => block.trim())
                    .find((block) => block && !block.startsWith("#"))!
                    .slice(0, 200),
                content: fixture.content,
                contentHash: hash(fixture.content),
                kind: fixture.kind,
                folderPath: fixture.folderPath,
                sessionNumber: fixture.sessionNumber,
                lineageKey: lineageKeyFor(fixture.title, fixture.driveFileId),
                driveModifiedTime: new Date(),
                lastSyncedAt: new Date(),
            },
        });
        created.set(fixture.driveFileId, document.id);

        // Without these the fixtures are invisible to the question box, which
        // is exactly the surface a demo database exists to let someone try.
        const passages = await indexDocumentPassages(document.id, fixture.content);
        console.log(
            `document  ${fixture.title} (${document.lineageKey}) — ${passages} passages`,
        );
    }

    const documentIds = {
        constitution: created.get("demo-constitution-114")!,
        bylaws: created.get("demo-bylaws-114")!,
    };
    const documentText = {
        constitution: CONSTITUTION,
        bylaws: BYLAWS,
    };

    for (const section of SECTIONS) {
        const created = await prisma.generatedSection.create({
            data: {
                key: section.key,
                content: section.content,
                status: "fresh",
                model: "fixture",
                promptHash: "fixture",
                generatedAt: new Date(),
            },
        });

        let ordinal = 0;
        for (const citation of section.citations) {
            const anchor = findQuote(documentText[citation.document], citation.quote);
            if (!anchor) {
                throw new Error(
                    `Fixture quote is not present verbatim in ${citation.document}: "${citation.quote.slice(0, 60)}..."`,
                );
            }

            const annotation = await prisma.documentAnnotation.create({
                data: {
                    documentId: documentIds[citation.document],
                    content: citation.quote,
                    startOffset: anchor.startOffset,
                    endOffset: anchor.endOffset,
                },
            });

            await prisma.citation.create({
                data: {
                    sectionId: created.id,
                    annotationId: annotation.id,
                    ordinal: ordinal++,
                },
            });
        }

        console.log(`section   ${section.key} (${ordinal} citations)`);
    }
}

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => {
        const { prisma } = await import("../lib/prisma");
        await prisma.$disconnect();
    });
