// Rebuild the shipped telephone with the same pipeline used by preview_asset.
import {readFile,writeFile} from 'node:fs/promises';
import {prepareAsset,readImage,splitSheet} from '../../shared/sprite-build.js';
let serial=0;
const {spec}=await prepareAsset({name:'Red telephone',kind:'tabletop',width:1,depth:1},splitSheet(await readImage(await readFile(new URL('./telephone-sheet.png',import.meta.url)))),async buffer=>{
  const file=`homepage-telephone-${serial++}.webp`;
  await writeFile(new URL('../../public/assets/furniture/'+file,import.meta.url),buffer);return file;
});
const telephone={...spec,id:'homepage_telephone',parts:spec.parts.map(({storageId,...p})=>({...p,file:storageId,layer:'base',z:0,ink:8,alphaPrepared:true}))};
const destination=new URL('../../shared/homepage-furniture.json',import.meta.url);
const existing=JSON.parse(await readFile(destination,'utf8').catch(()=>'[]'));
await writeFile(destination,JSON.stringify([telephone,...existing.filter(d=>d.id!==telephone.id)],null,2)+'\n');
