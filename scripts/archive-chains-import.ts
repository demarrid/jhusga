/** Replace the previous scan-per-row import with the report's first 20 chains. */
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {archiveDocumentContent} from '../lib/archive-transcription';
import type {DriveFile} from '../lib/drive';
process.loadEnvFile('.env');
process.env.AI_API_KEY='';
process.env.ADMINISTRATOR_LOOKUP_ENABLED='false';
type Chain={title:string;dateLabel:string;start:number;end:number;reportSource:string;files:(DriveFile & {rotation?:number})[]};
type Scan={rotation?:number;id:string;status:string;modifiedTime:string|null;content:string;pages:{text:string}[];flags:string[];quality:string[]};
const base='.archive-local/';
async function main(){
 const apply=process.argv.includes('--apply');
 const chains:Chain[]=JSON.parse(await readFile(base+'chains-plan.json','utf8'));
 if(chains.length!==20)throw Error('This review batch must contain exactly 20 documents');
 const prepared=[];
 for(const chain of chains){
  if(chain.files.length!==chain.end-chain.start+1)throw Error('Incomplete image chain');
  const scans:Scan[]=[];
  for(const [i,file] of chain.files.entries()){
   if(file.name!==`IMG_${chain.start+i}.HEIC`)throw Error('Image ordering mismatch');
   const scan:Scan=JSON.parse(await readFile(base+'text/'+file.id+'.json','utf8'));
   if(scan.id!==file.id||scan.status!=='complete'||scan.modifiedTime!==file.modifiedTime||(scan.rotation||0)!==(file.rotation||0)||!scan.pages.some(p=>p.text.trim()))throw Error('Incomplete OCR: '+file.name);
   scans.push(scan);
  }
  if(chain.start===2472)scans[0].quality.push('Handwritten document: automated transcription requires manual comparison with all four source images');
  const content=archiveDocumentContent(scans.map(scan=>scan.content),chain.files.map(file=>({name:file.name,url:file.webViewLink!})));
  const dates:Record<string,string>={'April 23, 1980':'1980-04-23','September 11, 1991':'1991-09-11','October 31, 1979':'1979-10-31','September 13th, 1979':'1979-09-13','September 8th, 1981':'1981-09-08','September 6th, 1981':'1981-09-06'};
  prepared.push({chain,content,hash:createHash('sha256').update(content).digest('hex'),datedAt:dates[chain.dateLabel]?new Date(dates[chain.dateLabel]+'T12:00:00Z'):null,
   flags:[...new Set(scans.flatMap(s=>s.flags))],quality:scans.flatMap((s,i)=>s.quality.map(q=>chain.files[i].name+': '+q))});
 }
 await writeFile(base+'chains-preview.json',JSON.stringify(prepared,null,2));
 if(!apply){console.log({documents:prepared.length,images:prepared.reduce((n,p)=>n+p.chain.files.length,0)});return;}
 const {prisma}=await import('../lib/prisma');
 const {recordDocumentVersion}=await import('../lib/document-version-history');
 const {indexDocumentPassages}=await import('../lib/search');
 try{
  const previous: {documentId?:string}[]=JSON.parse(await readFile(base+'import-report.json','utf8'));
  const ids=previous.flatMap(r=>r.documentId?[r.documentId]:[]);
  const old=await prisma.document.findMany({where:{id:{in:ids}},include:{revisions:{include:{versions:true}},documentAnnotations:true,contributors:true,summary:true,passages:true,referencesIn:true,referencesOut:true}});
  for(const row of old)if(row.discoveredVia!=='archive'||!row.displayTitle.startsWith('Student Council archive — IMG_')||!row.content.startsWith('Automated transcription of an archival photograph.'))throw Error('Refusing to remove an unrelated or edited document: '+row.id);
  // Keep a full record of the old rows before removing only this import's IDs.
  if(old.length)await writeFile(base+'individual-import-backup.json',JSON.stringify(old,null,2));
  const results=[];
  for(const p of prepared){
   const key='archive-chain:'+p.chain.files[0].id;
   const existing=await prisma.document.findUnique({where:{driveFileId:key}});
   if(existing&&existing.contentHash!==p.hash)throw Error('Existing chain differs; review before replacing it');
   const document=existing??await prisma.$transaction(async tx=>{
    const d=await tx.document.create({data:{driveFileId:key,source:p.chain.files[0].webViewLink!,mimeType:'text/markdown',title:p.chain.title,displayTitle:p.chain.title,
     description:`${p.chain.dateLabel||'Undated'}; ${p.chain.files.length} archival photographs (IMG_${p.chain.start}–IMG_${p.chain.end}).`,folderPath:'Selections of JHU Student Council Archives',discoveredVia:'archive',sessionNumber:null,datedAt:p.datedAt,kind:'unknown',content:p.content,contentHash:p.hash,lastSyncedAt:new Date()}});
    const revision=await tx.documentRevision.create({data:{documentId:d.id,title:d.title,content:d.content,contentHash:d.contentHash}});
    await recordDocumentVersion(tx,revision.id,null,'published');return d;
   });
   await indexDocumentPassages(document.id,p.content);
   results.push({id:document.id,title:p.chain.title,date:p.chain.dateLabel,start:p.chain.start,end:p.chain.end,images:p.chain.files.length,flags:p.flags,quality:p.quality,url:'https://www.jhusga.org/documents/'+document.id});
  }
  // Retire citations before deleting old scans, so cached generated answers cannot
  // continue to claim support from a removed document.
  const annotated=old.filter(d=>d.documentAnnotations.length);
  if(annotated.length){const {reanchorDocument}=await import('../lib/sync');for(const d of annotated)await reanchorDocument(d.id,'');}
  const deleted=await prisma.document.deleteMany({where:{id:{in:old.map(d=>d.id)},discoveredVia:'archive'}});
  await writeFile(base+'chains-import-report.json',JSON.stringify({documents:results,removedIndividualScans:deleted.count},null,2));
  const lines=['# First 20 combined archival documents','',`Replaced ${deleted.count} individual image entries with ${results.length} combined documents. Dates and titles follow the archive report. Sensitivity flags are review leads, not determinations.`,''];
  for(const [i,r] of results.entries()){lines.push(`## ${i+1}. [${r.title}](${r.url})`,'',`Date: ${r.date||'not specified'}. Images: IMG_${r.start}–IMG_${r.end} (${r.images}).`,'',`Sensitivity: ${r.flags.join('; ')||'No automated flag; review still needed'}.`,`OCR review: ${r.quality.join('; ')||'No low-confidence flag'}.`,'');}
  await writeFile(base+'COMBINED-REVIEW.md',lines.join('\n'));
  console.log({combined:results.length,removedIndividualScans:deleted.count,flagged:results.filter(r=>r.flags.length).length,qualityReview:results.filter(r=>r.quality.length).length});
 }finally{await prisma.$disconnect();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});


