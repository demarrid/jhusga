import path from "node:path";
process.loadEnvFile(path.join(process.cwd(), ".env"));
async function main() {
    const { importRevisionAuthors } = await import("../lib/drive-revisions");
    const { prisma } = await import("../lib/prisma");
    try {
        const result = await importRevisionAuthors(process.argv[2]);
        console.log(result);
        if (result.failed) process.exitCode = 1;
    } finally { await prisma.$disconnect(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
