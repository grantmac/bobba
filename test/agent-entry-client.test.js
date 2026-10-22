// @vitest-environment node
import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {createServer} from 'node:http';
import {mkdtemp,rm,readdir,readFile,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {createAgent,options,installation} from '../public/room-agent.mjs';

let server,origin,directory,requests,phase,agentToken;
const text=value=>({content:[{type:'text',text:JSON.stringify(value)}]});
beforeEach(async()=>{
  directory=await mkdtemp(join(tmpdir(),'room-entry-test-'));vi.stubEnv('ROOM_AGENT_HOME',directory);
  requests=[];phase='pending';agentToken='d'.repeat(64);
  server=createServer(async(req,res)=>{
    let raw='';for await(const chunk of req)raw+=chunk;
    const body=JSON.parse(raw);requests.push({url:req.url,auth:req.headers.authorization,body});
    let reply;
    if(req.url==='/api/connect')reply=body.action==='start'?{agentToken,launchUrl:`${origin}/#pair=${'e'.repeat(64)}`,verification:'AABBCCDD',expiresAt:Date.now()+600000}:{state:phase};
    else if(body.method==='initialize')reply={jsonrpc:'2.0',id:1,result:{protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'habbo-room',version:'test'}}};
    else if(body.method==='tools/list')reply={jsonrpc:'2.0',id:1,result:{tools:[{name:'open_room',inputSchema:{type:'object',properties:{}}},{name:'status',inputSchema:{type:'object',properties:{}}},{name:'room_map',inputSchema:{type:'object',properties:{}}}]}};
    else if(body.params?.name==='open_room')reply={jsonrpc:'2.0',id:1,result:text({url:`${origin}/#enter=${'f'.repeat(64)}`,playerName:'Visitor',expiresAt:Date.now()+120000})};
    else reply={jsonrpc:'2.0',id:1,result:phase==='revoked'?{isError:true,content:[{type:'text',text:'Not attached'}]}:text({playerName:'Visitor',playerId:'player-1'})};
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify(reply));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${server.address().port}`;
});
afterEach(async()=>{await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});vi.unstubAllEnvs();});
const agent=client=>createAgent(options(['connect','--origin',origin,'--client',client??'chatgpt']));
async function savedPath(){const [sub]=await readdir(directory);return join(directory,sub,'chatgpt.json');}
describe('portable room agent helper',()=>{
  it('launches without leaking secrets and verifies an actual MCP call before saying connected',async()=>{
    const bridge=agent(),launch=await bridge.connect();
    expect(JSON.stringify(launch)).not.toContain(agentToken);expect(launch.verification).toBe('AABBCCDD');
    expect(requests[0].body).toEqual({action:'start',client:'ChatGPT'});
    const file=await savedPath();expect((await stat(file)).mode&0o777).toBe(0o600);
    expect(JSON.parse(await readFile(file,'utf8')).agentToken).toBe(agentToken);
    expect(await bridge.status()).toEqual({state:'pending'});
    await expect(bridge.dispatch('tools/call',{name:'room_map'})).rejects.toThrow('approve');
    phase='approved';expect(await bridge.status()).toEqual({state:'connected',playerName:'Visitor',playerId:'player-1'});
    expect(requests.at(-1)).toMatchObject({url:'/api/mcp',auth:`Bearer ${agentToken}`,body:{method:'tools/call',params:{name:'status'}}});
    await bridge.dispatch('tools/call',{name:'room_map'});
    expect(requests.at(-1).body.params.name).toBe('room_map');
  });
  it('reuses a pending launch and an established key without reassigning identities',async()=>{
    const bridge=agent();await bridge.connect();await bridge.connect();
    expect(requests.filter(r=>r.body.action==='start')).toHaveLength(1);
    phase='approved';await bridge.status();const opened=await bridge.connect();
    expect(requests.at(-1)).toMatchObject({auth:`Bearer ${agentToken}`,body:{method:'tools/call',params:{name:'open_room'}}});
    expect(opened).toMatchObject({launchUrl:`${origin}/#enter=${'f'.repeat(64)}`,playerName:'Visitor'});
    expect(opened).not.toHaveProperty('verification');expect(JSON.stringify(opened)).not.toContain(agentToken);
    expect(requests.filter(r=>r.body.action==='start')).toHaveLength(1);
    phase='revoked';expect(await bridge.status()).toMatchObject({state:'revoked'});
  });
  it('keeps Claude credentials separate and exposes the same tools to any MCP client',async()=>{
    const chatgpt=agent(),claude=agent('claude');await chatgpt.connect();
    expect(await claude.status()).toEqual({state:'not_connected'});
    const result=await claude.dispatch('tools/list');expect(result.tools.map(t=>t.name)).toEqual(['open_room','connection_status','status','room_map']);
    expect(requests.at(-1).auth).toBeUndefined();await claude.connect();
    expect(requests.at(-1).body.client).toBe('Claude');
  });
  it('serves real newline-delimited MCP without logging credentials to stdout',async()=>{
    const child=spawn(process.execPath,[resolve('public/room-agent.mjs'),'mcp','--origin',origin,'--client','other'],{env:process.env});
    let stdout='',stderr='';child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);
    const done=new Promise(resolve=>child.on('close',resolve));
    child.stdin.end([
      {jsonrpc:'2.0',id:11,method:'initialize',params:{protocolVersion:'2025-06-18'}},
      {jsonrpc:'2.0',method:'notifications/initialized'},
      {jsonrpc:'2.0',id:12,method:'tools/list'},
      {jsonrpc:'2.0',id:13,method:'tools/call',params:{name:'open_room'}},
    ].map(value=>JSON.stringify(value)).join('\n')+'\n');
    expect(await done).toBe(0);expect(stderr).toBe('');expect(stdout).not.toContain(agentToken);
    const replies=stdout.trim().split('\n').map(JSON.parse);expect(replies.map(r=>r.id)).toEqual([11,12,13]);
    expect(replies[0].result.serverInfo.name).toBe('habbo-room');
    expect(JSON.parse(replies[2].result.content[0].text).launchUrl).toContain('/#pair=');
  });
  it('generates client-specific registrations with no credentials and rejects unsafe origins',()=>{
    vi.stubEnv('ROOM_AGENT_HOME','');
    const codex=installation(options(['install','--client','chatgpt']),'/tmp/room helper.mjs');
    expect(codex.binary).toBe('codex');expect(codex.args.slice(0,4)).toEqual(['mcp','add','habbo-room-entry','--']);
    const claude=installation(options(['install','--client','claude']),'/tmp/room helper.mjs');
    expect(claude.binary).toBe('claude');expect(claude.args.slice(0,8)).toEqual(['mcp','add','--scope','user','--transport','stdio','habbo-room-entry','--']);
    expect(JSON.stringify(claude)).not.toContain(agentToken);
    vi.stubEnv('ROOM_AGENT_HOME',directory);
    const isolated=installation(options(['install','--client','claude']));
    expect(isolated.server.env).toEqual({ROOM_AGENT_HOME:directory});expect(isolated.args).toContain(`ROOM_AGENT_HOME=${directory}`);
    for(const unsafe of ['http://example.com','https://me:secret@example.com','https://example.com/path','https://example.com?key=secret'])expect(()=>options(['connect','--origin',unsafe])).toThrow();
  });
});
