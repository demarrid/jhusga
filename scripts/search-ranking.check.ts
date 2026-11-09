import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { Prisma } from "@prisma/client";
import { SESSION_NUMBER } from "../config/sga";
import { retrieve } from "../lib/search";

/** Exercise the real retrieval SQL against PostgreSQL without a remote database. */
async function main() {
    const db = new PGlite();
    try {
        await db.exec(`
            CREATE TABLE "Document" (
                "id" text PRIMARY KEY, "title" text, "displayTitle" text DEFAULT '',
                "kind" text, "sessionNumber" int, "contentHash" text DEFAULT 'fixture',
                "datedAt" timestamptz, "driveCreatedTime" timestamptz, "driveModifiedTime" timestamptz
            );
            CREATE TABLE "DocumentPassage" (
                "id" text PRIMARY KEY, "documentId" text, "heading" text DEFAULT '', "content" text
            );
        `);
        async function add(id: string, kind: string, content: string, session = SESSION_NUMBER - 1) {
            await db.query(`INSERT INTO "Document" (id, title, kind, "sessionNumber") VALUES ($1, $1, $2, $3)`,
                [id, kind, session]);
            await db.query(`INSERT INTO "DocumentPassage" (id, "documentId", content) VALUES ($1, $1, $2)`,
                [id, content]);
        }

        // More generic documents than the 240-candidate limit. A rerank only
        // after that cutoff cannot recover either of the relevant minutes.
        for (let i = 0; i < 250; i += 1) {
            await add(`handout-${i}`, "guiding.other", "Motions may be made. Motion motion motion motion motion.", SESSION_NUMBER);
        }
        await add("aarshi-motion", "minutes.senate", "Aarshi: motion to extend discussion by five minutes. Second: Cole. Passed.");
        await add("aarshi-moved", "minutes.senate", "Aarshi moved to adjourn. Second: Cole. The meeting adjourned.");
        await add("attendance-only", "attendance", "Aarshi Aarshi Aarshi Aarshi Aarshi");

        Object.assign(globalThis, { prisma: {
            $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
                const query = Prisma.sql(strings, ...values);
                return (await db.query(query.text, query.values)).rows;
            },
            document: { findMany: async () => [] },
            documentSummary: { findMany: async () => [] },
        } });

        const question = "What motions has aarshi made";
        const result = await retrieve(question);
        assert.equal(result.focus, "archive");
        assert.deepEqual(new Set(result.passages.slice(0, 2).map(p => p.documentId)),
            new Set(["aarshi-motion", "aarshi-moved"]),
            "a person's recorded motions beat repetitive handouts and attendance before the candidate cutoff");
        assert.ok(result.passages.slice(0, 2).every(p => p.sessionNumber === SESSION_NUMBER - 1),
            "older minutes remain eligible without historical keywords");

        const changedName = await retrieve("What motions has Cole made");
        assert.ok(changedName.passages.slice(0, 2).every(p => p.kind === "minutes.senate"),
            "coverage ranking is not hardcoded to Aarshi");

        const currentOnly = await retrieve(question, { scope: "current" });
        assert.ok(currentOnly.passages.every(p => p.sessionNumber === SESSION_NUMBER),
            "an explicitly requested session scope still applies");

        const noExactMatch = await retrieve("What motions has UnlistedPerson made");
        assert.ok(noExactMatch.passages.length > 0,
            "partial matches remain available when no passage covers the whole question");

        const noMatch = await retrieve("unmatchablexyz");
        assert.equal(noMatch.passages.length, 0);
        console.log("all SQL search ranking checks passed");
    } finally {
        await db.close();
    }
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
