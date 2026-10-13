import { prisma } from "@/lib/prisma";
async function main() {
  const d = await prisma.document.findFirst({ where: { title: process.argv[2] }, select: { id: true, content: true } });
  console.log(d?.id); console.log(d?.content?.slice(0, Number(process.argv[3] ?? 3000)));
  await prisma.$disconnect();
}
main();
