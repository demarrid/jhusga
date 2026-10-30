/**
 * Default: read-only search queue. --resolve runs bounded source-backed lookup
 * and reparses contributors, retaining source evidence without global aliases.
 * node --env-file=.env --import tsx scripts/lookup-people.ts [document-id]
 */
import { prisma } from "../lib/prisma";
import { extractContributors } from "../lib/contributors";
import { loadRegulars, universityNameLookup } from "../lib/names";

async function main() {
    const args = process.argv.slice(2);
    const resolve = args.includes("--resolve");
    const id = args.find(arg => !arg.startsWith("--"));
    if (resolve) {
        const { beginAdministratorLookupRun } = await import("../lib/administrator-lookup");
        beginAdministratorLookupRun();
        if (!id) {
            const { revisitAdministratorMentions } = await import("../lib/administrator-backfill");
            console.log(JSON.stringify(await revisitAdministratorMentions()));
            return;
        }
        const document = await prisma.document.findUnique({
            where: { id }, select: { content: true, kind: true, reviewState: true },
        });
        if (!document || !document.kind.startsWith("minutes.") || document.reviewState !== "published") {
            throw new Error("Choose a published minutes document for administrator lookup.");
        }
        const { recordContributors } = await import("../lib/sync");
        await recordContributors(id, document.content);
        const lookups = await prisma.administratorLookup.findMany({
            where: { documentId: id }, select: { mention: true, status: true, fullName: true, evidence: true },
        });
        console.log(JSON.stringify(lookups, null, 2));
        return;
    }
    const regulars = await loadRegulars();
    const documents = await prisma.document.findMany({
        where: id ? {id} : {kind:{startsWith:"minutes."}},
        select:{id:true,title:true,kind:true,content:true,datedAt:true},
        orderBy:{datedAt:"desc"},
    });
    if (id && !documents.length) throw new Error("Document not found in the configured database");
    for (const doc of documents) {
        const seen = new Set<string>();
        for (const mention of extractContributors(doc.content,doc.title,doc.kind)) {
            const query = universityNameLookup(mention,regulars);
            if (!query || seen.has(query)) continue;
            seen.add(query);
            console.log(JSON.stringify({
                documentId:doc.id,title:doc.title,date:doc.datedAt,
                name:mention.name,office:mention.office,evidence:mention.evidence,
                query,url:"https://www.google.com/search?q="+encodeURIComponent(query),
            }));
        }
    }
}
main().catch(error => {console.error(error);process.exitCode=1;}).finally(()=>prisma.$disconnect());
