import path from "node:path";

process.loadEnvFile(path.join(process.cwd(), ".env"));

async function main() {
    const { prisma } = await import("../lib/prisma");
    const doc = await prisma.document.findFirst({
        where: { displayTitle: "Senate General Body Meeting #5 — Minutes (09/22/26)" },
        select: { content: true },
    });
    const lines = doc!.content.split("\n");
    for (let i = 70; i < 120; i++) console.log(String(i).padStart(4), JSON.stringify(lines[i]?.slice(0, 200)));
    await prisma.$disconnect();
}

main();
