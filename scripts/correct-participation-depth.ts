/** Source-backed repair of the reported participation examples. Preview by default; --apply writes. */
import { writeFile, mkdir } from 'node:fs/promises';
import { prisma } from '../lib/prisma';
import { extractContributors, nameKey } from '../lib/contributors';
import { documentMeetingRole } from '../lib/meetings';
import { DOCUMENT_CORRECTIONS } from '../config/document-corrections';

const task = 'd21bec18-d793-4f79-84dd-8ee084860b2c';
const agora = 'e1e7c174-5453-4a5e-917c-08945d29955e';
const lunch = '31962225-8f89-46ee-8ed1-09754613423d';
const controls = ['eddfeae9-6c67-4ad4-8521-1712e527ed2a', '13cc2727-4151-4f23-b9fd-992471d98eaa'];
// Shorthand identities corroborated by the participant list or contemporaneous archive credits.
const mappings: Record<string, Record<string,string>> = {
    [task]: { Abraham: 'Abraham Aini', Mahima: 'Mahima Sanghera', Sumi: 'Sumire Sumi' },
    [agora]: { Braunstein: 'Ruth Braunstein', Demarri: 'Demarri Dosunmu', Sophia: 'Sophia Baleeiro', Rain: 'Rain Cheng', Sumi: 'Sumire Sumi', Jazz: 'Jazzlyn Fernandez', Jackson: 'Jackson Morris' },
    [lunch]: { Daniels: 'Ronald J. Daniels', Hernandez: 'Rachelle Hernandez', Brown: 'Brittini Brown', Omotara: 'Omotara Tiamiyu', Tyler: 'Tyler Turner', Srigouri: 'Srigouri Oruganty', Vishnu: 'Vishnu Dontu', Imad: 'Imad Ahmed' },
};
async function main() {
    const documents = await prisma.document.findMany({where:{id:{in:[task,agora,lunch,...controls]}},include:{contributors:true}});
    if (documents.length !== 5) throw new Error('Missing reported documents');
    const additions: {documentId:string;hopkinsAffiliateId:string;name:string;role:string;evidence:string}[] = [];
    for (const document of documents.filter(d=>d.id in mappings)) {
        const extracted = extractContributors(document.content,document.title,document.kind);
        const wanted = extracted.filter(p => document.id === task ? p.role === 'involved' :
            document.id === agora ? p.role === 'present' || (p.role === 'interlocutor' && p.name in mappings[agora]!) : p.role === 'interlocutor' && p.name in mappings[lunch]!);
        for (const p of wanted) {
            const name = mappings[document.id]![p.name] ?? p.name;
            const person = await prisma.hopkinsAffiliate.findUniqueOrThrow({where:{nameKey:nameKey(name)}});
            additions.push({documentId:document.id,hopkinsAffiliateId:person.id,name,role:p.role,evidence:p.evidence});
        }
        const expected = document.id === task ? 3 : document.id === agora ? 18 : 8;
        if (wanted.length !== expected) throw new Error(`Expected ${expected} source-backed roles for ${document.title}, got ${wanted.length}`);
    }
    const lunchDoc = documents.find(d=>d.id === lunch)!;
    const metadata = { meetingRole: documentMeetingRole(lunchDoc), displayTitle: DOCUMENT_CORRECTIONS[lunchDoc.driveFileId]!.displayTitle };
    if (metadata.meetingRole !== 'minutes') throw new Error('Recorded lunch discussion missing');
    console.log(JSON.stringify({additions:additions.map(({name,role,documentId})=>({name,role,documentId})),metadata},null,2));
    if (!process.argv.includes('--apply')) return;
    await mkdir('.archive-local',{recursive:true});
    await writeFile(`.archive-local/people-depth-before-${Date.now()}.json`,JSON.stringify(documents,null,2));
    await prisma.$transaction(async tx => {
        for (const d of documents) {
            const current = await tx.document.findUniqueOrThrow({where:{id:d.id}});
            if (current.content !== d.content || current.kind !== d.kind) throw new Error('Archive changed; rerun preview');
        }
        for (const {name, ...addition} of additions) {
            const key = {documentId:addition.documentId,hopkinsAffiliateId:addition.hopkinsAffiliateId,role:addition.role};
            const data = {source:'manual',evidence:addition.evidence,note:`Source-backed participation correction: ${name}. Role reflects planning involvement, the completed meeting participant list, or an attributed speaking turn.`};
            await tx.documentContributor.upsert({where:{documentId_hopkinsAffiliateId_role:key},create:{...key,...data},update:data});
            // Replace the weaker old label only for these specifically reviewed people.
            await tx.documentContributor.deleteMany({where:{documentId:key.documentId,hopkinsAffiliateId:key.hopkinsAffiliateId,role:'mentioned',id:{in:documents.find(d=>d.id===key.documentId)!.contributors.map(c=>c.id)}}});
        }
        await tx.document.update({where:{id:lunch},data:metadata});
        for (const a of additions) {
            const row = await tx.documentContributor.findUnique({where:{documentId_hopkinsAffiliateId_role:{documentId:a.documentId,hopkinsAffiliateId:a.hopkinsAffiliateId,role:a.role}}});
            if (row?.evidence !== a.evidence) throw new Error('Saved role verification failed');
        }
        for (const id of controls) {
            const rows = await tx.documentContributor.findMany({where:{documentId:id},orderBy:{id:'asc'}});
            const before = documents.find(d=>d.id===id)!.contributors.sort((a,b)=>a.id.localeCompare(b.id));
            if (JSON.stringify(rows) !== JSON.stringify(before)) throw new Error('Mention-only control changed');
        }
    }, {timeout:30000});
    const saved = await prisma.documentContributor.findMany({where:{documentId:{in:[task,agora,lunch]},role:{in:['involved','present','interlocutor','mentioned']}},select:{documentId:true,role:true,hopkinsAffiliate:{select:{name:true}}}});
    console.log('Verified saved roles:',JSON.stringify(saved));
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>prisma.$disconnect());
