/** Find archive dates that came from ranges like 10/5-10/9 read as 10/5/2010, and clear them.
 * Run without --apply to list; --apply clears those dates (or replaces them with a single
 * unambiguous date from the corrected parser). */
import {readFile,writeFile} from 'node:fs/promises';
import {archiveDateCandidates} from '../lib/archive-dates';
import {expandCalendarYear} from '../lib/calendar-year';
process.loadEnvFile('.env');
async function main(){
 const apply=process.argv.includes('--apply');
 const {prisma}=await import('../lib/prisma');
 try{
  const docs=await prisma.document.findMany({where:{discoveredVia:'archive',datedAt:{not:null}},select:{id:true,title:true,content:true,datedAt:true}});
  const precision=JSON.parse(await readFile('config/archive-date-precision.json','utf8')) as Record<string,unknown>;
  const found=[];
  for(const d of docs){
   const day=d.datedAt!.toISOString().slice(0,10);
   const text=d.title+'\n'+d.content;
   const ranged=[...text.matchAll(/\b(\d{1,2})([\/_-])(\d{1,2})([\/_-])(\d{2}|\d{4})\b(\S?)/g)].find(m=>{
    if(m[2]===m[4]&&!/^[\/_-]$/.test(m[6]))return false;
    const y=expandCalendarYear(+m[5]);const iso=`${y}-${String(+m[1]).padStart(2,'0')}-${String(+m[3]).padStart(2,'0')}`;
    return iso===day;
   });
   if(!ranged)continue;
   const days=[...new Set(archiveDateCandidates(d.title,d.content).filter(c=>c.precision==='day').map(c=>c.date))];
   const replacement=days.length===1?days[0]:null;
   found.push({id:d.id,title:d.title,wrongDate:day,evidence:ranged[0],replacement});
   if(apply){await prisma.document.update({where:{id:d.id},data:{datedAt:replacement?new Date(replacement):null}});delete precision[d.id];}
  }
  if(apply)await writeFile('config/archive-date-precision.json',JSON.stringify(precision,null,2));
  await writeFile('.archive-local/date-range-audit.json',JSON.stringify(found,null,2));
  console.log(JSON.stringify({apply,affected:found.length,found},null,2));
 }finally{await prisma.$disconnect();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
