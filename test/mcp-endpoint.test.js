// @vitest-environment node
// The hosted MCP endpoint's protocol handling, without a room server: handshake, tool
// listing, key checks and malformed requests. Tool calls that reach Convex are covered by
// the agent tests in multiplayer.test.js through the same backend functions.
import {describe,it,expect,vi} from 'vitest';
import {ConvexHttpClient} from 'convex/browser';
import {POST,GET} from '../api/mcp.js';
const URL_='https://chat.example.test/api/mcp';
const post=(body,headers={})=>POST(new Request(URL_,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:typeof body==='string'?body:JSON.stringify(body)}));
const rpc=(method,params,id=1)=>({jsonrpc:'2.0',id,method,params});
describe('hosted MCP endpoint',()=>{
  it('returns a private browser link for the authenticated agent without returning its key',async()=>{
    const key='a'.repeat(64),url='https://chat.example.test/#enter='+('c'.repeat(64));
    const mutation=vi.spyOn(ConvexHttpClient.prototype,'mutation').mockResolvedValue({url,playerName:'Visitor',expiresAt:123});
    vi.stubEnv('CONVEX_URL','https://example.convex.cloud');
    try{
      const {result}=await (await post(rpc('tools/call',{name:'open_room',arguments:{}}),{Authorization:`Bearer ${key}`})).json();
      expect(mutation).toHaveBeenCalledWith(expect.anything(),{agentToken:key,origin:'https://chat.example.test'});
      expect(JSON.parse(result.content[0].text)).toMatchObject({url,playerName:'Visitor',expiresAt:123});
      expect(result.content[0].text).not.toContain(key);
    }finally{mutation.mockRestore();vi.unstubAllEnvs();}
  });
  it('answers initialize with a supported protocol version and tool capability',async()=>{
    const reply=await (await post(rpc('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'t',version:'0'}}))).json();
    expect(reply.result.protocolVersion).toBe('2025-03-26');expect(reply.result.capabilities).toEqual({tools:{}});expect(reply.result.serverInfo.name).toBe('habbo-room');
    const newer=await (await post(rpc('initialize',{protocolVersion:'2099-01-01'}))).json();
    expect(newer.result.protocolVersion).toBe('2025-06-18');
  });
  it('lists the tools and answers notifications with 202',async()=>{
    const {result}=await (await post(rpc('tools/list'))).json();
    expect(result.tools.map(t=>t.name)).toEqual(['open_room','status','design_asset','upload_url','submit_asset','add_asset','my_assets','program_api','get_program','set_program','set_seat','delete_asset','room_map','room_picture','place','remove','add_space','design_surface','style_space','resize_space','remove_space']);
    const space=result.tools.find(t=>t.name==='add_space');
    expect(space.inputSchema.required).toEqual(['name']);expect(space.inputSchema.properties).not.toHaveProperty('width');expect(space.inputSchema.properties.floor.enum).toEqual(['plain','wood','tiles','carpet']);
    for(const tool of result.tools)expect(tool.inputSchema.type).toBe('object');
    expect((await post({jsonrpc:'2.0',method:'notifications/initialized'})).status).toBe(202);
  });
  it('refuses tool calls without a key and explains how to get one',async()=>{
    const {result}=await (await post(rpc('tools/call',{name:'status',arguments:{}}))).json();
    expect(result.isError).toBe(true);expect(result.content[0].text).toMatch(/Build with your agent/);
    const bad=await (await post(rpc('tools/call',{name:'status',arguments:{}}),{Authorization:'Bearer not-a-key'})).json();
    expect(bad.result.isError).toBe(true);
  });
  it('provides the executable furniture contract without contacting the backend',async()=>{
    const {result}=await (await post(rpc('tools/call',{name:'program_api'}),{Authorization:`Bearer ${'a'.repeat(64)}`})).json();
    const reference=JSON.parse(result.content[0].text);
    expect(reference.apiVersion).toBe(1);expect(reference.examples.spinningChair).toContain("api.on('tick'");
    expect(reference.methods['await saveState(json)']).toContain('Host only');
  });
  it('writes the design prompt with reference URLs on this origin, without a room server',async()=>{
    const key='a'.repeat(64);
    const {result}=await (await post(rpc('tools/call',{name:'design_asset',arguments:{name:'Lamp',description:'A brass desk lamp.',kind:'lamp',reference_image_path:'/tmp/lamp.png'}}),{Authorization:`Bearer ${key}`})).json();
    expect(result.isError).toBeUndefined();
    const design=JSON.parse(result.content[0].text);
    expect(design.prompt).toMatch(/REDRAW the object in reference image 1/);
    expect(design.attach).toEqual(['/tmp/lamp.png','https://chat.example.test/agent-reference/room-style.png','https://chat.example.test/agent-reference/sprite-sofa.png']);
    expect(design.then).toMatch(/upload_url/);
    const wall=JSON.parse((await (await post(rpc('tools/call',{name:'design_asset',arguments:{name:'Sign',description:'A neon sign.',kind:'wall'}}),{Authorization:`Bearer ${key}`})).json()).result.content[0].text);
    expect(wall.attach).toEqual(['https://chat.example.test/agent-reference/room-style.png','https://chat.example.test/agent-reference/sprite-wall-speaker.png']);
  });
  it('writes a floor or wall picture prompt at the game\'s pixel scale',async()=>{
    const key='a'.repeat(64);
    const floor=JSON.parse((await (await post(rpc('tools/call',{name:'design_surface',arguments:{surface:'floor',description:'Black and white chequered tiles.'}}),{Authorization:`Bearer ${key}`})).json()).result.content[0].text);
    expect(floor.prompt).toMatch(/seamless pixel-art FLOOR TEXTURE/);expect(floor.prompt).toMatch(/exactly 64 by 64 game pixels/);expect(floor.prompt).toMatch(/edges wrap/);
    expect(floor.attach).toEqual(['https://chat.example.test/agent-reference/room-style.png']);expect(floor.then).toMatch(/floor_image_storage_id/);
    const wall=JSON.parse((await (await post(rpc('tools/call',{name:'design_surface',arguments:{surface:'wall',fit:'cover',description:'A night skyline.'}}),{Authorization:`Bearer ${key}`})).json()).result.content[0].text);
    expect(wall.prompt).toMatch(/WALL MURAL/);expect(wall.prompt).toMatch(/exactly 256 by 117 game pixels/);expect(wall.prompt).not.toMatch(/edges wrap/);expect(wall.then).toMatch(/wall_fit "cover"/);
  });
  it('rejects malformed requests, unknown methods and tools, and other verbs',async()=>{
    expect((await post('{not json')).status).toBe(400);
    expect((await (await post(rpc('nope'))).json()).error.code).toBe(-32601);
    expect((await (await post(rpc('tools/call',{name:'nope'}))).json()).error.code).toBe(-32602);
    expect((await (await post({id:1,method:'ping'})).json()).error.code).toBe(-32600);
    const batch=await (await post([rpc('ping',{},1),rpc('ping',{},2)])).json();
    expect(batch.map(r=>r.id)).toEqual([1,2]);
    expect((await GET()).status).toBe(405);
  });
});
