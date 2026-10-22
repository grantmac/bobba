import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {convexTest} from 'convex-test';
import schema from '../convex/schema.js';
import {api,internal} from '../convex/_generated/api.js';
import {hash,ADMIN_SESSION_AGE} from '../convex/lib/identity.js';

const modules=import.meta.glob('../convex/**/*.js');
const token='a'.repeat(64),otherToken='b'.repeat(64),origin='https://chat.grantm.ac';
const look={hair:{model:'1',color:'#624631'},skin:{model:'1',color:'#e8b18a'},top:{model:'1',color:'#6b8c64'},bottom:{model:'1',color:'#55677e'},shoes:{model:'1',color:'#42454c'}};
let t,player,agentToken;
const code=link=>new URL(link.url).hash.slice('#enter='.length);
const issue=()=>t.mutation(api.agentLogin.issue,{agentToken,origin});
const consume=link=>t.mutation(api.agentLogin.consume,{code:code(link),origin});
beforeEach(async()=>{
  t=convexTest(schema,modules);vi.stubEnv('ROOM_AUTH_ORIGINS',origin);vi.stubEnv('NTFY_TOPIC','');
  player=await t.mutation(api.room.join,{token,name:'Visitor',look});
  ({agentToken}=await t.mutation(api.agents.createKey,{token}));
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();});

describe('opening the room from a connected agent',()=>{
  it('exchanges a hashed, one-use link for the original character and a new session',async()=>{
    const link=await issue();
    expect(link).toMatchObject({playerName:'Visitor'});
    expect(link.expiresAt-Date.now()).toBeLessThanOrEqual(120000);
    expect(link.url).not.toContain(agentToken);
    const ticket=await t.run(ctx=>ctx.db.query('agentEntries').unique());
    expect(ticket.codeHash).toBe(await hash(code(link)));
    expect(JSON.stringify(ticket)).not.toContain(code(link));
    const result=await consume(link);
    expect(result.player).toMatchObject({id:player.id,name:'Visitor',look});
    expect(result.token).not.toBe(token);expect(result.token).not.toBe(agentToken);
    expect(await t.mutation(api.identity.resume,{token:result.token})).toMatchObject({id:player.id});
    await expect(consume(link)).rejects.toThrow('already used');
    expect(await t.run(ctx=>ctx.db.query('players').collect())).toHaveLength(1);
  });
  it('rejects concurrent replays atomically',async()=>{
    const link=await issue(),results=await Promise.allSettled([consume(link),consume(link)]);
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    expect(await t.run(ctx=>ctx.db.query('sessions').collect())).toHaveLength(2);
  });
  it('returns after the old browser session has expired',async()=>{
    await t.mutation(api.agents.connected,{agentToken});
    vi.spyOn(Date,'now').mockReturnValue(Date.now()+40*24*60*60*1000);
    const result=await consume(await issue());
    expect(await t.mutation(api.identity.resume,{token:result.token})).toMatchObject({id:player.id});
  });
  it('rejects expired links and cleans them up',async()=>{
    const link=await issue();vi.spyOn(Date,'now').mockReturnValue(link.expiresAt+1);
    await expect(consume(link)).rejects.toThrow('expired');
    await t.mutation(internal.identity.cleanup,{});
    expect(await t.run(ctx=>ctx.db.query('agentEntries').collect())).toHaveLength(0);
  });
  it('rejects forged codes and untrusted or mismatched origins',async()=>{
    const link=await issue();
    await expect(t.mutation(api.agentLogin.consume,{code:'0'.repeat(64),origin})).rejects.toThrow('expired');
    await expect(t.mutation(api.agentLogin.issue,{agentToken,origin:'https://evil.test'})).rejects.toThrow('usual address');
    vi.stubEnv('ROOM_AUTH_ORIGINS',origin+',https://habbo-room.vercel.app');
    await expect(t.mutation(api.agentLogin.consume,{code:code(link),origin:'https://habbo-room.vercel.app'})).rejects.toThrow('expired');
    expect((await consume(link)).player.id).toBe(player.id);
  });
  it('disconnecting the agent invalidates outstanding links',async()=>{
    const link=await issue();await t.mutation(api.agents.revoke,{token});
    await expect(consume(link)).rejects.toThrow('expired');
    await expect(issue()).rejects.toThrow('not attached');
  });
  it('cannot bypass moderation or resurrect a retired identity',async()=>{
    const link=await issue();
    await t.run(ctx=>ctx.db.patch(player.id,{blockedUntil:Date.now()+600000}));
    await expect(issue()).rejects.toThrow('removed');await expect(consume(link)).rejects.toThrow('removed');
    await t.run(ctx=>ctx.db.patch(player.id,{blockedUntil:0,nameKey:`retired:${player.id}`}));
    await expect(issue()).rejects.toThrow('no longer available');await expect(consume(link)).rejects.toThrow('no longer available');
  });
  it('reserves names after authenticated contact, including older connected keys',async()=>{
    await t.mutation(api.agents.connected,{agentToken});
    expect(await t.query(api.identity.status,{token})).toMatchObject({saved:true});
    await t.run(ctx=>ctx.db.patch(player.id,{savedAt:undefined}));
    vi.spyOn(Date,'now').mockReturnValue(Date.now()+5*60*60*1000);
    expect(await t.query(api.identity.status,{token})).toMatchObject({saved:true});
    await expect(t.query(api.room.checkName,{name:'Visitor'})).rejects.toThrow('saved character');
    await expect(t.mutation(api.room.join,{token:otherToken,name:'Visitor',look})).rejects.toThrow('saved character');
  });
  it('a copied key alone does not save the name or survive its reuse',async()=>{
    expect(await t.query(api.identity.status,{token})).toMatchObject({saved:false});
    vi.spyOn(Date,'now').mockReturnValue(Date.now()+5*60*60*1000);
    const next=await t.mutation(api.room.join,{token:otherToken,name:'Visitor',look});
    expect(next.id).not.toBe(player.id);await expect(issue()).rejects.toThrow('not attached');
  });
  it('keeps admin sessions limited to twelve hours',async()=>{
    await t.run(ctx=>ctx.db.patch(player.id,{role:'admin'}));
    const result=await consume(await issue());
    const digest=await hash(result.token);
    const actual=await t.run(ctx=>ctx.db.query('sessions').withIndex('by_token',q=>q.eq('tokenHash',digest)).unique());
    expect(actual.role).toBe('admin');expect(actual.expiresAt-Date.now()).toBeLessThanOrEqual(ADMIN_SESSION_AGE);
  });
  it('bounds link issuance for each agent',async()=>{
    for(let i=0;i<10;i++)await issue();
    await expect(issue()).rejects.toThrow('wait a little');
  });
});
