/** Refresh the same 20 records, preserving URLs, revisions, and citation integrity. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {archiveDocumentContent} from '../lib/archive-transcription';
process.loadEnvFile('.env');process.env.AI_API_KEY='';
type Chain={start:number;files:{id:string;name:string;webViewLink:string}[]};
async function main(){
 if(process.argv.includes('--apply'))throw Error('Use archive-publish.ts to preserve image-reviewed transcriptions. This legacy raw-OCR script is preview-only.');
 const apply=false;
 const plan:Chain[]=JSON.parse(await readFile('.archive-local/chains-plan.json','utf8'));
 const {prisma}=await import('../lib/prisma');
 const {recordDocumentVersion}=await import('../lib/document-version-history');
 const {indexDocumentPassages}=await import('../lib/search');
 const {reanchorDocument}=await import('../lib/sync');
 try{
  await mkdir('.archive-local/reflow-preview',{recursive:true});
  const prepared=[];
  for(const chain of plan){
   const document=await prisma.document.findUniqueOrThrow({where:{driveFileId:'archive-chain:'+chain.files[0].id}});
   if(document.discoveredVia!=='archive')throw Error('Unexpected document');
   const scans=await Promise.all(chain.files.map(async f=>JSON.parse(await readFile('.archive-local/text/'+f.id+'.json','utf8')) as {content:string;status:string}));
   if(scans.some(s=>s.status!=='complete'))throw Error('Incomplete OCR');
   const content=archiveDocumentContent(scans.map(s=>s.content),chain.files.map(f=>({name:f.name,url:f.webViewLink})));
   const hash=createHash('sha256').update(content).digest('hex');
   await writeFile(`.archive-local/reflow-preview/${chain.start}.md`,content);
   prepared.push({document,content,hash});
  }
  if(!apply){console.log({preview:prepared.length});return;}
  const stamp=new Date().toISOString().replace(/[:.]/g,'-');
  await writeFile(`.archive-local/pre-reflow-${stamp}.json`,JSON.stringify(prepared.map(p=>p.document),null,2));
  let changed=0;
  for(const {document,content,hash} of prepared){
   if(document.contentHash!==hash){
    await prisma.$transaction(async tx=>{
     const updated=await tx.document.updateMany({where:{id:document.id,contentHash:document.contentHash},data:{content,contentHash:hash}});
     if(updated.count!==1)throw Error('Document changed during cleanup');
     const revision=await tx.documentRevision.upsert({where:{documentId_contentHash:{documentId:document.id,contentHash:hash}},create:{documentId:document.id,title:document.title,content,contentHash:hash},update:{}});
     await recordDocumentVersion(tx,revision.id,null,'published');
     await tx.documentSummary.updateMany({where:{documentId:document.id,status:{in:['fresh','empty']}},data:{status:'stale'}});
    });changed++;
   }
   await reanchorDocument(document.id,content);
   await indexDocumentPassages(document.id,content);
  }
  console.log({documents:prepared.length,changed});
 }finally{await prisma.$disconnect();}
}main().catch(e=>{console.error(e);process.exitCode=1;});
