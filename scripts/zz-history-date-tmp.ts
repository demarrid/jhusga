export {};
process.loadEnvFile('.env');
async function main() {
 const { prisma } = await import('../lib/prisma');
 try {
 const events = await prisma.historyEvent.findMany({where:{topic:{slug:'sexual-violence'},OR:[{title:{contains:'seminar',mode:'insensitive'}},{content:{contains:'rape-awareness',mode:'insensitive'}}]},include:{citations:{include:{annotation:{include:{document:true}}}}}});
 console.log(JSON.stringify(events, (key,value)=> ['embedding'].includes(key)?undefined:value,2));
 }finally{await prisma.$disconnect();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
