// @vitest-environment node
import {it,expect} from 'vitest';
import {convexTest} from 'convex-test';
import {Jimp} from 'jimp';
import {decodeImage} from '../shared/image-codec.js';
import schema from '../convex/schema.js';
import {internal} from '../convex/_generated/api.js';

const modules=import.meta.glob('../convex/**/*.js');
async function fixture(t){
  const image=new Jimp({width:600,height:300,color:0});
  image.scan((x,y,i)=>image.bitmap.data.set([x%64,y%32,128,(x+y)%3?255:0],i));
  const png=await image.getBuffer('image/png');
  const result=await t.run(async ctx=>{
    const ownerId=await ctx.db.insert('players',{name:'Builder',nameKey:'builder',role:'guest',look:{},route:[{x:1,z:1}],startedAt:0,direction:2,seatId:null,lastSeen:0,lastChat:0});
    const source=await ctx.storage.store(new Blob([new Uint8Array(png)],{type:'image/png'}));
    const parts=[{storageId:source,foregroundStorageId:source,direction:2,width:100,height:100,reg:{x:20,y:40},frames:[{x:0,y:0,width:300,height:300},{x:300,y:0,width:300,height:300}]}];
    const id=await ctx.db.insert('assets',{ownerId,ownerName:'Builder',name:'Animated seat',category:'Seating',width:1,depth:1,surfaceHeight:0,spriteDensity:3,icon:source,parts,frameDuration:250,views:[{direction:2,source:2,mirror:false},{direction:4,source:2,mirror:true}],createdAt:0});
    return {id,source,parts};
  });
  return {...result,pixels:image.bitmap.data};
}

it('recompresses once without changing any pixels, animation metadata or shared layers',async()=>{
  const t=convexTest(schema,modules),{id,source,parts,pixels}=await fixture(t);
  const dry=await t.action(internal.spriteBackfill.run,{});
  expect(dry.candidates).toBe(1);expect(dry.filesChecked).toBe(0);expect(dry.changes).toEqual([]);
  const before=await t.run(ctx=>ctx.db.get(id));
  const result=await t.action(internal.spriteBackfill.run,{apply:true});
  expect(result.changes).toHaveLength(1);expect(result.filesChecked).toBe(1);expect(result.optimizedBytes).toBeLessThan(result.sourceBytes);
  const asset=await t.run(ctx=>ctx.db.get(id)),next=asset.parts[0].storageId;
  expect(next).not.toBe(source);expect(asset.parts).toEqual([{...parts[0],storageId:next,foregroundStorageId:next}]);
  expect(asset).toEqual({...before,parts:asset.parts,icon:next});
  const buffer=await t.run(async ctx=>(await ctx.storage.get(next)).arrayBuffer());
  const decoded=await decodeImage(Buffer.from(buffer));
  expect([decoded.width,decoded.height]).toEqual([600,300]);expect(decoded.bitmap.data.equals(Buffer.from(pixels))).toBe(true);
  expect(await t.run(async ctx=>!!await ctx.storage.get(source))).toBe(true);
  expect((await t.action(internal.spriteBackfill.run,{apply:true})).changes).toEqual([]);
});

it('does not overwrite a concurrent sprite edit or replace unrelated files',async()=>{
  const t=convexTest(schema,modules),{id,source,parts}=await fixture(t);
  const next=await t.run(ctx=>ctx.storage.store(new Blob([new Uint8Array([1,2,3])],{type:'image/png'})));
  await t.run(ctx=>ctx.db.patch(id,{parts:[{...parts[0],reg:{x:12,y:30}}]}));
  expect(await t.mutation(internal.spriteMaintenance.replace,{id,previousIcon:source,previousParts:JSON.stringify(parts),files:[{previous:source,next}]})).toBe(false);
  const asset=await t.run(ctx=>ctx.db.get(id));expect(asset.parts[0].storageId).toBe(source);expect(asset.parts[0].reg).toEqual({x:12,y:30});
  await expect(t.mutation(internal.spriteMaintenance.replace,{id,previousIcon:source,previousParts:JSON.stringify(asset.parts),files:[{previous:next,next:source}]})).rejects.toThrow('no longer belongs');
});

it('converts separate catalogue icons and declines stale icon snapshots',async()=>{
  const t=convexTest(schema,modules),{id,source,parts}=await fixture(t);
  const icon=await t.run(async ctx=>ctx.storage.store(new Blob([await new Jimp({width:3,height:2,color:0x11223344}).getBuffer('image/png')],{type:'image/png'})));
  await t.run(ctx=>ctx.db.patch(id,{icon}));
  expect(await t.mutation(internal.spriteMaintenance.replace,{id,previousIcon:source,previousParts:JSON.stringify(parts),files:[]})).toBe(false);
  const result=await t.action(internal.spriteBackfill.run,{apply:true});
  expect(result.filesChecked).toBe(2);
  const asset=await t.run(ctx=>ctx.db.get(id));
  const blob=await t.run(async ctx=>{const b=await ctx.storage.get(asset.icon);return {type:b.type,bytes:await b.arrayBuffer()};});
  expect(blob.type).toBe('image/webp');
  const decoded=await decodeImage(Buffer.from(blob.bytes));
  expect([decoded.width,decoded.height,decoded.getPixelColor(0,0)]).toEqual([3,2,0x11223344]);
  expect(await t.run(async ctx=>!!await ctx.storage.get(icon))).toBe(true);
});

it('converts floor and wall pictures without losing concurrent space styling',async()=>{
  const t=convexTest(schema,modules),{id:assetId,source}=await fixture(t);
  const asset=await t.run(ctx=>ctx.db.get(assetId));
  const space={id:'garden',owner:asset.ownerId,ownerName:'Builder',name:'Garden',width:8,depth:8,floor:'plain',floorColor:'#123456',createdAt:0,floorImage:source,wallImage:source};
  const roomId=await t.run(ctx=>ctx.db.insert('rooms',{key:'test',options:{},revision:2,spaces:[space]}));
  expect((await t.action(internal.surfaceBackfill.run,{})).changes).toEqual([]);
  const result=await t.action(internal.surfaceBackfill.run,{apply:true});
  expect(result.changes).toHaveLength(1);
  const room=await t.run(ctx=>ctx.db.get(roomId)),next=room.spaces[0].floorImage;
  expect(room.spaces).toEqual([{...space,floorImage:next,wallImage:next}]);
  expect(await t.run(async ctx=>(await ctx.storage.get(next)).type)).toBe('image/webp');
  expect(room.revision).toBe(3);
  expect((await t.action(internal.surfaceBackfill.run,{apply:true})).changes).toEqual([]);
  expect(await t.mutation(internal.surfaceMaintenance.replace,{id:roomId,spaceId:'garden',files:[{previous:source,next}]})).toBe(false);
  expect(await t.run(async ctx=>!!await ctx.storage.get(source))).toBe(true);
});

it('deduplicates exact files from metadata, preserves geometry and originals, and is idempotent',async()=>{
  const t=convexTest(schema,modules),{id,source,parts}=await fixture(t);
  const differentPng=await new Jimp({width:600,height:300,color:0xff0000ff}).getBuffer('image/png');
  await t.run(async ctx=>{
    const blob=await ctx.storage.get(source),duplicate=await ctx.storage.store(blob),icon=await ctx.storage.store(blob);
    const differentFile=await ctx.storage.store(new Blob([new Uint8Array(differentPng)],{type:'image/png'}));
    await ctx.db.patch(id,{icon,parts:[...parts,{...parts[0],storageId:duplicate,foregroundStorageId:differentFile,direction:0,reg:{x:7,y:9}}],
      views:[{direction:2,source:2,mirror:false},{direction:0,source:0,mirror:false}]});
  });
  const before=await t.run(ctx=>ctx.db.get(id)),oldIds=[before.icon,...before.parts.flatMap(p=>[p.storageId,p.foregroundStorageId])];
  const dry=await t.mutation(internal.spriteMaintenance.deduplicate,{});
  expect(await t.run(ctx=>ctx.db.get(id))).toEqual(before);
  const result=await t.mutation(internal.spriteMaintenance.deduplicate,{apply:true});
  expect(dry.changes).toHaveLength(1);expect(dry.changes[0].files).toHaveLength(2);expect(dry.assetsChanged).toBe(0);
  expect(result.assetsChanged).toBe(1);expect(result.duplicateBytes).toBeGreaterThan(0);
  const after=await t.run(ctx=>ctx.db.get(id));
  expect(after).toEqual({...before,icon:source,parts:[before.parts[0],{...before.parts[1],storageId:source}]});
  for(const old of oldIds)expect(await t.run(ctx=>ctx.db.system.get(old))).not.toBeNull();
  expect((await t.mutation(internal.spriteMaintenance.deduplicate,{apply:true})).changes).toEqual([]);
});

it('keeps separate assets independently deletable and processes every page',async()=>{
  const t=convexTest(schema,modules),first=await fixture(t);
  const original=await t.run(ctx=>ctx.db.get(first.id)),ids=[first.id],sources=[first.source];
  await t.run(async ctx=>{
    const blob=await ctx.storage.get(first.source);
    for(let i=0;i<6;i++){
      const source=await ctx.storage.store(blob),duplicate=await ctx.storage.store(blob);
      const {_id,_creationTime,...asset}=original;
      ids.push(await ctx.db.insert('assets',{...asset,icon:duplicate,parts:[{...asset.parts[0],storageId:source,foregroundStorageId:duplicate}]}));
      sources.push(source);
    }
  });
  let cursor=null,changed=0,pages=0;
  do{
    const result=await t.mutation(internal.spriteMaintenance.deduplicate,{cursor,apply:true});
    changed+=result.assetsChanged;pages++;
    if(result.isDone)break;
    expect(result.cursor).not.toBe(cursor);cursor=result.cursor;
  }while(pages<10);
  expect(changed).toBe(6);expect(pages).toBe(2);
  await t.run(ctx=>ctx.storage.delete(first.source));
  for(let i=1;i<ids.length;i++){
    const asset=await t.run(ctx=>ctx.db.get(ids[i]));
    expect(asset.icon).toBe(sources[i]);expect(asset.parts[0].foregroundStorageId).toBe(sources[i]);
    expect(await t.run(ctx=>ctx.db.system.get(asset.icon))).not.toBeNull();
  }
});
