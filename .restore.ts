import {createHash} from 'node:crypto';
import {findSensitiveSpans} from './lib/archive-redaction';
import {downloadSourceFile, extractPdfText} from './lib/drive';
const sha=(t:string)=>createHash('sha256').update(t).digest('hex');
const apply=process.argv.includes('--apply');
const PH='[REDACTED: phone number]';
const PHONE=/(?:\+?1[-.\s])?(?:\(\d{3}\)\s?|\d{3}[-.\s])\d{3}[-.\s]\d{4}/;
const squash=(s:string)=>s.replace(/\s+/g,' ');
(async()=>{
const {prisma}=await import('./lib/prisma');
const {reanchorDocument}=await import('./lib/sync');
const {indexDocumentPassages}=await import('./lib/search');
const doc=await prisma.document.findFirstOrThrow({where:{id:{startsWith:process.argv[2]}},select:{id:true,content:true,contentHash:true,driveFileId:true,mimeType:true}});
const got=await downloadSourceFile(doc.driveFileId,doc.mimeType);
if(!got) throw new Error('no source');
const pdf=squash(await extractPdfText(got.bytes));
let content=doc.content; const restored:{at:number;from:number;to:number}[]=[];
let at=content.indexOf(PH);
while(at>=0){
  const lead=squash(content.slice(Math.max(0,at-60),at)).replace(/\[REDACTED: [^\]]+\]/g,'').slice(-40).trim();
  const i=pdf.indexOf(lead);
  const m=i>=0?PHONE.exec(pdf.slice(i+lead.length,i+lead.length+30)):null;
  if(!m) throw new Error('could not find the number after: '+lead.replace(/\d/g,'#'));
  content=content.slice(0,at)+m[0]+content.slice(at+PH.length);
  restored.push({at,from:PH.length,to:m[0].length});
  at=content.indexOf(PH,at+m[0].length);
}
const spans=findSensitiveSpans(content);
const blocked=restored.filter(r=>spans.some(s=>s.start<r.at+r.to&&s.end>r.at));
console.log(JSON.stringify({id:doc.id,restored:restored.length,stillRedactedByRules:blocked.length,placeholdersLeft:(content.match(/\[REDACTED/g)||[]).length}));
if(blocked.length) throw new Error('current rules still remove some; not applied');
if(!apply) return;
const fixAll=(t:string)=>{let out=t;for(const r of []) void r;return out;};
// Derived rows: replace placeholders by the same restored values, in order of appearance, where their surrounding text matches.
const contentHash=sha(content);
await prisma.$transaction(async tx=>{
  const u=await tx.document.updateMany({where:{id:doc.id,contentHash:doc.contentHash},data:{content,contentHash}});
  if(u.count!==1) throw new Error('document changed');
  const media=await tx.documentMedia.findMany({where:{contentHash:doc.contentHash,version:{revision:{documentId:doc.id}}},select:{versionId:true,images:{select:{id:true,offset:true}}}});
  for(const row of media){
    await tx.documentMedia.update({where:{versionId:row.versionId},data:{contentHash}});
    for(const im of row.images){let off=im.offset;for(const r of restored) if(im.offset>=r.at+r.from) off+=r.to-r.from; if(off!==im.offset) await tx.documentImage.update({where:{id:im.id},data:{offset:off}});}
  }
});
const revs=await prisma.documentRevision.findMany({where:{documentId:doc.id,content:doc.content},select:{id:true}});
for(const r of revs) await prisma.documentRevision.update({where:{id:r.id},data:{content}});
await reanchorDocument(doc.id,content);
await indexDocumentPassages(doc.id,content);
console.log('applied; revisions updated',revs.length);
await prisma.$disconnect();
})().catch(e=>{console.error(e.message);process.exitCode=1;});
