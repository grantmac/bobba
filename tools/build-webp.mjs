import {readdir,readFile,writeFile,unlink} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {decodeImage,encodeWebp} from '../shared/image-codec.js';

// Run after Vite copies public/. Keep authoring originals in public/, publish
// only lossless WebP. Rewrites preserve catalogue URLs and bookmarks.
export async function convertStaticImages(directory){
  const files=[];
  async function scan(path){
    for(const entry of await readdir(path,{withFileTypes:true})){
      const file=join(path,entry.name);
      if(entry.isDirectory())await scan(file);
      else if(entry.isFile()&&/\.(png|jpe?g)$/i.test(entry.name))files.push(file);
    }
  }
  await scan(directory);
  let index=0,sourceBytes=0,webpBytes=0;
  async function worker(){
    while(index<files.length){
      const file=files[index++],source=await readFile(file),image=await decodeImage(source);
      const webp=await encodeWebp(image),decoded=await decodeImage(webp);
      if(decoded.width!==image.width||decoded.height!==image.height||!decoded.bitmap.data.equals(image.bitmap.data))throw Error(`WebP conversion changed pixels: ${file}`);
      await writeFile(file+'.webp',webp,{flag:'wx'});
      await unlink(file);sourceBytes+=source.length;webpBytes+=webp.length;
    }
  }
  await Promise.all(Array.from({length:4},worker));
  return {files:files.length,sourceBytes,webpBytes,savedBytes:sourceBytes-webpBytes};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  console.log(JSON.stringify(await convertStaticImages(resolve('dist'))));
}
