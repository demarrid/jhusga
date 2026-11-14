import { mkdir, writeFile } from "node:fs/promises";
process.loadEnvFile('.env');
async function main() {
 const {prisma}=await import('../lib/prisma');
 try {
 const docs=await prisma.document.findMany({where:{OR:[{kind:'unknown'},{id:'236a176e-6846-4c49-a24c-5980a6f8600f'}]},select:{id:true,driveFileId:true,title:true,displayTitle:true,kind:true,sessionNumber:true,folderPath:true,mimeType:true,content:true,meetingRole:true}});
 const totals=await prisma.document.groupBy({by:['sessionNumber'],_count:{_all:true}});
 await mkdir('.archive-local',{recursive:true});
 await writeFile('.archive-local/unknown-audit.json',JSON.stringify({totals,docs},null,2));
 console.log(JSON.stringify({totals,unknown:docs.length,target:docs.find(d=>d.id==='236a176e-6846-4c49-a24c-5980a6f8600f'),current:docs.filter(d=>d.sessionNumber===114).map(d=>({...d,content:d.content.slice(0,2200)}))},null,2));
 }finally{await prisma.$disconnect();}
}
main();
