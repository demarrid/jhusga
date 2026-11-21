/** Verify one archive import batch: records, Drive source links, revisions, search
 * passages, summaries, duplicate accounting, and a sample of live public pages.
 *   npx tsx scripts/archive-verify-batch.ts <prefix>  (e.g. new-20261121) */
import {readFile,writeFile} from 'node:fs/promises';
process.loadEnvFile('.env');
type Entry={id:string;key:string;title:string;status:string;sourceIds:string[]};
async function main(){
 const prefix=process.argv[2];if(!prefix)throw Error('Pass the batch prefix');
 const base='.archive-local/'+prefix+'-';
 const report=JSON.parse(await readFile(base+'publication-report.json','utf8')) as Entry[];
 const duplicates=JSON.parse(await readFile(base+'duplicates.json','utf8')) as {key:string}[];
 const matches=JSON.parse(await readFile(base+'matches.json','utf8')) as {id:string}[];
 const {prisma}=await import('../lib/prisma');
 const failures:string[]=[];
 try{
  const rows=await prisma.document.findMany({where:{id:{in:report.map(r=>r.id)}},select:{id:true,source:true,content:true,discoveredVia:true,summary:{select:{status:true}},_count:{select:{passages:true,revisions:true}}}});
  if(rows.length!==report.length)failures.push(`Expected ${report.length} records, found ${rows.length}`);
  for(const entry of report){
   const row=rows.find(r=>r.id===entry.id);if(!row)continue;
   if(row.discoveredVia!=='archive')failures.push(entry.title+': not an archive record');
   if(!entry.sourceIds.every(id=>row.source.includes(id)||row.content.includes(id)))failures.push(entry.title+': Drive source link missing');
   if(row.content.trim()&&!row._count.passages)failures.push(entry.title+': search index missing');
   if(!row._count.revisions)failures.push(entry.title+': revision missing');
   if(!row.summary||!['fresh','empty'].includes(row.summary.status))failures.push(entry.title+': summary not current');
  }
  const accounted=new Set([...report.flatMap(r=>r.sourceIds),...duplicates.map(d=>d.key)]);
  const unaccounted=matches.filter(m=>!accounted.has(m.id));
  if(unaccounted.length)failures.push(`${unaccounted.length} source files unaccounted for`);
  const live=[];
  for(const entry of [report[0],report[Math.floor(report.length/2)],report[report.length-1]]){
   const url='https://www.jhusga.org/documents/'+entry.id;const response=await fetch(url);const html=await response.text();
   const ok=response.status===200&&entry.sourceIds.some(id=>html.includes(id));live.push({title:entry.title,url,status:response.status,sourceLink:ok});
   if(!ok)failures.push('Live check failed: '+url);
  }
  const result={documents:rows.length,duplicatesSkipped:duplicates.length,sourceFiles:matches.length,searchPassages:rows.reduce((n,r)=>n+r._count.passages,0),live,failures};
  await writeFile(base+'verification.json',JSON.stringify(result,null,2));
  console.log(JSON.stringify(result,null,2));
  if(failures.length)process.exitCode=1;
 }finally{await prisma.$disconnect();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
