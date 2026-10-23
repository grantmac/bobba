import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {convexTest} from 'convex-test';
import {isoCBOR} from '@simplewebauthn/server/helpers';
import {Buffer} from 'node:buffer';
import schema from '../convex/schema.js';
import {api,internal} from '../convex/_generated/api.js';
import {hash} from '../convex/lib/identity.js';

const modules=import.meta.glob('../convex/**/*.js');
const encodeCBOR=isoCBOR.encode;
const token='a'.repeat(64),otherToken='b'.repeat(64),origin='https://chat.grantm.ac';
const look={hair:{model:'1',color:'#624631'},skin:{model:'1',color:'#e8b18a'},top:{model:'1',color:'#6b8c64'},bottom:{model:'1',color:'#55677e'},shoes:{model:'1',color:'#42454c'}};
const bytes=value=>new Uint8Array(value),b64=value=>Buffer.from(value).toString('base64url');
const json=value=>bytes(Buffer.from(JSON.stringify(value)));
const concat=(...values)=>bytes(Buffer.concat(values.map(v=>Buffer.from(v))));
const sha=value=>crypto.subtle.digest('SHA-256',value).then(bytes);
let t,player;
beforeEach(async()=>{
  t=convexTest(schema,modules);
  vi.stubEnv('ROOM_AUTH_ORIGINS',origin);vi.stubEnv('NTFY_TOPIC','');
  player=await t.mutation(api.room.join,{token,name:'Visitor',look});
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();vi.unstubAllGlobals();});

// A software authenticator exercises the real WebAuthn verifier with P-256 signatures.
async function authenticator(){
  const keys=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
  const jwk=await crypto.subtle.exportKey('jwk',keys.publicKey),id=crypto.getRandomValues(new Uint8Array(32));
  const publicKey=encodeCBOR(new Map([[1,2],[3,-7],[-1,1],[-2,bytes(Buffer.from(jwk.x,'base64url'))],[-3,bytes(Buffer.from(jwk.y,'base64url'))]]));
  async function authData(flags,counter=0){
    const n=new Uint8Array(4);new DataView(n.buffer).setUint32(0,counter);
    return concat(await sha(new TextEncoder().encode('chat.grantm.ac')),bytes([flags]),n);
  }
  function envelope(response){return {id:b64(id),rawId:b64(id),type:'public-key',clientExtensionResults:{},response};}
  return {
    async register(challenge,{origin:site=origin,flags=0x45}={}){
      const length=new Uint8Array(2);new DataView(length.buffer).setUint16(0,id.length);
      const data=concat(await authData(flags),new Uint8Array(16),length,id,publicKey);
      const attestation=encodeCBOR(new Map([['fmt','none'],['attStmt',new Map()],['authData',data]]));
      return envelope({clientDataJSON:b64(json({type:'webauthn.create',challenge,origin:site})),attestationObject:b64(attestation),transports:['internal']});
    },
    async authenticate(challenge,{origin:site=origin,flags=5,counter=1,userHandle=player.id,badSignature=false}={}){
      const client=json({type:'webauthn.get',challenge,origin:site}),data=await authData(flags,counter);
      const raw=bytes(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},keys.privateKey,concat(data,await sha(client))));
      function integer(value){let i=0;while(i<value.length-1&&value[i]===0)i++;let n=value.slice(i);if(n[0]&128)n=concat(bytes([0]),n);return concat(bytes([2,n.length]),n);}
      const r=integer(raw.slice(0,32)),s=integer(raw.slice(32));
      const signature=concat(bytes([0x30,r.length+s.length]),r,s);if(badSignature)signature[signature.length-1]^=1;
      return envelope({clientDataJSON:b64(client),authenticatorData:b64(data),signature:b64(signature),userHandle:b64(Buffer.from(userHandle))});
    },
  };
}
async function saveKey(){
  const device=await authenticator(),request=await t.action(api.passkeys.registrationOptions,{token,origin});
  await t.action(api.passkeys.register,{token,id:request.id,response:await device.register(request.options.challenge)});
  return device;
}
function later(ms){const now=Date.now();return vi.spyOn(Date,'now').mockReturnValue(now+ms);}

describe('room keys',()=>{
  it('saves a discoverable passkey and recovers the same character and ownership from a new browser',async()=>{
    await t.run(async ctx=>{const room=await ctx.db.query('rooms').first();await ctx.db.patch(room._id,{spaces:[{id:'mine',owner:player.id,ownerName:player.name,name:'My space',width:8,depth:8,floor:'wood',floorColor:'#ffffff',createdAt:Date.now()}]});});
    const device=await saveKey();
    expect(await t.query(api.identity.status,{token})).toMatchObject({saved:true,passkeys:1,hasBackup:false});
    const request=await t.action(api.passkeys.authenticationOptions,{origin});
    const response=await device.authenticate(request.options.challenge);
    const result=await t.action(api.passkeys.authenticate,{id:request.id,response});
    expect(result.token).not.toBe(token);expect(result.token).toMatch(/^[a-f0-9]{64}$/);
    expect(result.player).toMatchObject({id:player.id,name:'Visitor',look});
    expect((await t.query(api.room.roomState,{token:result.token})).spaces[0].owner).toBe(player.id);
    await expect(t.action(api.passkeys.authenticate,{id:request.id,response})).rejects.toThrow('expired');
    const publicState=JSON.stringify(await t.query(api.room.preview,{}));
    expect(publicState).not.toContain('publicKey');expect(publicState).not.toContain('tokenHash');expect(publicState).not.toContain('savedAt');
  });
  it('reserves a saved name indefinitely',async()=>{
    await saveKey();later(40*24*60*60*1000);
    await expect(t.query(api.room.checkName,{name:'visitor'})).rejects.toThrow('saved character');
    await expect(t.mutation(api.room.join,{token:otherToken,name:'VISITOR',look})).rejects.toThrow('saved character');
  });
  it('returns to the original character after the remembered browser session is revoked',async()=>{
    const device=await saveKey();await t.mutation(api.room.leave,{token});
    await expect(t.mutation(api.identity.resume,{token})).rejects.toThrow('ended');
    const request=await t.action(api.passkeys.authenticationOptions,{origin});
    const restored=await t.action(api.passkeys.authenticate,{id:request.id,response:await device.authenticate(request.options.challenge)});
    expect((await t.mutation(api.identity.resume,{token:restored.token}))).toMatchObject({id:player.id,name:'Visitor',look});
    expect(await t.run(ctx=>ctx.db.query('players').collect())).toHaveLength(1);
  });
  it('binds registration to the requesting session',async()=>{
    await t.mutation(api.room.join,{token:otherToken,name:'Someone',look});
    const request=await t.action(api.passkeys.registrationOptions,{token,origin}),device=await authenticator();
    const response=await device.register(request.options.challenge);
    await expect(t.action(api.passkeys.register,{token:otherToken,id:request.id,response})).rejects.toThrow('browser');
    await t.action(api.passkeys.register,{token,id:request.id,response});
    await expect(t.action(api.passkeys.register,{token,id:request.id,response})).rejects.toThrow('expired');
  });
  it.each(['wrong origin','wrong challenge','no user verification'])('rejects registration with %s',async reason=>{
    const device=await authenticator(),request=await t.action(api.passkeys.registrationOptions,{token,origin});
    const response=await device.register(reason==='wrong challenge'?'bad':request.options.challenge,{...(reason==='wrong origin'?{origin:'https://evil.example'}:{}),...(reason==='no user verification'?{flags:0x41}:{})});
    await expect(t.action(api.passkeys.register,{token,id:request.id,response})).rejects.toThrow('verified');
    expect((await t.query(api.identity.status,{token})).saved).toBe(false);
  });
  it.each(['bad signature','wrong origin','wrong challenge','wrong player','no user verification'])('rejects authentication with %s without creating a session',async reason=>{
    const device=await saveKey(),request=await t.action(api.passkeys.authenticationOptions,{origin});
    const response=await device.authenticate(reason==='wrong challenge'?'bad':request.options.challenge,{
      ...(reason==='bad signature'?{badSignature:true}:{}),...(reason==='wrong origin'?{origin:'https://evil.example'}:{}),
      ...(reason==='wrong player'?{userHandle:'someone-else'}:{}),...(reason==='no user verification'?{flags:1}:{})});
    await expect(t.action(api.passkeys.authenticate,{id:request.id,response})).rejects.toThrow();
    expect(await t.run(ctx=>ctx.db.query('sessions').collect())).toHaveLength(1);
  });
  it('rejects untrusted origins and expired challenges',async()=>{
    await expect(t.action(api.passkeys.authenticationOptions,{origin:'https://evil.example'})).rejects.toThrow('usual address');
    const device=await authenticator(),request=await t.action(api.passkeys.registrationOptions,{token,origin});
    later(5*60000+1);
    await expect(t.action(api.passkeys.register,{token,id:request.id,response:await device.register(request.options.challenge)})).rejects.toThrow('expired');
  });
  it('does not bypass moderation with a saved passkey',async()=>{
    const device=await saveKey();
    await t.run(ctx=>ctx.db.patch(player.id,{blockedUntil:Date.now()+60000}));
    const request=await t.action(api.passkeys.authenticationOptions,{origin});
    await expect(t.action(api.passkeys.authenticate,{id:request.id,response:await device.authenticate(request.options.challenge)})).rejects.toThrow('removed');
  });
  it('keeps guest and admin sessions after years without a visit or renewal',async()=>{
    vi.stubEnv('GRANT_ENTRY_HASH',await hash('owner-secret'));
    const admin=await t.mutation(api.room.join,{token:otherToken,name:'Grant',look,entryCode:'owner-secret'});
    later(10*365*24*60*60*1000);
    await t.mutation(internal.room.cleanup,{});
    expect((await t.mutation(api.identity.resume,{token})).id).toBe(player.id);
    expect((await t.mutation(api.identity.resume,{token:otherToken})).id).toBe(admin.id);
    expect((await t.run(ctx=>ctx.db.query('sessions').collect())).every(s=>s.expiresAt===undefined)).toBe(true);
    await expect(t.query(api.room.checkName,{name:'Visitor'})).rejects.toThrow('already taken');
    await expect(t.mutation(api.room.join,{token:'c'.repeat(64),name:'Visitor',look})).rejects.toThrow('already taken');
  });
  it.each([false,true])('retains legacy sessions past their old expiry (cleanup first: %s)',async cleanup=>{
    vi.stubEnv('GRANT_ENTRY_HASH',await hash('owner-secret'));
    await t.mutation(api.room.join,{token:otherToken,name:'Grant',look,entryCode:'owner-secret'});
    await t.run(async ctx=>{for(const s of await ctx.db.query('sessions').collect())await ctx.db.patch(s._id,{expiresAt:1});});
    if(cleanup)await t.mutation(internal.room.cleanup,{});
    for(const remembered of [token,otherToken]){
      await t.query(api.room.me,{token:remembered});
      await t.mutation(api.identity.resume,{token:remembered});
    }
    const sessions=await t.run(ctx=>ctx.db.query('sessions').collect());
    expect(sessions).toHaveLength(2);expect(sessions.every(s=>s.expiresAt===undefined)).toBe(true);
  });
  it('reusing an unsaved name after explicit sign-out creates a new identity and never transfers a space',async()=>{
    await t.run(async ctx=>{const room=await ctx.db.query('rooms').first();await ctx.db.patch(room._id,{spaces:[{id:'old',owner:player.id,ownerName:player.name,name:'Original space',width:8,depth:8,floor:'wood',floorColor:'#ffffff',createdAt:Date.now()}]});});
    await t.mutation(api.room.leave,{token});later(4*60*60*1000+1);
    const newcomer=await t.mutation(api.room.join,{token:otherToken,name:'Visitor',look});
    expect(newcomer.id).not.toBe(player.id);
    const old=await t.run(ctx=>ctx.db.get(player.id));expect(old.nameKey).toBe(`retired:${player.id}`);
    expect((await t.query(api.room.roomState,{token:otherToken})).spaces[0].owner).toBe(player.id);
    await expect(t.query(api.room.me,{token})).rejects.toThrow('session');
  });
});

describe('backup codes',()=>{
  it('reserves the name, stores only a hash, and restores the same character once',async()=>{
    const {code}=await t.mutation(api.identity.makeBackup,{token});
    expect(code).toMatch(/^[a-f0-9]{8}(-[a-f0-9]{8}){7}$/);
    const stored=await t.run(ctx=>ctx.db.query('recoveryKeys').first());
    expect(stored.tokenHash).toBe(await hash(code.replaceAll('-','')));
    expect(JSON.stringify(stored)).not.toContain(code);
    expect(await t.query(api.identity.status,{token})).toMatchObject({saved:true,hasBackup:true,passkeys:0});
    later(40*24*60*60*1000);
    await expect(t.mutation(api.room.join,{token:otherToken,name:'Visitor',look})).rejects.toThrow('saved character');
    const result=await t.mutation(api.identity.useBackup,{code});
    expect(result.player).toMatchObject({id:player.id,name:'Visitor',look});
    expect((await t.query(api.room.me,{token:result.token})).id).toBe(player.id);
    expect((await t.query(api.identity.status,{token:result.token})).hasBackup).toBe(false);
    expect(await t.mutation(api.identity.useBackup,{code})).toHaveProperty('error');
  });
  it('replacing a code invalidates the previous one',async()=>{
    const first=await t.mutation(api.identity.makeBackup,{token}),next=await t.mutation(api.identity.makeBackup,{token});
    expect(await t.mutation(api.identity.useBackup,{code:first.code})).toHaveProperty('error');
    const result=await t.mutation(api.identity.useBackup,{code:next.code.toUpperCase().replaceAll('-',' ')});
    expect(result.player.id).toBe(player.id);
    expect(await t.run(ctx=>ctx.db.query('recoveryKeys').collect())).toHaveLength(0);
  });
  it('lets a recovered visitor save a new backup and retain their name',async()=>{
    const first=await t.mutation(api.identity.makeBackup,{token});
    const recovered=await t.mutation(api.identity.useBackup,{code:first.code});
    const next=await t.mutation(api.identity.makeBackup,{token:recovered.token});
    expect(next.code).not.toBe(first.code);
    const again=await t.mutation(api.identity.useBackup,{code:next.code});expect(again.player.id).toBe(player.id);
  });
  it('counts unsuccessful attempts and throttles them',async()=>{
    for(let i=0;i<120;i++)expect(await t.mutation(api.identity.useBackup,{code:'invalid'})).toHaveProperty('error');
    await expect(t.mutation(api.identity.useBackup,{code:'invalid'})).rejects.toThrow('wait');
    later(60001);
    expect(await t.mutation(api.identity.useBackup,{code:'a'.repeat(101)})).toHaveProperty('error');
  });
  it('blocks recovery during moderation without consuming the backup',async()=>{
    const {code}=await t.mutation(api.identity.makeBackup,{token});
    await t.run(ctx=>ctx.db.patch(player.id,{blockedUntil:Date.now()+60000}));
    await expect(t.mutation(api.identity.useBackup,{code})).rejects.toThrow('removed');
    later(60001);expect((await t.mutation(api.identity.useBackup,{code})).player.id).toBe(player.id);
  });
  it('never exposes backups to other visitors and requires a session to replace one',async()=>{
    const {code}=await t.mutation(api.identity.makeBackup,{token});
    expect(JSON.stringify(await t.query(api.room.preview,{}))).not.toContain(code);
    await expect(t.mutation(api.identity.makeBackup,{token:otherToken})).rejects.toThrow('session');
    await expect(t.query(api.identity.status,{token:otherToken})).rejects.toThrow('session');
  });
  it('keeps the owner’s existing private entry link as their backup',async()=>{
    vi.stubEnv('GRANT_ENTRY_HASH',await hash('owner-secret'));
    await t.mutation(api.room.join,{token:otherToken,name:'Grant',look,entryCode:'owner-secret'});
    await expect(t.mutation(api.identity.makeBackup,{token:otherToken})).rejects.toThrow('private entry link');
    expect((await t.query(api.identity.status,{token:otherToken})).backupAvailable).toBe(false);
  });
});
