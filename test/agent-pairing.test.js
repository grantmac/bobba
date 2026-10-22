import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {convexTest} from 'convex-test';
import schema from '../convex/schema.js';
import {api,internal} from '../convex/_generated/api.js';
const modules=import.meta.glob('../convex/**/*.js');
const look={hair:{model:'1',color:'#624631'},skin:{model:'1',color:'#e8b18a'},top:{model:'1',color:'#6b8c64'},bottom:{model:'1',color:'#55677e'},shoes:{model:'1',color:'#42454c'}};
const token='a'.repeat(64),other='b'.repeat(64);
let t,player;
beforeEach(async()=>{t=convexTest(schema,modules);player=await t.mutation(api.room.join,{token,name:'Visitor',look});});
afterEach(()=>vi.restoreAllMocks());
const start=()=>t.mutation(api.agentPairing.start,{client:'ChatGPT'});
const approve=pair=>t.mutation(api.agentPairing.decide,{token,code:pair.code,approve:true});
const status=pair=>t.query(api.agentPairing.status,{agentToken:pair.agentToken});
describe('agent entry pairing',()=>{
  it('keeps the browser approval code separate from the agent secret and stores only hashes',async()=>{
    const pair=await start();
    expect(pair.code).not.toBe(pair.agentToken);
    const stored=await t.run(ctx=>ctx.db.query('agentPairings').first());
    expect(JSON.stringify(stored)).not.toContain(pair.code);expect(JSON.stringify(stored)).not.toContain(pair.agentToken);
    expect(await status(pair)).toEqual({state:'pending'});
    const visible=await t.query(api.agentPairing.inspect,{token,code:pair.code});
    expect(visible).toMatchObject({state:'pending',client:'ChatGPT',verification:pair.verification});
    expect(JSON.stringify(visible)).not.toContain(pair.agentToken);
    expect(await t.query(api.agentPairing.status,{agentToken:pair.code})).toEqual({state:'expired'});
    await expect(t.query(api.agents.status,{agentToken:pair.agentToken})).rejects.toThrow('not attached');
    await expect(t.query(api.agentPairing.inspect,{token:'c'.repeat(64),code:pair.code})).rejects.toThrow('session');
  });
  it('binds the approved agent to the browser player, and only MCP contact marks it connected',async()=>{
    const pair=await start();await approve(pair);await approve(pair);
    expect(await status(pair)).toEqual({state:'approved'});
    expect(await t.query(api.agents.attached,{token})).toHaveLength(1);
    expect((await t.query(api.agents.status,{agentToken:pair.agentToken})).playerId).toBe(player.id);
    await t.mutation(api.agents.connected,{agentToken:pair.agentToken});
    expect(await status(pair)).toEqual({state:'connected'});
  });
  it('cannot be reassigned by another character or reopened after revocation',async()=>{
    const pair=await start();await approve(pair);
    await t.mutation(api.room.join,{token:other,name:'Other',look});
    await expect(t.mutation(api.agentPairing.decide,{token:other,code:pair.code,approve:true})).rejects.toThrow('another player');
    expect(await t.query(api.agentPairing.inspect,{token:other,code:pair.code})).toEqual({state:'unavailable'});
    await t.mutation(api.agents.revoke,{token});
    expect(await status(pair)).toEqual({state:'revoked'});
    await expect(approve(pair)).rejects.toThrow('ended');
  });
  it.each([false,true])('cancellation is final and revokes any approved link (approved: %s)',async approved=>{
    const pair=await start();if(approved)await approve(pair);
    await t.mutation(api.agentPairing.decide,{token,code:pair.code,approve:false});
    expect(await status(pair)).toEqual({state:'cancelled'});
    await expect(approve(pair)).rejects.toThrow('ended');
    await expect(t.query(api.agents.status,{agentToken:pair.agentToken})).rejects.toThrow('not attached');
  });
  it('expires requests and unused approvals, while established connections survive cleanup',async()=>{
    const pending=await start(),approved=await start(),connected=await start();
    await approve(approved);await approve(connected);await t.mutation(api.agents.connected,{agentToken:connected.agentToken});
    vi.spyOn(Date,'now').mockReturnValue(connected.expiresAt+1);
    await expect(approve(pending)).rejects.toThrow('ended');
    await expect(t.query(api.agents.status,{agentToken:approved.agentToken})).rejects.toThrow('expired');
    await t.mutation(internal.agentPairing.cleanup,{});
    expect(await t.run(ctx=>ctx.db.query('agentPairings').collect())).toHaveLength(0);
    expect((await t.query(api.agents.status,{agentToken:connected.agentToken})).playerId).toBe(player.id);
    expect(await t.query(api.agents.attached,{token})).toHaveLength(1);
  });
  it('resumes an existing authorization without minting another key or accepting another player',async()=>{
    const first=await start();await approve(first);await t.mutation(api.agents.connected,{agentToken:first.agentToken});
    const second=await t.mutation(api.agentPairing.start,{agentToken:first.agentToken,client:'ChatGPT'});
    expect(second.agentToken).toBe(first.agentToken);expect(second.code).not.toBe(first.code);
    expect(await status(second)).toEqual({state:'connected'});
    expect(await t.query(api.agents.attached,{token})).toHaveLength(1);
    await t.mutation(api.room.join,{token:other,name:'Other',look});
    expect(await t.query(api.agentPairing.inspect,{token:other,code:second.code})).toEqual({state:'unavailable'});
  });
  it('rejects removed players and bounds unauthenticated request creation',async()=>{
    const pair=await start();await t.run(ctx=>ctx.db.patch(player.id,{blockedUntil:Date.now()+600000}));
    await expect(approve(pair)).rejects.toThrow('removed');
    for(let i=1;i<60;i++)await start();
    await expect(start()).rejects.toThrow('too many');
  });
});
