import "dotenv/config";
import { writeFileSync } from "node:fs";
import { prisma } from "../lib/prisma";
async function main() {
  const cons = await prisma.document.findMany({ where: { kind: "guiding.constitution", datedAt: { gte: new Date("2025-01-01") } }, select: { id: true, title: true, displayTitle: true, datedAt: true, content: true }, orderBy: { datedAt: "asc" } });
  for (const c of cons) { console.log(c.id, c.datedAt?.toISOString().slice(0,10), c.displayTitle || c.title, c.content.length); writeFileSync(`/tmp/con-${c.id.slice(0,8)}.txt`, c.content.replace(/\s+\n/g, "\n")); }
}
main().finally(() => prisma.$disconnect());
