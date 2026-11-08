/** Repair the reported archive records from stored source text; no Drive or generation calls.
 * Preview: npx tsx scripts/repair-document-presentation.ts
 * Apply:   npx tsx scripts/repair-document-presentation.ts --apply
 */
import { createHash } from "node:crypto";
import { prisma } from "../lib/prisma";
import { canonicalTitle } from "../lib/titles";
import { deriveDescription, sanitizeExport } from "../lib/markdown";
import { extractContributors } from "../lib/contributors";
import { reanchorDocument, recordContributors } from "../lib/sync";

process.loadEnvFile(".env");
// Resolve names using archived evidence only during this focused repair.
delete process.env.AI_API_KEY;
process.env.ADMINISTRATOR_LOOKUP_ENABLED = "false";
const ids = [
    "14720f00-2b70-476c-a2c8-36a9589abb0c",
    "671c103b-2109-420d-8266-b36cea79db2b",
    "95334d93-b961-47cd-9dce-958fc95114dc",
    "35720276-47ae-46f3-a15c-d1f003d4e009",
    "57a3354f-d2b6-4661-9687-1761fa510ed1",
    "4cbbc37d-ac90-473a-ba9c-8968fd8dccdb",
    "70c845ad-4ad7-42d3-ab8e-b409c72bd10c",
];
async function main() {
    const apply = process.argv.includes("--apply");
    const documents = await prisma.document.findMany({ where: { id: { in: ids } } });
    for (const document of documents) {
        const content = sanitizeExport(document.content);
        const displayTitle = canonicalTitle(document) ?? document.displayTitle;
        const people = extractContributors(content, document.title, document.kind);
        console.log(JSON.stringify({ id: document.id, displayTitle, removedCharacters: document.content.length - content.length,
            people: people.map(person => `${person.name}: ${person.role}`) }));
        if (!apply) continue;
        await prisma.document.update({ where: { id: document.id }, data: {
            displayTitle,
            ...(content !== document.content ? { content, contentHash: createHash("sha256").update(content).digest("hex"), description: deriveDescription(content) } : {}),
        } });
        if (content !== document.content) await reanchorDocument(document.id, content);
        await recordContributors(document.id, content);
    }
    console.log(`${apply ? "Repaired" : "Previewed"} ${documents.length} documents.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
