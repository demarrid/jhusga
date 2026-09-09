import path from "node:path";

process.loadEnvFile(path.join(process.cwd(), ".env"));

async function main() {
    const { generateStaleSections } = await import("../lib/generate");

    for (const result of await generateStaleSections({ force: true })) {
        console.log("section:", result);
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
