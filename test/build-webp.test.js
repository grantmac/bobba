import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Jimp} from 'jimp';
import sharp from 'sharp';
import {convertStaticImages} from '../tools/build-webp.mjs';

test('build converts nested static images losslessly and leaves vectors and source folders alone',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'static-webp-'));
  try{
    const dist=join(dir,'dist');await mkdir(join(dist,'nested'),{recursive:true});
    const png=await new Jimp({width:10,height:12,color:0x12345600}).getBuffer('image/png');
    await writeFile(join(dir,'original.png'),png);
    await writeFile(join(dist,'nested','sprite.png'),png);
    await writeFile(join(dist,'logo.svg'),'<svg/>');
    const result=await convertStaticImages(dist);
    assert.equal(result.files,1);
    await assert.rejects(stat(join(dist,'nested','sprite.png')),{code:'ENOENT'});
    const webp=await readFile(join(dist,'nested','sprite.png.webp'));
    assert.equal((await sharp(webp).metadata()).format,'webp');
    assert.deepEqual(await sharp(webp).ensureAlpha().raw().toBuffer(),await sharp(png).ensureAlpha().raw().toBuffer());
    assert.deepEqual(await readFile(join(dir,'original.png')),png);
    assert.equal(await readFile(join(dist,'logo.svg'),'utf8'),'<svg/>');
    assert.equal((await convertStaticImages(dist)).files,0);
  }finally{await rm(dir,{recursive:true,force:true});}
});
