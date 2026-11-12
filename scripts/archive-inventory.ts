/** Inventory every folder, including folders the current-session sync excludes. */
import { mkdir, writeFile } from 'node:fs/promises';
process.loadEnvFile('.env');
async function main() {
 const {getFile,listFolderChildren,FOLDER_MIME} = await import('../lib/drive');
 const output = process.argv[3] || '.archive-local/inventory.json';
 const rootId = process.argv[2] || '1y9Pae1O56ZPaSnTMQPTxgABaqD66kzQq';
 const root = await getFile(rootId); if (!root) throw Error('Archive folder unavailable');
 const queue = [{id:rootId,path:root.name}]; const visited = new Set<string>();
 const files = new Map(); const errors: object[] = [];
 for (let i=0;i<queue.length;i++) {
  const folder=queue[i]; if(visited.has(folder.id)) continue; visited.add(folder.id);
  try {
   for (const child of await listFolderChildren(folder.id)) {
    if (/trainers?[ _-]*feedback/i.test(child.name)) continue;
    const target=child.shortcutTo ? await getFile(child.shortcutTo.id) : child;
    if(!target) {errors.push({id:child.id,path:folder.path,error:'Shortcut target unavailable'});continue;}
    if(target.mimeType===FOLDER_MIME) queue.push({id:target.id,path:folder.path+'/'+child.name});
    else if(!files.has(target.id)) files.set(target.id,{...target,folderPath:folder.path});
   }
  } catch(error) {errors.push({id:folder.id,path:folder.path,error:String(error)});}
  console.log(`${i+1}/${queue.length} folders; ${files.size} files`);
 }
 await mkdir('.archive-local',{recursive:true});
 await writeFile(output,JSON.stringify({root,completedAt:new Date(),folders:visited.size,files:[...files.values()],errors},null,2));
 console.log(JSON.stringify({folders:visited.size,files:files.size,errors:errors.length,mimeTypes:[...files.values()].reduce((a,f)=>(a[f.mimeType]=(a[f.mimeType]||0)+1,a),{})},null,2));
 if(errors.length) process.exitCode=1;
}
main().catch(e=>{console.error(e);process.exitCode=1;});
