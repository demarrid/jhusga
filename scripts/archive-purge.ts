import {Prisma} from '@prisma/client';
import {createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {redactArchiveSecrets} from '../lib/archive-redaction';
process.loadEnvFile('.env');
const tables=['Document','DocumentRevision','DriveRevision','DocumentPassage','DocumentAnnotation','DocumentSummary','SearchAnswer','GeneratedSection'];
async function main(){const {prisma}=await import('../lib/prisma');const apply=process.argv.includes('--apply');const report:unknown[]=[];try{
 for(const table of tables){const rows=await prisma.$queryRawUnsafe<{id:string;content:string|null}[]>(`SELECT id, content FROM "${table}"`);let changed=0;
 for(const r of rows){if(!r.content)continue;const content=redactArchiveSecrets(r.content);if(content===r.content)continue;changed++;
 if(apply){if(table==='Document')await prisma.document.update({where:{id:r.id},data:{content,contentHash:createHash('sha256').update(content).digest('hex')}});
 else await prisma.$executeRawUnsafe(`UPDATE "${table}" SET content=$1 WHERE id=$2 AND content=$3`,content,r.id,r.content);}}
 report.push({table,scanned:rows.length,changed});}
 await writeFile('.archive-local/purge-progress.json',JSON.stringify({applied:apply,report},null,2));console.log(JSON.stringify({applied:apply,report}));
 }finally{await prisma.$disconnect();}}main().catch(e=>{console.error(e.name);process.exitCode=1;});
