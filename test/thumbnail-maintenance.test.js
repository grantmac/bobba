// @vitest-environment node
import {it,expect} from 'vitest';
import {convexTest} from 'convex-test';
import {Jimp} from 'jimp';
import {decodeImage} from '../shared/image-codec.js';
import schema from '../convex/schema.js';
import {internal} from '../convex/_generated/api.js';
const modules=import.meta.glob('../convex/**/*.js');

it('backfills icons once, keeps source sprites and safely handles concurrent replacement',async()=>{
  const t=convexTest(schema,modules);
  const png=await new Jimp({width:240,height:120,color:0xff0000ff}).getBuffer('image/png');
  const {id,source}=await t.run(async ctx=>{
    const ownerId=await ctx.db.insert('players',{name:'Builder',nameKey:'builder',role:'guest',look:{},route:[{x:1,z:1}],startedAt:0,direction:2,seatId:null,lastSeen:0,lastChat:0});
    const source=await ctx.storage.store(new Blob([new Uint8Array(png)],{type:'image/png'}));
    const id=await ctx.db.insert('assets',{ownerId,ownerName:'Builder',name:'Lamp',category:'Lighting',width:1,depth:1,surfaceHeight:0,spriteDensity:3,icon:source,
      parts:[{storageId:source,direction:2,width:40,height:40,reg:{x:20,y:40},frames:[{x:0,y:0,width:120,height:120},{x:120,y:0,width:120,height:120}]}],views:[{direction:2,source:2,mirror:false}],createdAt:0});
    return {id,source};
  });
  const dry=await t.action(internal.thumbnailBackfill.run,{});expect(dry.candidates).toBe(1);expect(dry.converted).toBe(0);
  expect((await t.run(ctx=>ctx.db.get(id))).icon).toBe(source);
  const applied=await t.action(internal.thumbnailBackfill.run,{apply:true});expect(applied.converted).toBe(1);
  const asset=await t.run(ctx=>ctx.db.get(id));expect(asset.icon).not.toBe(source);
  const bytes=await t.run(async ctx=>(await ctx.storage.get(asset.icon)).arrayBuffer()),icon=await decodeImage(Buffer.from(bytes));
  expect([icon.width,icon.height]).toEqual([72,72]);expect(await t.run(async ctx=>!!await ctx.storage.get(source))).toBe(true);
  expect((await t.action(internal.thumbnailBackfill.run,{apply:true})).converted).toBe(0);
  const stale=await t.run(ctx=>ctx.storage.store(new Blob([new Uint8Array(png)],{type:'image/png'})));
  expect(await t.mutation(internal.thumbnailMaintenance.replace,{id,previous:source,icon:stale})).toBe(false);
  expect(await t.run(async ctx=>!!await ctx.storage.get(stale))).toBe(false);expect((await t.run(ctx=>ctx.db.get(id))).icon).toBe(asset.icon);
});
