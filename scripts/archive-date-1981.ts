process.loadEnvFile('.env');async function main(){const {prisma}=await import('../lib/prisma');console.log(await prisma.document.update({where:{id:'660a2bf7-e954-40cb-99a7-0e5e4b9c72cc'},data:{datedAt:new Date('1981-01-01T12:00:00Z')},select:{title:true,datedAt:true}}));await prisma.$disconnect();}main();
export {};
