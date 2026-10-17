/** npm run map:agenda -- --minutes <id> --agenda <id> [--force]
 * One cached model call per changed pair; never runs during a page request.
 */
import path from "node:path";
import { agendaItems, agendaMappingKey, agendaMappingHash, AGENDA_MAPPING_PROMPT, validateAgendaMatches } from "@/lib/agenda-mapping";

process.loadEnvFile(path.join(process.cwd(), ".env"));

async function main() {
    const args = process.argv.slice(2);
    const argument = (name: string) => {
        const at = args.indexOf(name);
        if (at < 0 || !args[at + 1] || args[at + 1].startsWith("--")) throw new Error(`${name} needs a document ID`);
        return args[at + 1];
    };
    const minutesId = argument("--minutes");
    const agendaId = argument("--agenda");
    const { prisma } = await import("@/lib/prisma");
    const { getDocument } = await import("@/server/documents");
    const { generateJson } = await import("@/lib/ai");
    try {
        const minutes = await getDocument(minutesId);
        const agenda = await prisma.document.findUnique({ where: { id: agendaId }, select: { content: true } });
        if (!minutes || !agenda || minutes.counterpart?.role !== "agenda" || !minutes.counterpart.documents.some(row => row.id === agendaId)) {
            throw new Error("Documents must be a matched minutes/agenda pair.");
        }
        if (minutes.content.length + agenda.content.length > 120_000) throw new Error("Pair exceeds the mapping input budget; not truncating evidence.");
        const key = agendaMappingKey(minutesId, agendaId);
        const promptHash = agendaMappingHash(minutes.content, agenda.content);
        const existing = await prisma.generatedSection.findUnique({ where: { key } });
        if (!args.includes("--force") && existing?.promptHash === promptHash && ["fresh", "empty"].includes(existing.status)) {
            console.log("Mapping is already current."); return;
        }
        const items = agendaItems(agenda.content);
        if (!items.length) throw new Error("Agenda has no navigable sections.");
        const result = await generateJson<unknown>({ system: AGENDA_MAPPING_PROMPT,
            user: JSON.stringify({ agendaItems: items.map(({ id, title }) => ({ sectionId: id, title })), agenda: agenda.content, minutes: minutes.content }) });
        const matches = validateAgendaMatches(result.value, minutes.content, agenda.content, agendaId);
        if (!result.value || typeof result.value !== "object" || !("matches" in result.value) || !Array.isArray(result.value.matches)) throw new Error("Invalid mapping response.");
        if (result.value.matches.length && !matches.length) throw new Error("No proposed matches passed evidence validation.");
        const data = { content: JSON.stringify({ matches }), promptHash, status: matches.length ? "fresh" : "empty", model: result.model, generatedAt: new Date(), error: null };
        await prisma.generatedSection.upsert({ where: { key }, create: { key, ...data }, update: data });
        console.log(`Stored ${matches.length} verified navigation matches.`);
    } finally { await prisma.$disconnect(); }
}

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
