import {describe,it,expect,beforeEach,vi,afterEach} from 'vitest';
import {convexTest} from 'convex-test';
import schema from '../convex/schema.js';
import {api,internal} from '../convex/_generated/api.js';
import {HOMEPAGE_PIECES,HOMEPAGE_SPACE_ID,homepageTopicFor} from '../shared/homepage.js';
import {layoutFor} from '../convex/lib/rules.js';
const modules=import.meta.glob('../convex/**/*.js');
const token='c'.repeat(64),guestToken='d'.repeat(64);
const look={hair:{model:'1',color:'#624631'},skin:{model:'1',color:'#e8b18a'},top:{model:'1',color:'#6b8c64'},bottom:{model:'1',color:'#55677e'},shoes:{model:'1',color:'#42454c'}};
let t,grant,guest;
beforeEach(async()=>{
  t=convexTest(schema,modules);
  grant=await t.mutation(api.room.join,{token,name:'Owner',look});
  await t.run(ctx=>ctx.db.patch(grant.id,{name:'Grant',nameKey:'grant',role:'admin'}));
  guest=await t.mutation(api.room.join,{token:guestToken,name:'Reader',look});
});
afterEach(()=>vi.useRealTimers());
describe('homepage space',()=>{
  it('inserts beside the lobby, translates existing furniture and saved visitors, and is repeatable',async()=>{
    const {agentToken}=await t.mutation(api.agents.createKey,{token:guestToken,label:'Test'});
    const space=await t.mutation(api.agents.addSpace,{agentToken,name:'Existing room',level:0});
    const upper=await t.mutation(api.agents.addSpace,{agentToken:(await t.mutation(api.agents.createKey,{token,label:'Admin'})).agentToken,name:'Upper',level:1});
    await t.run(async ctx=>{
      await ctx.db.insert('furniture',{id:'existing-piece',zone:space.spaceId,type:'plant_cruddy',rotation:0,x:space.x+2,z:2,owner:guest.id});
      await ctx.db.patch(guest.id,{zone:space.spaceId,route:[{x:space.x+3.5,z:4.5}],seatId:null});
    });
    const result=await t.mutation(internal.homepage.install,{});
    expect(result).toMatchObject({created:true,spaceId:HOMEPAGE_SPACE_ID,x:space.x,pieces:HOMEPAGE_PIECES.length});
    const state=await t.run(async ctx=>({room:await ctx.db.query('rooms').first(),items:await ctx.db.query('furniture').collect(),guest:await ctx.db.get(guest.id)}));
    expect(state.room.spaces[0].id).toBe(HOMEPAGE_SPACE_ID);
    expect(state.items.find(i=>i.id==='existing-piece').x).toBe(space.x+10);
    expect(state.guest.route[0].x).toBe(space.x+11.5);
    expect(layoutFor(state.room.options,state.room.spaces).spaces.find(s=>s.id===upper.spaceId).x).toBe(upper.x);
    expect(state.items.filter(i=>i.zone===HOMEPAGE_SPACE_ID)).toHaveLength(17);
    expect(await t.mutation(internal.homepage.install,{})).toEqual({created:false,spaceId:HOMEPAGE_SPACE_ID});
    expect(await t.run(ctx=>ctx.db.query('furniture').collect())).toHaveLength(state.items.length);
  });
  it('allows a visitor to reach the new room by teleport',async()=>{
    await t.mutation(internal.homepage.install,{});
    const arrival=await t.mutation(api.room.teleport,{token:guestToken,spaceId:HOMEPAGE_SPACE_ID});
    expect(arrival.zone).toBe(HOMEPAGE_SPACE_ID);
  });
  it('opens stories only for the dedicated copies',()=>{
    expect(homepageTopicFor({id:'homepage-telephone'})).toBe('contact');
    expect(homepageTopicFor({id:'some-other-phone',type:'homepage_telephone'})).toBeNull();
    expect(homepageTopicFor({id:'homepage-rug'})).toBeNull();
  });
});
describe('homepage notes',()=>{
  it('persists named notes, bounds input, rate limits, and requires a session',async()=>{
    await expect(t.mutation(api.homepage.addNote,{token:'bad',kind:'guestbook',body:'Hello'})).rejects.toThrow();
    await expect(t.mutation(api.homepage.addNote,{token:guestToken,kind:'guestbook',body:' '.repeat(5)})).rejects.toThrow('1 and 500');
    await expect(t.mutation(api.homepage.addNote,{token:guestToken,kind:'guestbook',body:'x'.repeat(501)})).rejects.toThrow('1 and 500');
    await t.mutation(api.homepage.addNote,{token:guestToken,kind:'guestbook',body:'  Hello from the room  '});
    const page=await t.query(api.homepage.notes,{token:guestToken,kind:'guestbook'});
    expect(page.canManage).toBe(false);expect(page.notes[0]).toMatchObject({name:'Reader',body:'Hello from the room'});
    await expect(t.mutation(api.homepage.addNote,{token:guestToken,kind:'suggestion',body:'More plants'})).rejects.toThrow('30 seconds');
  });
  it('only Grant can hide notes or record completed suggestions with a real response',async()=>{
    const id=await t.mutation(api.homepage.addNote,{token:guestToken,kind:'suggestion',body:'Add a cactus'});
    await expect(t.mutation(api.homepage.reviewNote,{token:guestToken,id,status:'done',response:'Done'})).rejects.toThrow('Only Grant');
    await expect(t.mutation(api.homepage.reviewNote,{token,id,status:'done'})).rejects.toThrow('what changed');
    await t.mutation(api.homepage.reviewNote,{token,id,status:'done',response:'Put one beside the desk.'});
    expect((await t.query(api.homepage.notes,{token:guestToken,kind:'suggestion'})).notes).toHaveLength(0);
    expect((await t.query(api.homepage.notes,{token:guestToken,kind:'suggestion',completed:true})).notes[0].response).toBe('Put one beside the desk.');
    await t.mutation(api.homepage.reviewNote,{token,id,status:'hidden'});
    expect((await t.query(api.homepage.notes,{token:guestToken,kind:'suggestion',completed:true})).notes).toHaveLength(0);
  });
});
