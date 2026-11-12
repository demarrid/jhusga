import {writeFile} from 'node:fs/promises';
process.loadEnvFile('.env');
async function main(){const {prisma}=await import('../lib/prisma');const ds=await prisma.document.findMany({where:{discoveredVia:'archive'},select:{id:true,title:true,content:true,contentHash:true,driveFileId:true}});await writeFile('.archive-local/live-format-audit.json',JSON.stringify(ds));console.log(ds.find(d=>d.id==='0a702cc6-0ca4-4086-9914-da46f85e577f')?.content?.slice(0,4500));await prisma.$disconnect();}main();
