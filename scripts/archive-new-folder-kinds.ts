/** Reviewed categories and titles for the 2019-2022 Dump import (read from each document's text). */
import {readFile,writeFile} from 'node:fs/promises';
process.loadEnvFile('.env');
const kinds:Record<string,string>={
 'FCC Twosday Event Funding-B-2122.17':'bill.funding',
 'Medical Ethics Discussion Panel':'bill.funding',
 'SGA Inauguration Bill':'bill.funding',
 'Beta X SGA_ Reindeer Games (1)':'bill.funding',
 'SGA-R-2021.04 - Formal Greivance Procedure':'resolution',
 'DOSL Funding Allocation FY21_SGA+SAC':'finance.record',
 'Submission of DOSL Funding Allocation FY22_SGA+SAC':'finance.record',
 'Submission of DOSL Funding Allocation FY23_SGA+SAC':'finance.record',
 'Petition for a just transition to self-operated dining.':'petition',
 'Special Forum Proposal Form Frat':'petition',
 'Amendment to the Special Forum':'petition',
 'hb0336f':'reference',
 'R46554':'reference',
 'educator-202110-students-suicide-risk':'reference',
 'JHU-Accessibility-Map_August2025':'reference',
 'NRB-Process':'reference',
 'Baltimore Mutual Aid Spreadsheet':'reference',
 'Why we ask this question_ Religion':'reference',
 "Endorsement of the Anti-ICE Coalition's Response to University":'statement',
 'Perez 2022 Platform':'election',
 '2020 Voter Engagement Ambassador Program':'plan',
 'MSCAC Bill Draft':'plan',
 'Daniels Reception Topics':'notes.meeting',
};
const titles:Record<string,string>={
 'To add your name to this letter: Click here! [unclear: http://bit.ly/2S35?Fn]':'An Open Letter from Concerned Johns Hopkins University Faculty Regarding Maryland SB 793 & HB 1094 and the Creation of an Armed Private Campus Police Department',
 'TO: The Federation of State Medical Boards':'An Open Letter to Expand Telehealth Support Access Across State Lines',
};
async function main(){
 const report=JSON.parse(await readFile('.archive-local/new-20261121-publication-report.json','utf8')) as {id:string;key:string;title:string}[];
 const config=JSON.parse(await readFile('config/archive-reviewed-kinds.json','utf8')) as Record<string,string>;
 const {prisma}=await import('../lib/prisma');
 try{
  const missing=[...Object.keys(kinds),...Object.keys(titles)].filter(t=>!report.some(r=>r.title===t));
  if(missing.length)throw Error('Titles not in report: '+missing.join('; '));
  for(const r of report){
   const kind=kinds[r.title];const title=titles[r.title];
   if(!kind&&!title)continue;
   if(kind)config[r.key]=kind;
   await prisma.$transaction(async tx=>{
    await tx.document.update({where:{id:r.id},data:{...(kind?{kind}:{}),...(title?{title,displayTitle:title}:{})}});
    await tx.documentSummary.updateMany({where:{documentId:r.id},data:{status:'stale'}});
   });
  }
  await writeFile('config/archive-reviewed-kinds.json',JSON.stringify(config,null,2)+'\n');
  console.log({kinds:Object.keys(kinds).length,titles:Object.keys(titles).length});
 }finally{await prisma.$disconnect();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
