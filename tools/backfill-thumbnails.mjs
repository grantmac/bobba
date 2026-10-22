// Explicit deployment selection prevents accidentally migrating a different room.
// Defaults to a read-only inventory; --apply converts ten assets per batch.
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const args=process.argv.slice(2),index=args.indexOf('--deployment-name'),deployment=index<0?null:args[index+1];
if(!deployment||deployment.startsWith('--')||args.some((a,i)=>a!=='--apply'&&a!=='--deployment-name'&&i!==index+1)){
  console.error('Usage: node tools/backfill-thumbnails.mjs --deployment-name NAME [--apply]');process.exit(1);
}
const apply=args.includes('--apply'),cli=fileURLToPath(new URL('../node_modules/convex/bin/main.js',import.meta.url));
let cursor=null,totals={candidates:0,converted:0,sourceBytes:0,thumbnailBytes:0};
do{
  const child=spawnSync(process.execPath,[cli,'run','thumbnailBackfill:run',JSON.stringify({cursor,apply}),'--deployment-name',deployment],{encoding:'utf8'});
  if(child.status!==0){console.error(child.stderr||child.stdout);process.exit(child.status??1);}
  const result=JSON.parse(child.stdout);
  for(const key of Object.keys(totals))totals[key]+=result[key];
  console.log(JSON.stringify({apply,...totals,isDone:result.isDone}));
  if(result.isDone)break;
  if(!result.cursor||result.cursor===cursor)throw Error('Migration cursor did not advance');
  cursor=result.cursor;
}while(true);
