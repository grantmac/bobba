import {beforeEach,describe,it,expect} from 'vitest';
import {convexTest} from 'convex-test';
import schema from '../convex/schema.js';
import {api} from '../convex/_generated/api.js';
const modules=import.meta.glob('../convex/**/*.js');
const token='a'.repeat(64),other='b'.repeat(64);
const look={hair:{model:'1',color:'#624631'},skin:{model:'1',color:'#e8b18a'},top:{model:'1',color:'#6b8c64'},bottom:{model:'1',color:'#55677e'},shoes:{model:'1',color:'#42454c'}};
let t,agentToken,player;
beforeEach(async()=>{t=convexTest(schema,modules);player=await t.mutation(api.room.join,{token,name:'Maker',look});({agentToken}=await t.mutation(api.agents.createKey,{token}));});
async function create(slot='headwear'){
  const storageId=await t.run(async ctx=>{const id=await ctx.storage.store(new Blob(['png'],{type:'image/png'}));await ctx.db.patch(id,{contentType:'image/png'});return id;});
  return t.mutation(api.wearables.create,{agentToken,name:'Space helmet',slot,storageId});
}
describe('custom wearables',()=>{
  it('stores a fitted top alongside a hat and jacket and restores the base shirt when removed',async()=>{
    const storageId=await t.run(async ctx=>{const id=await ctx.storage.store(new Blob(['png'],{type:'image/png'}));await ctx.db.patch(id,{contentType:'image/png'});return id;});
    const top=await t.mutation(api.wearables.create,{agentToken,name:'Custom shirt',slot:'top',templateModel:'1',storageId});
    const hat=await create(),jacket=await create('jacket');
    await t.mutation(api.wearables.applyOutfit,{token,look,wearableIds:[hat.id,top.id,jacket.id]});
    expect((await t.query(api.room.me,{token})).look._wearables.find(w=>w.slot==='top')).toMatchObject({id:top.id,templateModel:'1'});
    await t.mutation(api.wearables.equipAgent,{agentToken,slot:'top',wearableId:null});
    const me=await t.query(api.room.me,{token});
    expect(me.look.top).toEqual(look.top);expect(me.look._wearables).toHaveLength(2);
    await expect(t.mutation(api.wearables.create,{agentToken,name:'Missing fit',slot:'top',storageId})).rejects.toThrow('template');
  });
  it('belongs to the avatar and can be created offline, then selected atomically in the normal appearance editor',async()=>{
    await t.run(ctx=>ctx.db.patch(player.id,{online:false}));
    const item=await create();
    const stored=await t.run(ctx=>ctx.db.get(item.id));
    await expect(t.mutation(api.agents.discardUpload,{agentToken,storageId:stored.storageId})).rejects.toThrow('wearable');
    expect((await t.query(api.wearables.list,{token}))[0].id).toBe(item.id);
    await t.mutation(api.room.join,{token:other,name:'Friend',look});
    const otherKey=await t.mutation(api.agents.createKey,{token:other});
    await expect(t.mutation(api.agents.discardUpload,{agentToken:otherKey.agentToken,storageId:stored.storageId})).rejects.toThrow('wearable');
    expect(await t.query(api.wearables.list,{token:other})).toEqual([]);
    await t.mutation(api.wearables.applyOutfit,{token,look,wearableIds:[item.id]});
    expect((await t.query(api.room.me,{token})).look._wearables[0].id).toBe(item.id);
    await expect(t.mutation(api.wearables.applyOutfit,{token,look,wearableIds:[item.id,item.id]})).rejects.toThrow('slot');
    await t.mutation(api.wearables.applyOutfit,{token,look,wearableIds:[]});
    expect((await t.query(api.room.me,{token})).look).toEqual(look);
  });
  it('publishes, equips, shares and removes a wearable without changing the base outfit',async()=>{
    const item=await create();
    await t.mutation(api.wearables.equip,{token,slot:'headwear',wearableId:item.id});
    const me=await t.query(api.room.me,{token});
    expect(me.look._wearables[0]).toMatchObject({id:item.id,slot:'headwear'});
    expect(me.look.top).toEqual(look.top);expect(me.lookVersion).toBe(1);
    expect((await t.query(api.room.look,{id:player.id})).look).toEqual(me.look);
    await t.mutation(api.room.join,{token:other,name:'Friend',look});
    await t.mutation(api.wearables.equip,{token:other,slot:'headwear',wearableId:item.id});
    expect((await t.query(api.room.me,{token:other})).look._wearables[0].id).toBe(item.id);
    await t.mutation(api.wearables.equipAgent,{agentToken,slot:'headwear',wearableId:null});
    expect((await t.query(api.room.me,{token})).look).toEqual(look);
  });
  it('keeps equipped wearables through base appearance edits and rejects wrong slots and invalid files',async()=>{
    const item=await create();
    await expect(t.mutation(api.wearables.equip,{token,slot:'jacket',wearableId:item.id})).rejects.toThrow('slot');
    await t.mutation(api.wearables.equip,{token,slot:'headwear',wearableId:item.id});
    await t.mutation(api.room.appearance,{token,look:{...look,top:{model:'2',color:'#b34c43'}}});
    expect((await t.query(api.room.me,{token})).look._wearables[0].id).toBe(item.id);
    const bad=await t.run(ctx=>ctx.storage.store(new Blob(['bad'],{type:'text/html'})));
    await expect(t.mutation(api.wearables.create,{agentToken,name:'Bad',slot:'headwear',storageId:bad})).rejects.toThrow('PNG');
    await expect(t.mutation(api.wearables.equip,{token:'c'.repeat(64),slot:'headwear',wearableId:item.id})).rejects.toThrow();
  });
});
