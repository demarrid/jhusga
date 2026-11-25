import { writeFileSync, readFileSync } from "node:fs";
import { prisma } from "./lib/prisma";
import { renderDocument, runsText } from "./lib/render";
import { presentBill } from "./lib/bill-presentation";
process.loadEnvFile(".env");
async function main() {
 const docs: {id:string;title:string;content:string;kind:string;sessionNumber:number|null}[]=JSON.parse(readFileSync("/tmp/jhusga-bills.json","utf8"));
 const missed=docs.filter(d=>!presentBill(renderDocument(d.content,[])).header.length);
 console.log(JSON.stringify({total:docs.length,missed:missed.length,older:docs.filter(d=>d.sessionNumber===106).length, failures:missed.map(d=>({id:d.id,title:d.title,session:d.sessionNumber,opening:d.content.slice(0,1100), blocks:renderDocument(d.content,[]).slice(0,20).map(b=>({kind:b.kind,text:"runs" in b ? runsText(b.runs).slice(0,180):JSON.stringify(b).slice(0,250)}))}))},null,2));
}
main().finally(()=>prisma.$disconnect());

