/** Summarize only the documents in one archive import batch.
 *   npx tsx scripts/archive-summarize-batch.ts .archive-local/<prefix>-publication-report.json */
import {readFile} from 'node:fs/promises';
process.loadEnvFile('.env');
async function main(){
 const reportPath=process.argv[2];
 if(!reportPath)throw Error('Pass a publication report path');
 const ids=(JSON.parse(await readFile(reportPath,'utf8')) as {id?:string}[]).flatMap(r=>r.id?[r.id]:[]);
 const {summarizeDocument}=await import('../lib/summarize');
 const counts:Record<string,number>={};let next=0;
 async function worker(){while(next<ids.length){const id=ids[next++];try{
  const result=await summarizeDocument(id,{});
  const status=result.skipped?'current':result.status;counts[status]=(counts[status]||0)+1;
  console.log(`${status.padEnd(8)} ${result.title.slice(0,60).padEnd(62)} ${result.error??`${result.citationsVerified} cited, ${result.citationsRejected} rejected`}`);
 }catch(e){counts.error=(counts.error||0)+1;console.log('error   ',id,String(e).slice(0,200));}}}
 await Promise.all(Array.from({length:4},worker));
 console.log(counts);
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{const {prisma}=await import('../lib/prisma');await prisma.$disconnect();});
