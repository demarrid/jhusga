import { prisma } from "@/lib/prisma";
import { extractContributors } from "@/lib/contributors";
import { administratorMentionContext, loadRegulars, universityNameLookup } from "@/lib/names";
import { administratorLookupBudgetRemaining, administratorLookupCacheKey } from "@/lib/administrator-lookup";

const CURSOR_KEY = "administrator-backfill:v1";

/** A persisted scan cursor eventually visits old minutes as well as new ones.
 * Search/cache budgets are shared with ordinary ingestion. */
export async function revisitAdministratorMentions(): Promise<{documentsRevisited:number}> {
    if (!process.env.AI_API_KEY || process.env.ADMINISTRATOR_LOOKUP_ENABLED === "false" ||
        administratorLookupBudgetRemaining() <= 0) return {documentsRevisited:0};
    const saved = await prisma.administratorLookup.findUnique({where:{key:CURSOR_KEY}});
    const evidence = saved?.evidence as {cursor?:string|null} | undefined;
    let cursor = typeof evidence?.cursor === "string" ? evidence.cursor : null;
    const regulars = await loadRegulars();
    let documentsRevisited = 0;
    let inspected = 0;
    while (inspected < 100 && administratorLookupBudgetRemaining() > 0) {
        const documents = await prisma.document.findMany({
            where:{kind:{startsWith:"minutes."},reviewState:"published",datedAt:{not:null},content:{not:""},
                ...(cursor ? {id:{gt:cursor}} : {})},
            select:{id:true,title:true,kind:true,content:true,datedAt:true},
            orderBy:{id:"asc"},take:20,
        });
        if (!documents.length) {cursor=null;break;}
        const cached = await prisma.administratorLookup.findMany({
            where:{documentId:{in:documents.map(d=>d.id)},expiresAt:{gt:new Date()}},select:{key:true},
        });
        const checked = new Set(cached.map(row=>row.key));
        for (const doc of documents) {
            if (administratorLookupBudgetRemaining() <= 0) break;
            const context = {text:doc.content,asOf:doc.datedAt ?? undefined};
            const pending = extractContributors(doc.content,doc.title,doc.kind).filter(mention=>
                universityNameLookup(mention,regulars) && !checked.has(administratorLookupCacheKey({
                    documentId:doc.id,name:mention.name,office:mention.office,evidence:mention.evidence,
                    context:administratorMentionContext(mention,context),asOf:context.asOf,
                })));
            if (pending.length) {
                const {recordContributors} = await import("@/lib/sync");
                await recordContributors(doc.id,doc.content);
                documentsRevisited++;
            }
            cursor=doc.id;
            inspected++;
        }
    }
    const state = {cursor};
    await prisma.administratorLookup.upsert({
        where:{key:CURSOR_KEY},
        create:{key:CURSOR_KEY,mention:"",status:"cursor",evidence:state,model:"none",expiresAt:new Date("9999-01-01")},
        update:{evidence:state,checkedAt:new Date()},
    });
    return {documentsRevisited};
}
