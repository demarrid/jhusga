/**
 * Manual ingest, for local runs and one-off backfills.
 *
 *   npm run sync            -- re-read Drive, regenerate changed sections
 *   npm run sync -- --dry   -- list what the walk finds, write nothing
 *   npm run sync -- --force -- re-export and regenerate everything
 */

import path from "node:path";

process.loadEnvFile(path.join(process.cwd(), ".env"));

async function main() {
    const args = new Set(process.argv.slice(2));
    const dry = args.has("--dry");
    const force = args.has("--force");

    // Imported lazily so .env is loaded before any module reads process.env.
    const { MASTER_FOLDER_ID } = await import("../config/sga");

    if (dry) {
        const { walkFolder, GOOGLE_DOC_MIME } = await import("../lib/drive");
        const { classifyDocument } = await import("../lib/kinds");

        const files = await walkFolder(MASTER_FOLDER_ID);
        const docs = files.filter((file) => file.mimeType === GOOGLE_DOC_MIME);

        console.log(`${files.length} files, ${docs.length} Google Docs\n`);
        for (const file of docs) {
            const kind = classifyDocument({
                name: file.name,
                folderPath: file.folderPath,
            });
            console.log(`${kind.padEnd(30)} ${file.folderPath}/${file.name}`);
        }

        const unknown = docs.filter(
            (file) =>
                classifyDocument({
                    name: file.name,
                    folderPath: file.folderPath,
                }) === "unknown",
        ).length;
        console.log(
            `\n${docs.length - unknown} classified, ${unknown} unknown (tune classifyDocument in lib/kinds.ts)`,
        );
        return;
    }

    const { syncMasterFolder } = await import("../lib/sync");
    const summary = await syncMasterFolder({ trigger: "manual", force });
    console.log("sync:", summary);

    if (summary.documentsHeld > 0) {
        console.log(
            `\n${summary.documentsHeld} document(s) changed too much to publish unread.` +
            "\nThe site is still serving the last checked text. Run `npm run review`.",
        );
    }

    if (summary.documentsCreated + summary.documentsUpdated > 0 || force) {
        const { generateStaleSections } = await import("../lib/generate");
        for (const result of await generateStaleSections({ force })) {
            console.log("section:", result);
        }
    } else {
        console.log("sections: nothing changed, skipped generation");
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
