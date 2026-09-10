/**
 * The search index, and a way to try it without the browser.
 *
 *   npm run search                       -- what is indexed, and what is not
 *   npm run search -- --index            -- index documents that have none
 *   npm run search -- --index --force    -- re-split the whole corpus
 *   npm run search -- "how many caucus senators can there be?"
 *   npm run search -- --all "when was the first caucus position introduced?"
 *   npm run search -- --passages "caucus"   -- retrieval only, no model call
 *
 * Indexing is free. Asking a question costs one model call unless the answer
 * is already cached, which --force ignores.
 */

import path from "node:path";

process.loadEnvFile(path.join(process.cwd(), ".env"));

async function main() {
    const args = process.argv.slice(2);
    const force = args.includes("--force");
    const scope = args.includes("--all") ? "all" : "current";
    const passagesOnly = args.includes("--passages");
    const question = args.filter((arg) => !arg.startsWith("--")).join(" ");

    if (args.includes("--index")) {
        const { rebuildPassages } = await import("../lib/search");
        const result = await rebuildPassages({ force });
        console.log(`${result.passages} passages across ${result.documents} documents`);
        if (!question) return;
    }

    if (!question) {
        // Nothing to ask, so report what there is to ask *of*. An empty index
        // and a question the documents do not answer look identical from the
        // browser, and this is the cheapest way to tell them apart.
        await reportCoverage();
        return;
    }

    if (passagesOnly) {
        const { retrievePassages } = await import("../lib/search");
        const passages = await retrievePassages(question, { scope });

        if (passages.length === 0) {
            console.log("No passage matches those words.");
            return;
        }

        for (const passage of passages) {
            console.log(
                `\n${passage.score.toFixed(3)}  ${passage.documentTitle}${
                    passage.heading ? ` — ${passage.heading}` : ""
                }`,
            );
            console.log(`  ${passage.content.replace(/\s+/g, " ").slice(0, 200)}`);
        }
        return;
    }

    const { answerQuestion } = await import("../lib/search");
    const answer = await answerQuestion(question, { scope, force });

    console.log(`\n${answer.status.toUpperCase()}${answer.error ? `: ${answer.error}` : ""}\n`);
    if (answer.content) console.log(answer.content);

    if (answer.citations.length > 0) {
        console.log("\nCitations:");
        for (const [index, citation] of answer.citations.entries()) {
            console.log(
                `  [${index + 1}] ${citation.documentTitle}${citation.orphaned ? " (orphaned)" : ""}`,
            );
            console.log(`      "${citation.quote.replace(/\s+/g, " ").slice(0, 160)}"`);
        }
    }

    if (answer.matches.length > 0) {
        console.log("\nRead from:");
        for (const match of answer.matches) {
            console.log(`  ${match.title} (${match.kind})`);
        }
    }
}

/** What the index holds, and what it is missing. */
async function reportCoverage() {
    const { SESSION_NUMBER } = await import("../config/sga");
    const { prisma } = await import("../lib/prisma");

    const [documents, indexed, passages, currentIndexed] = await Promise.all([
        prisma.document.count({ where: { NOT: { content: "" } } }),
        prisma.document.count({
            where: { NOT: { content: "" }, passages: { some: {} } },
        }),
        prisma.documentPassage.count(),
        prisma.document.count({
            where: {
                NOT: { content: "" },
                sessionNumber: SESSION_NUMBER,
                passages: { some: {} },
            },
        }),
    ]);

    console.log(`Documents with text:       ${documents}`);
    console.log(`Indexed:                   ${indexed}`);
    console.log(`Passages:                  ${passages}`);
    // The browser searches the current session unless the reader opts out, so
    // a corpus that is indexed but entirely historical still answers nothing.
    console.log(`Indexed in session ${SESSION_NUMBER}:    ${currentIndexed}`);

    if (indexed < documents) {
        console.log(
            `\n${documents - indexed} document(s) have no passages. Run: npm run search -- --index`,
        );
    } else if (currentIndexed === 0 && documents > 0) {
        console.log(
            `\nNothing from the ${SESSION_NUMBER}th session is indexed, so the default search finds nothing. Ask with --all, or check the session numbers on the documents.`,
        );
    } else {
        console.log("\nIndex is complete. Pass a question to try it.");
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
