import {classifyDocument} from '../lib/kinds';
/** Resumable full-archive publication. Vision results never replace raw OCR evidence. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {cleanArchiveTranscription} from '../lib/archive-transcription';
process.loadEnvFile('.env');process.env.AI_API_KEY='';process.env.ADMINISTRATOR_LOOKUP_ENABLED='false';
const base='.archive-local/';
type File={id:string;name:string;webViewLink:string;mimeType:string;folderPath:string};
type Chain={title:string;dateLabel:string;start:number;end:number;missingImages?:string[];files:File[]};
type Vision={id:string;status:string;content:string;nonDocument:boolean;uncertainties:string[];sensitiveFlags:string[];handwritten:boolean};
type Native=File&{status:string;sha256:string;content:string;flags:string[];quality:string[];error?:string;parts:{content:string;method:string;visionId?:string}[]};
type RecordData={key:string;title:string;source:string;mimeType:string;folderPath:string;content:string;description:string;sessionNumber:number|null;datedAt:Date|null;flags:string[];quality:string[];sourceIds:string[]};
async function readJson<T>(name:string):Promise<T>{return JSON.parse(await readFile(base+name,'utf8')) as T;}
function assemble(parts:string[]){let text='';for(const raw of parts){const part=raw.trim();if(!part)continue;
 if(text&&/[a-z]-$/.test(text)&&/^[a-z]/.test(part))text=text.slice(0,-1)+part;
 else if(text&&!/[.!?:;\]\d]$/.test(text)&&/^[a-z]/.test(part))text+=' '+part;
 else text+=(text?'\n\n':'')+part;
 }return text;}
function withSources(content:string,files:File[]){return content.trim()+'\n\n## Sources\n\n'+files.map(f=>`[${f.name}](${f.webViewLink})`).join(' · ');}
function exactDate(label:string){const clean=label.replace(/(\d)(st|nd|rd|th)\b/g,'$1');if(!/^[A-Z][a-z]+ \d{1,2},? (?:19|20)\d{2}$/.test(clean))return null;const date=new Date(clean+' 12:00:00 GMT');return Number.isNaN(date.getTime())?null:date;}
async function main(){
 const apply=process.argv.includes('--apply');const prepared:RecordData[]=[];const pending:{key:string;title:string;reason:string}[]=[];
 const aliases=await readJson<Record<string,string[]>>('native-vision-aliases.json').catch(()=>({}));const canonical=new Map<string,string>();for(const [id,others] of Object.entries(aliases))for(const other of others)canonical.set(other,id);
 async function vision(id:string){const result=await readJson<Vision>('vision/'+(canonical.get(id)??id)+'.json');if(result.status!=='complete')throw Error('Vision review pending: '+id);return result;}
 const chains=await readJson<Chain[]>('chains-plan.json');
 for(const g of chains){try{
  const pages=await Promise.all(g.files.map(f=>vision(f.id)));
  const content=assemble(pages.map(p=>p.content));if(!content.trim())throw Error('No readable primary document');
  const quality=pages.flatMap((p,i)=>p.uncertainties.map(q=>g.files[i].name+': '+q));const stated=/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/.exec(pages[0]?.content.slice(0,250)||'');const reportDate=exactDate(g.dateLabel);if(stated&&reportDate){const year=Number(stated[3])<100?1900+Number(stated[3]):Number(stated[3]);if(reportDate.getUTCFullYear()!==year||reportDate.getUTCMonth()+1!==Number(stated[1])||reportDate.getUTCDate()!==Number(stated[2]))quality.push('Unresolved date discrepancy: archive report says '+g.dateLabel+'; transcribed heading reads '+stated[0]);}if(g.missingImages?.length)quality.push('Image sequence gaps: '+g.missingImages.join(', ')+' (not present locally or in Drive)');
  prepared.push({key:'archive-chain:'+g.files[0].id,title:g.title,source:g.files[0].webViewLink,mimeType:'text/markdown',folderPath:'Selections of JHU Student Council Archives',content:withSources(content,g.files),description:`${g.dateLabel||'Undated'}. Image-reviewed transcription of ${g.files.length} archival photographs.${quality.length?' Some readings require review.':''}`,sessionNumber:null,datedAt:exactDate(g.dateLabel),flags:[...new Set(pages.flatMap(p=>p.sensitiveFlags))],quality,sourceIds:g.files.map(f=>f.id)});
 }catch(e){pending.push({key:'archive-chain:'+g.files[0].id,title:g.title,reason:String(e)});}}
 const matched=await readJson<File[]>('past-matches.json');
 for(const f of matched){try{
  const doc=await readJson<Native>('native/'+f.id+'.json');
  if(doc.status==='non-document'){pending.push({key:f.id,title:f.name,reason:'Media/container asset; inventoried, not a text document'});continue;}
  if(doc.status==='error')throw Error(doc.error||'Extraction error');
  const parts:string[]=[];const flags=[...(doc.flags||[])];const quality=[...(doc.quality||[])];
  for(const part of doc.parts||[]){if(part.visionId){const p=await vision(part.visionId);parts.push(p.content);flags.push(...p.sensitiveFlags);quality.push(...p.uncertainties);}else parts.push(part.method==='embedded PDF text'?cleanArchiveTranscription([part.content]):part.content);}
  if(doc.parts.some(p=>p.method==='Form response CSV in source ZIP'))flags.push('Form responses: review personal/contact information and free-text answers');
  if(/(?:application.*responses|survey.*data|attendance|roster|personal.*information)/i.test(f.name))flags.push('Personal responses or roster: review named individuals and contact details');
  const years=[...f.folderPath.matchAll(/((?:19|20)\d{2})\s*[-–]\s*(?:19|20)\d{2}/g)];const sessionNumber=years.length?Number(years[years.length-1][1])-1912:null;
  const content=assemble(parts);
  prepared.push({key:f.id,title:f.name.replace(/\.(docx?|pdf|pptx?|xlsx?|csv|html?|pages)$/i,''),source:f.webViewLink,mimeType:f.mimeType,folderPath:f.folderPath,content:content.trim()?withSources(content,[f]):'',description:doc.status==='source-defect'?'Source file contains no document body; see original.':doc.status==='empty'?'Source contains no extractable text; see original.':quality.length?'Archived source transcription; some passages require review.':'Archived document transcribed from the linked original.',sessionNumber,datedAt:null,flags:[...new Set(flags)],quality,sourceIds:[f.id]});
 }catch(e){pending.push({key:f.id,title:f.name,reason:String(e)});}}
 // Explicitly numbered PDF parts form a single document. Do not merge other
 // similarly named files or alternative file formats.
 const groups=new Map<string,RecordData[]>();for(const r of prepared){if(r.mimeType!=='application/pdf')continue;const title=r.title.replace(/\s+pt\.?\s*\d+\s*$/i,'');const key=r.folderPath+'|'+title.toLowerCase();groups.set(key,[...(groups.get(key)||[]),r]);}
 const expectedGroups=new Map<string,File[]>();for(const f of matched){if(f.mimeType!=='application/pdf')continue;const title=f.name.replace(/\.pdf$/i,'').replace(/\s+pt\.?\s*\d+\s*$/i,'');const key=f.folderPath+'|'+title.toLowerCase();expectedGroups.set(key,[...(expectedGroups.get(key)||[]),f]);}
 const removed=new Set<string>();
 for(const [key,values] of groups){const expected=expectedGroups.get(key)||[];if(expected.length>1&&expected.some(f=>/\spt\.?\s*\d+\.pdf$/i.test(f.name))&&values.length!==expected.length){for(const v of values){removed.add(v.key);pending.push({key:v.key,title:v.title,reason:'Waiting for every numbered PDF part before publication'});}}}
 for(const values of groups.values())if(values.length>1&&values.some(r=>/\spt\.?\s*\d+$/i.test(r.title))){values.sort((a,b)=>Number(/pt\.?\s*(\d+)$/i.exec(a.title)?.[1]||1)-Number(/pt\.?\s*(\d+)$/i.exec(b.title)?.[1]||1));const first=values[0];first.title=first.title.replace(/\s+pt\.?\s*\d+\s*$/i,'');const body=assemble(values.map(v=>v.content.split('\n\n## Sources\n')[0]));const sources=values.map(v=>({id:v.key,name:v.title,webViewLink:v.source,mimeType:v.mimeType,folderPath:v.folderPath}));first.content=withSources(body,sources);first.flags=[...new Set(values.flatMap(v=>v.flags))];first.quality=values.flatMap(v=>v.quality);first.sourceIds=values.flatMap(v=>v.sourceIds);for(const other of values.slice(1))removed.add(other.key);}
 const records=prepared.filter(r=>!removed.has(r.key));await writeFile(base+'publication-pending.json',JSON.stringify(pending,null,2));
 await writeFile(base+'format-input.json',JSON.stringify(records));
 for(const r of records){try{const f=await readJson<{original:string;content:string}>('formatted/'+createHash('sha256').update(r.key).digest('hex')+'.json');if(f.original===r.content&&f.content.replace(/\s/g,'')===r.content.replace(/\s/g,''))r.content=f.content;}catch{}}
 if(!apply){console.log({ready:records.length,pending:pending.length});return;}
 const {prisma}=await import('../lib/prisma');const {recordDocumentVersion}=await import('../lib/document-version-history');const {indexDocumentPassages}=await import('../lib/search');const {reanchorDocument}=await import('../lib/sync');
 const report:{key:string;title:string;status:string;id?:string;flags?:string[];quality?:string[];sourceIds?:string[];error?:string}[]=[];
 await mkdir(base+'publish-backups',{recursive:true});let next=0;
 async function worker(){while(next<records.length){const r=records[next++];try{
  const existing=await prisma.document.findUnique({where:{driveFileId:r.key}});const hash=createHash('sha256').update(r.content).digest('hex');
  if(existing&&existing.discoveredVia!=='archive'){report.push({key:r.key,title:r.title,id:existing.id,status:'existing-site-record',flags:r.flags,quality:r.quality,sourceIds:r.sourceIds});continue;}
  if(existing&&existing.contentHash!==hash)await writeFile(base+'publish-backups/'+existing.id+'-'+existing.contentHash+'.json',JSON.stringify(existing));
  const document=await prisma.$transaction(async tx=>{
   if(existing&&existing.contentHash===hash)return existing;
   const data={kind:existing?.kind && existing.kind!=='unknown' ? existing.kind : classifyDocument({name:r.title,folderPath:r.folderPath,driveFileId:r.key,content:r.content,mimeType:r.mimeType}),title:r.title,displayTitle:r.title,source:r.source,mimeType:r.mimeType,folderPath:r.folderPath,description:r.description,sessionNumber:r.sessionNumber,datedAt:existing?.datedAt ?? r.datedAt,content:r.content,contentHash:hash,discoveredVia:'archive',lastSyncedAt:new Date()};
   let d;if(existing){const updated=await tx.document.updateMany({where:{id:existing.id,contentHash:existing.contentHash},data});if(updated.count!==1)throw Error('Concurrent document change');d={...existing,...data};}else d=await tx.document.create({data:{driveFileId:r.key,...data}});
   const revision=await tx.documentRevision.upsert({where:{documentId_contentHash:{documentId:d.id,contentHash:hash}},create:{documentId:d.id,title:d.title,content:r.content,contentHash:hash},update:{}});await recordDocumentVersion(tx,revision.id,null,'published');
   await tx.documentSummary.updateMany({where:{documentId:d.id,status:{in:['fresh','empty']}},data:{status:'stale'}});return d;
  });
  await reanchorDocument(document.id,r.content);await indexDocumentPassages(document.id,r.content);
  report.push({key:r.key,title:r.title,id:document.id,status:existing?(existing.contentHash===hash?'unchanged':'updated'):'published',flags:r.flags,quality:r.quality,sourceIds:r.sourceIds});
 }catch(e){report.push({key:r.key,title:r.title,status:'error',error:String(e)});}
 if(report.length%25===0){console.log(`${report.length}/${records.length} published/checked`);await writeFile(base+'publish-progress.json',JSON.stringify({processed:report.length,total:records.length,errors:report.filter(r=>r.status==='error').length}));}
 }}
 try{await Promise.all(Array.from({length:4},worker));await writeFile(base+'publication-report.json',JSON.stringify(report,null,2));const review=['# Full archive review','',`${report.length} documents processed; ${pending.length} pending or non-document entries. Flags are review leads, not privacy clearance.`, ''];
 for(const r of report.filter(r=>r.flags?.length||r.quality?.length||r.error)){review.push(`## [${r.title}](https://www.jhusga.org/documents/${r.id||''})`,'',`Sensitivity: ${r.flags?.join('; ')||'No automated flag'}.`,`Text/source review: ${r.quality?.join('; ')||r.error||'No additional issue'}.`,'');}
 await writeFile(base+'ALL-REVIEW.md',review.join('\n'));console.log({processed:report.length,pending:pending.length,errors:report.filter(r=>r.status==='error').length,flagged:report.filter(r=>r.flags?.length).length});
 }finally{await prisma.$disconnect();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
