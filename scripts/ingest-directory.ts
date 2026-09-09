/**
 * Pull the current session's roster, email-list and attendance sheets from
 * Drive and rebuild the contact directory. Used when those workbooks are new
 * and a full sync is more than is needed.
 *
 *   npx tsx scripts/ingest-directory.ts
 */

import path from "node:path";

process.loadEnvFile(path.join(process.cwd(), ".env"));

async function main() {
    const { createHash } = await import("node:crypto");
    const { MASTER_FOLDER_ID, SESSION_NUMBER } = await import("../config/sga");
    const { isAttendanceSheetName } = await import("../lib/attendance");
    const { isDirectorySheetName, recordDirectory } = await import("../lib/directory");
    const {
        GOOGLE_SHEET_MIME,
        driveViewLink,
        exportSpreadsheetAsCsv,
        walkFolder,
    } = await import("../lib/drive");
    const { classifyDocument } = await import("../lib/kinds");
    const { lineageKeyFor } = await import("../lib/lineage");
    const { deriveDescription } = await import("../lib/markdown");
    const { prisma } = await import("../lib/prisma");

    const files = (await walkFolder(MASTER_FOLDER_ID)).filter(
        (file) =>
            file.sessionNumber === SESSION_NUMBER &&
            file.mimeType === GOOGLE_SHEET_MIME &&
            (isDirectorySheetName(file.name) || isAttendanceSheetName(file.name)),
    );

    let imported = 0;
    for (const file of files) {
        const content = await exportSpreadsheetAsCsv(file.id);
        const contentHash = createHash("sha256").update(content).digest("hex");
        const driveModifiedTime = file.modifiedTime ? new Date(file.modifiedTime) : null;

        await prisma.document.upsert({
            where: { driveFileId: file.id },
            create: {
                driveFileId: file.id,
                source: driveViewLink(file),
                mimeType: file.mimeType,
                title: file.name,
                description: deriveDescription(content),
                content,
                contentHash,
                kind: classifyDocument({ name: file.name, folderPath: file.folderPath }),
                folderPath: file.folderPath,
                sessionNumber: file.sessionNumber,
                lineageKey: lineageKeyFor(file.name, file.id),
                driveModifiedTime,
                lastSyncedAt: new Date(),
                driveOwnerName: file.owner?.displayName ?? null,
                driveOwnerEmail: file.owner?.emailAddress ?? null,
                driveLastEditorName: file.lastModifyingUser?.displayName ?? null,
                driveLastEditorEmail: file.lastModifyingUser?.emailAddress ?? null,
            },
            update: {
                source: driveViewLink(file),
                title: file.name,
                description: deriveDescription(content),
                content,
                contentHash,
                kind: classifyDocument({ name: file.name, folderPath: file.folderPath }),
                folderPath: file.folderPath,
                sessionNumber: file.sessionNumber,
                driveModifiedTime,
                lastSyncedAt: new Date(),
            },
        });
        imported += 1;
        console.log(`imported ${file.folderPath} / ${file.name}`);
    }

    const directory = await recordDirectory(SESSION_NUMBER);
    console.log(
        `${imported} sheets; ${directory.members} members; ${directory.emails} emails; ${directory.offices} offices`,
    );

    await prisma.$disconnect();
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
