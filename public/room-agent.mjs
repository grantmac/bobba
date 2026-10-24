#!/usr/bin/env node
// Dependency-free entry helper and stdio MCP bridge. Node 20+.
import {mkdir,readFile,writeFile,rename,open,unlink} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {createInterface} from 'node:readline';
import {spawnSync} from 'node:child_process';

export function options(argv){
  const args=[...argv],opts={command:args.shift()??'help',origin:'https://chat.grantm.ac',client:'other',args:[]};
  while(args.length){const arg=args.shift();if(['--origin','--client'].includes(arg))opts[arg.slice(2)]=args.shift();else opts.args.push(arg);}
  const url=new URL(opts.origin);
  if(url.username||url.password||url.search||url.hash||url.pathname!=='/'||(url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname))))throw new Error('Use an HTTPS room origin (or local development server).');
  opts.origin=url.origin;
  if(!['chatgpt','codex','claude','other'].includes(opts.client))throw new Error('Client must be chatgpt, codex, claude or other.');
  return opts;
}
export function createAgent(opts){
  const client=['chatgpt','codex'].includes(opts.client)?'ChatGPT':opts.client==='claude'?'Claude':'Agent';
  const directory=join(process.env.ROOM_AGENT_HOME||join(homedir(),'.habbo-room'),createHash('sha256').update(opts.origin).digest('hex').slice(0,16));
  const path=join(directory,`${client.toLowerCase()}.json`);
  async function read(){try{return JSON.parse(await readFile(path,'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw new Error('The saved room connection could not be read.');}}
  async function save(value){
    await mkdir(directory,{recursive:true,mode:0o700});
    const temp=`${path}.${randomUUID()}.tmp`;
    await writeFile(temp,JSON.stringify(value),{mode:0o600,flag:'wx'});
    await rename(temp,path);
  }
  async function request(route,body,token){
    const response=await fetch(opts.origin+route,{method:'POST',redirect:'error',signal:AbortSignal.timeout(65000),headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)});
    if(!response.ok)throw new Error(`Room request failed (${response.status}). Try again shortly.`);
    return response.json();
  }
  const rpc=(method,params,token)=>request('/api/mcp',{jsonrpc:'2.0',id:1,method,params},token);
  const startInfo=saved=>({launchUrl:saved.launchUrl,verification:saved.verification,expiresAt:saved.expiresAt,client,instructions:'Open launchUrl in your in-app browser if available, otherwise the default browser. Show the verification code to the user. Let them choose their character and approve the connection themselves. Call connection_status every 3 seconds while waiting; do not click approval for them.'});
  async function locked(fn){
    await mkdir(directory,{recursive:true,mode:0o700});
    let lock;
    try{lock=await open(`${path}.lock`,'wx',0o600);}catch(error){
      if(error.code!=='EEXIST')throw error;
      const pid=Number(await readFile(`${path}.lock`,'utf8').catch(()=>''));
      let abandoned=false;
      if(Number.isInteger(pid)&&pid>0){try{process.kill(pid,0);}catch(error){abandoned=error.code==='ESRCH';}}
      if(!abandoned)throw new Error('Another room connection check is in progress. Try again shortly.');
      await unlink(`${path}.lock`);lock=await open(`${path}.lock`,'wx',0o600);
    }
    await lock.writeFile(String(process.pid));
    try{return await fn();}finally{await lock.close();await unlink(`${path}.lock`);}
  }
  async function connect(){
    return locked(async()=>{
      const saved=await read();
      if(saved?.pending&&saved.expiresAt>Date.now()){
        const result=await request('/api/connect',{action:'status'},saved.agentToken);
        if(['pending','approved','connected'].includes(result.state))return startInfo(saved);
      }
      let token;
      if(saved&&!saved.pending){
        const check=await rpc('tools/call',{name:'status',arguments:{}},saved.agentToken);
        if(check.result&&!check.result.isError)token=saved.agentToken;
      }
      const result=await request('/api/connect',{action:'start',client},token);
      if(!/^[a-f0-9]{64}$/.test(result.agentToken)||new URL(result.launchUrl).origin!==opts.origin)throw new Error('The room returned an invalid connection.');
      const next={...result,pending:true};await save(next);return startInfo(next);
    });
  }
  async function status(){
    return locked(async()=>{
    const saved=await read();if(!saved)return {state:'not_connected'};
    if(saved.pending){
      const result=await request('/api/connect',{action:'status'},saved.agentToken);
      if(!['approved','connected'].includes(result.state))return result;
    }
    const result=await rpc('tools/call',{name:'status',arguments:{}},saved.agentToken);
    if(result.error||result.result?.isError)return {state:'revoked',message:'Open a new room connection.'};
    const player=JSON.parse(result.result.content[0].text);
    if(saved.pending)await save({...saved,pending:false});
    return {state:'connected',playerName:player.playerName,playerId:player.playerId,
      ...(player.capabilitySummary?{capabilitySummary:player.capabilitySummary}:{}),
      ...(player.connectionInstructions?{connectionInstructions:player.connectionInstructions}:{})};
    });
  }
  const content=value=>({content:[{type:'text',text:JSON.stringify(value)}]});
  const localTools=[
    {name:'open_room',description:'Open or reconnect the shared room. Returns a temporary browser URL and verification code; open it for the user, who approves their own connection. Then call connection_status.',inputSchema:{type:'object',properties:{},additionalProperties:false}},
    {name:'connection_status',description:'Check whether the player approved and confirm the MCP connection. Poll at most once every 3 seconds while waiting.',inputSchema:{type:'object',properties:{},additionalProperties:false}},
  ];
  async function dispatch(method,params={}){
    if(method==='initialize'){
      const remote=await rpc(method,params);
      if(remote.error)throw new Error(remote.error.message);
      return remote.result;
    }
    if(method==='ping')return {};
    if(method==='tools/list'){
      const remote=await rpc(method,params);
      if(remote.error)throw new Error(remote.error.message);
      return {tools:[...localTools,...remote.result.tools]};
    }
    if(method!=='tools/call')throw new Error('Unsupported method.');
    if(params.name==='open_room')return content(await connect());
    if(params.name==='connection_status')return content(await status());
    const saved=await read();
    if(!saved||saved.pending)throw new Error('Call open_room, let the player approve, then call connection_status first.');
    const remote=await rpc(method,params,saved.agentToken);
    if(remote.error)throw new Error(remote.error.message);
    return remote.result;
  }
  return {connect,status,dispatch};
}
export function installation(opts,script=fileURLToPath(import.meta.url)){
  const args=[resolve(script),'mcp','--origin',opts.origin,'--client',opts.client];
  const env=process.env.ROOM_AGENT_HOME?{ROOM_AGENT_HOME:resolve(process.env.ROOM_AGENT_HOME)}:undefined;
  const flags=env?['--env',`ROOM_AGENT_HOME=${env.ROOM_AGENT_HOME}`]:[];
  return {name:'habbo-room-entry',server:{command:process.execPath,args,...(env?{env}:{})},binary:opts.client==='claude'?'claude':'codex',args:opts.client==='claude'?['mcp','add',...flags,'--scope','user','--transport','stdio','habbo-room-entry','--',process.execPath,...args]:['mcp','add',...flags,'habbo-room-entry','--',process.execPath,...args]};
}
export async function main(argv){
  const opts=options(argv),agent=createAgent(opts);
  const print=value=>process.stdout.write(JSON.stringify(value)+'\n');
  if(opts.command==='connect')return print(await agent.connect());
  if(opts.command==='status')return print(await agent.status());
  if(opts.command==='tools')return print(await agent.dispatch('tools/list'));
  if(opts.command==='call')return print(await agent.dispatch('tools/call',{name:opts.args[0],arguments:JSON.parse(opts.args[1]??'{}')}));
  if(['config','install'].includes(opts.command)){
    const setup=installation(opts);
    if(opts.command==='config'||opts.client==='other')return print({mcpServers:{[setup.name]:setup.server}});
    const existing=spawnSync(setup.binary,['mcp','get',setup.name],{encoding:'utf8'});
    if(existing.error)throw new Error(`${setup.binary} is not available. Use the config command to get settings for your MCP client.`);
    if(existing.status===0)return print({installed:false,message:'habbo-room-entry already exists; its configuration was left unchanged. Use config to compare it.'});
    // No shell interpolation, no credentials in client configuration or process arguments.
    const result=spawnSync(setup.binary,setup.args,{encoding:'utf8'});
    if(result.error||result.status!==0)throw new Error(`MCP registration failed. Use config for manual setup. ${result.stderr??''}`);
    return print({installed:true,message:'MCP registered. Your client may need to reload its tools or start a new chat. The call command works immediately.'});
  }
  if(opts.command==='mcp'){
    for await(const line of createInterface({input:process.stdin,crlfDelay:Infinity})){
      let message;
      try{message=JSON.parse(line);}catch{print({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Invalid JSON'}});continue;}
      if(!message||message.jsonrpc!=='2.0'||typeof message.method!=='string'){print({jsonrpc:'2.0',id:message?.id??null,error:{code:-32600,message:'Invalid request'}});continue;}
      if(message.id==null)continue;
      try{print({jsonrpc:'2.0',id:message.id,result:await agent.dispatch(message.method,message.params)});}
      catch(error){
        if(message.method==='tools/call')print({jsonrpc:'2.0',id:message.id,result:{content:[{type:'text',text:error.message}],isError:true}});
        else print({jsonrpc:'2.0',id:message.id,error:{code:-32603,message:error.message}});
      }
    }
    return;
  }
  print({usage:'node room-agent.mjs connect|status|tools|call|install|config|mcp --client chatgpt|codex|claude|other --origin https://chat.grantm.ac',notes:'Save this helper in a permanent location before install. Credentials are stored privately under ~/.habbo-room; ROOM_AGENT_HOME overrides that directory. Never paste the saved credential file into chat.'});
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)main(process.argv.slice(2)).catch(error=>{process.stderr.write(error.message+'\n');process.exitCode=1;});
