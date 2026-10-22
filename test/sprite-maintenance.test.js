// @vitest-environment node
import {it,expect} from 'vitest';
import {convexTest} from 'convex-test';
import {Jimp} from 'jimp';
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
  const decoded=await Jimp.read(Buffer.from(buffer));
  expect([decoded.width,decoded.height]).toEqual([600,300]);expect(decoded.bitmap.data.equals(Buffer.from(pixels))).toBe(true);
  expect(await t.run(async ctx=>!!await ctx.storage.get(source))).toBe(true);
  expect((await t.action(internal.spriteBackfill.run,{apply:true})).changes).toEqual([]);
});

it('does not overwrite a concurrent sprite edit or replace unrelated files',async()=>{
  const t=convexTest(schema,modules),{id,source,parts}=await fixture(t);
  const next=await t.run(ctx=>ctx.storage.store(new Blob([new Uint8Array([1,2,3])],{type:'image/png'})));
  await t.run(ctx=>ctx.db.patch(id,{parts:[{...parts[0],reg:{x:12,y:30}}]}));
  expect(await t.mutation(internal.spriteMaintenance.replace,{id,previousParts:JSON.stringify(parts),files:[{previous:source,next}]})).toBe(false);
  const asset=await t.run(ctx=>ctx.db.get(id));expect(asset.parts[0].storageId).toBe(source);expect(asset.parts[0].reg).toEqual({x:12,y:30});
  await expect(t.mutation(internal.spriteMaintenance.replace,{id,previousParts:JSON.stringify(asset.parts),files:[{previous:next,next:source}]})).rejects.toThrow('no longer belongs');
});
