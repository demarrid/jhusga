import assert from "node:assert/strict";

/**
 * Archive excerpts inherit the Drive owner of the compilation they share as
 * `source`; unreadable files stay unmarked until someone with access can ask.
 * Prisma and Drive are fixtures: no database or network is used.
 */
async function main() {
    process.env.GOOGLE_API_KEY = "fixture-key";
    for (const name of ["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET", "GOOGLE_OAUTH_REFRESH_TOKEN"]) delete process.env[name];

    const pdf = "https://drive.google.com/file/d/1W2ZThJXJHOrlZ9_2biao3lqAGrbvD2S_/view?usp=drivesdk";
    const hidden = "https://drive.google.com/file/d/1HiddenHiddenHidden0000000/view";
    const rows = [
        { id: "excerpt-a", source: pdf, driveOwnerName: null as string | null, driveOwnerEmail: null as string | null },
        { id: "excerpt-b", source: pdf, driveOwnerName: null as string | null, driveOwnerEmail: null as string | null },
        { id: "private", source: hidden, driveOwnerName: null as string | null, driveOwnerEmail: null as string | null },
        { id: "upload", source: "https://example.test/scan.pdf", driveOwnerName: null as string | null, driveOwnerEmail: null as string | null },
    ];
    const requested: string[] = [];
    globalThis.fetch = (async (input: string | URL) => {
        const url = String(input);
        requested.push(url);
        if (url.includes("1W2ZThJXJHOrlZ9_2biao3lqAGrbvD2S_")) {
            return new Response(JSON.stringify({ id: "1W2ZThJXJHOrlZ9_2biao3lqAGrbvD2S_", name: "SGA.pdf", mimeType: "application/pdf",
                owners: [{ displayName: "th9435", emailAddress: "th9435@gmail.com" }] }), { status: 200 });
        }
        return new Response("not found", { status: 404 });
    }) as typeof fetch;
    Object.assign(globalThis, { prisma: { document: {
        findMany: async () => rows.filter(row => row.driveOwnerName === null && row.driveOwnerEmail === null),
        updateMany: async ({ where, data }: { where: { id: { in: string[] } }; data: Partial<typeof rows[number]> }) => {
            const hit = rows.filter(row => where.id.in.includes(row.id));
            for (const row of hit) Object.assign(row, data);
            return { count: hit.length };
        },
    } } });

    const { recordArchiveSourceOwners } = await import("../lib/sync");
    const checked = new Set<string>();
    assert.deepEqual(await recordArchiveSourceOwners({ checked }), { complete: true, documentsUpdated: 2 });
    assert.deepEqual(rows.slice(0, 2).map(row => row.driveOwnerEmail), ["th9435@gmail.com", "th9435@gmail.com"]);
    // Nobody with access could be asked, so it is retried later rather than marked.
    assert.equal(rows[2]!.driveOwnerEmail, null);
    assert.equal(rows[3]!.driveOwnerEmail, null);
    assert.equal(requested.length, 2, "one lookup per source file, none for non-Drive sources");
    assert.equal(checked.size, 2);

    // The same run does not ask again.
    requested.length = 0;
    assert.equal((await recordArchiveSourceOwners({ checked })).documentsUpdated, 0);
    assert.equal(requested.length, 0);

    // A past deadline stops before the first lookup.
    assert.equal((await recordArchiveSourceOwners({ deadline: 0 })).complete, false);

    const { matchAccount } = await import("../lib/accounts");
    const people = [
        { id: "tim", name: "Tim Huang" }, { id: "timothy", name: "Timothy Huang" },
        { id: "shree", name: "Shreemann Patel" }, { id: "other", name: "Sara Patel" },
    ];
    assert.equal(matchAccount({ email: "th9435@gmail.com", displayName: "th9435" }, people)?.person.id, "tim");
    assert.equal(matchAccount({ email: "spate249@jh.edu", displayName: "spate249" }, people)?.person.id, "shree");

    console.log("archive owners: ok");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
