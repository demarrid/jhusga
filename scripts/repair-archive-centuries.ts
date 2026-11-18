import { documentDate } from "../lib/identity";

process.loadEnvFile(".env");

async function main() {
    const { prisma } = await import("../lib/prisma");
    const apply = process.argv.includes("--apply");
    try {
        const documents = await prisma.document.findMany({
            where: { datedAt: { gte: new Date("2040-01-01"), lt: new Date("2100-01-01") } },
            select: { id: true, title: true, content: true, driveFileId: true, datedAt: true, sessionNumber: true },
        });
        let repaired = 0;
        for (const document of documents) {
            const date = documentDate(document);
            const old = document.datedAt!;
            const supported = date && date.getUTCFullYear() === old.getUTCFullYear() - 100 &&
                date.getUTCMonth() === old.getUTCMonth() && date.getUTCDate() === old.getUTCDate();
            console.log(JSON.stringify({ id: document.id, title: document.title, old: old.toISOString(),
                corrected: supported ? date.toISOString() : null, sessionNumber: document.sessionNumber,
                status: supported ? (apply ? "repair" : "preview") : "needs-review" }));
            if (apply && supported) {
                const updated = await prisma.document.updateMany({
                    where: { id: document.id, datedAt: old }, data: { datedAt: date },
                });
                repaired += updated.count;
            }
        }
        console.log(JSON.stringify({ checked: documents.length, repaired, apply }));
    } finally {
        await prisma.$disconnect();
    }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
