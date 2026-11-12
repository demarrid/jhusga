import {readFile,writeFile} from 'node:fs/promises';process.loadEnvFile('.env');
type Published={key:string;title:string;id:string;status:string;sourceIds:string[];flags:string[];quality:string[]};
async function main(){const report:Published[]=JSON.parse(await readFile('.archive-local/publication-report.json','utf8'));const pending:{key:string;reason:string}[]=JSON.parse(await readFile('.archive-local/publication-pending.json','utf8'));const inventory=JSON.parse(await readFile('.archive-local/past-drive-inventory.json','utf8')) as {files:{id:string;name:string;mimeType:string}[]};
 const {prisma}=await import('../lib/prisma');try{
 const rows=await prisma.document.findMany({where:{id:{in:report.map(r=>r.id)}},select:{id:true,driveFileId:true,source:true,content:true,discoveredVia:true,_count:{select:{passages:true,revisions:true}}}});
 if(rows.length!==report.length||new Set(report.map(r=>r.id)).size!==report.length)throw Error('Missing or duplicate document records');
 let textless=0;const failures=[];
 for(const entry of report){const row=rows.find(r=>r.id===entry.id)!;if(!entry.sourceIds.some(id=>row.source.includes(id)))failures.push(entry.key+': source mismatch');
 if(row.content.trim()){if(!row._count.passages)failures.push(entry.key+': search index missing');}else textless++;
 if(row.discoveredVia==='archive'&&!row._count.revisions)failures.push(entry.key+': revision missing');
 if(entry.key.startsWith('archive-chain:')){for(const id of entry.sourceIds)if(!row.content.includes(id))failures.push(entry.key+': image link missing');if(/^#{2,3} (?:Photograph \d|Left page or column|Right page or column)/m.test(row.content))failures.push(entry.key+': OCR layout heading remains');}}
 const accounted=new Set([...report.flatMap(r=>r.sourceIds),...pending.map(r=>r.key)]);const unassigned=inventory.files.filter(f=>!accounted.has(f.id));
 if(unassigned.some(f=>f.name!=='IMG_2368.HEIC'&&!f.name.endsWith('.zip')))failures.push('Unexpected unassigned sources');
 const samples=[report.find(r=>r.key==='archive-chain:1DzAJUpTgxOmP-f6JRYAgW14_MGP9HbJz'),report.find(r=>r.sourceIds.length>1&&!r.key.startsWith('archive-chain:')),report.find(r=>r.title.includes('1981 Constitution')),report.find(r=>r.title.includes('Minutes')&&!r.key.startsWith('archive-chain:'))].filter(Boolean) as Published[];
 const live=[];for(const sample of samples){const url='https://www.jhusga.org/documents/'+sample.id;const response=await fetch(url);const html=await response.text();const sourcePresent=sample.sourceIds.some(id=>html.includes(id));live.push({title:sample.title,url,status:response.status,sourcePresent});if(response.status!==200||!sourcePresent)failures.push('Live check failed: '+sample.title);}
 const result={documents:rows.length,photoChains:report.filter(r=>r.key.startsWith('archive-chain:')).length,sourceFilesCovered:new Set(report.flatMap(r=>r.sourceIds)).size,nonDocumentAssets:pending.length,sourceOnlyRecords:textless,flaggedForSensitivity:report.filter(r=>r.flags.length).length,flaggedForTextReview:report.filter(r=>r.quality.length).length,inventoryFiles:inventory.files.length,unassigned,live,failures};
 await writeFile('.archive-local/final-verification.json',JSON.stringify(result,null,2));console.log(result);if(failures.length)process.exitCode=1;
 }finally{await prisma.$disconnect();}}
main().catch(e=>{console.error(e);process.exitCode=1;});
