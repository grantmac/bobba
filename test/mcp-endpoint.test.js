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
  it('answers initialize with a supported protocol version and tool capability',async()=>{
    const reply=await (await post(rpc('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'t',version:'0'}}))).json();
    expect(reply.result.protocolVersion).toBe('2025-03-26');expect(reply.result.capabilities).toEqual({tools:{}});expect(reply.result.serverInfo.name).toBe('habbo-room');
    expect(reply.result.instructions).toContain('Use room_overview for routine room checks');
    expect(reply.result.instructions).not.toContain('room_picture');
    const newer=await (await post(rpc('initialize',{protocolVersion:'2099-01-01'}))).json();
    expect(newer.result.protocolVersion).toBe('2025-06-18');
  });
  it('lists the tools and answers notifications with 202',async()=>{
    const {result}=await (await post(rpc('tools/list'))).json();
    expect(result.tools.map(t=>t.name)).toEqual(['status','design_asset','upload_url','preview_asset','submit_asset','add_asset','my_assets','set_controls','get_connections','set_connections','program_api','get_program','set_program','set_seat','delete_asset','room_map','room_overview','place','remove','add_space','design_surface','style_space','resize_space','remove_space']);
    const space=result.tools.find(t=>t.name==='add_space');
    expect(space.inputSchema.properties.level).not.toHaveProperty('default');
    expect(space.inputSchema.required).toEqual(['name']);expect(space.inputSchema.properties).not.toHaveProperty('width');expect(space.inputSchema.properties.floor.enum).toEqual(['plain','wood','tiles','carpet']);
    for(const tool of result.tools)expect(tool.inputSchema.type).toBe('object');
    for(const name of ['design_asset','add_asset','preview_asset'])expect(result.tools.find(t=>t.name===name).inputSchema.properties.frames).toMatchObject({minimum:2,maximum:8});
    expect(result.tools.find(t=>t.name==='place').inputSchema.properties.support_id.type).toBe('string');
    expect(result.tools.find(t=>t.name==='preview_asset').inputSchema.properties.foreground_mask_storage_id.type).toBe('string');
    const controls=result.tools.find(t=>t.name==='set_controls');
    expect(controls.inputSchema.required).toEqual(['asset_id','use','power']);
    expect(controls.inputSchema.properties.use.type).toEqual(['string','null']);
    expect((await post({jsonrpc:'2.0',method:'notifications/initialized'})).status).toBe(202);
  });
  it('exposes room tiers and forwards the selected level to the authenticated mutation',async()=>{
    const {result:listing}=await (await post(rpc('tools/list'))).json();
    expect(listing.tools.find(t=>t.name==='add_space').inputSchema.properties.level.enum).toEqual([-1,0,1]);
    vi.stubEnv('CONVEX_URL','https://example.convex.cloud');
    const mutation=vi.spyOn(ConvexHttpClient.prototype,'mutation').mockResolvedValue({spaceId:'garden',level:1});
    try{
      const {result}=await (await post(rpc('tools/call',{name:'add_space',arguments:{name:'Garden',level:1}}),{Authorization:`Bearer ${'a'.repeat(64)}`})).json();
      expect(result.isError).toBeUndefined();
      expect(mutation.mock.calls[0][1]).toEqual({agentToken:'a'.repeat(64),name:'Garden',level:1});
      expect(JSON.parse(result.content[0].text)).toMatchObject({spaceId:'garden',level:1});
    }finally{mutation.mockRestore();vi.unstubAllEnvs();}
  });
  it('refuses tool calls without a key and explains how to get one',async()=>{
    const {result}=await (await post(rpc('tools/call',{name:'status',arguments:{}}))).json();
    expect(result.isError).toBe(true);expect(result.content[0].text).toMatch(/Build with your agent/);
    const bad=await (await post(rpc('tools/call',{name:'status',arguments:{}}),{Authorization:'Bearer not-a-key'})).json();
    expect(bad.result.isError).toBe(true);
  });
  it('returns a text overview with one query and no image renderer',async()=>{
    vi.stubEnv('CONVEX_URL','https://example.convex.cloud');
    const query=vi.spyOn(ConvexHttpClient.prototype,'query').mockResolvedValue({players:[{name:'Visitor'}],furniture:[]});
    try{
      const {result}=await (await post(rpc('tools/call',{name:'room_overview'}),{Authorization:`Bearer ${'a'.repeat(64)}`})).json();
      expect(result.isError).toBeUndefined();expect(result.content.map(c=>c.type)).toEqual(['text']);
      expect(JSON.parse(result.content[0].text).players[0].name).toBe('Visitor');
      expect(query).toHaveBeenCalledTimes(1);expect(query.mock.calls[0][1]).toEqual({agentToken:'a'.repeat(64),focus:'room'});
    }finally{query.mockRestore();vi.unstubAllEnvs();}
  });
  it('directs retired screenshot calls to text without calling Convex or fetching files',async()=>{
    const query=vi.spyOn(ConvexHttpClient.prototype,'query'),mutation=vi.spyOn(ConvexHttpClient.prototype,'mutation');
    const fetch=vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('Unexpected download'));
    try{
      for(const renderer of ['server','tab']){
        const {error}=await (await post(rpc('tools/call',{name:'room_picture',arguments:{renderer}}),{Authorization:`Bearer ${'a'.repeat(64)}`})).json();
        expect(error.code).toBe(-32602);expect(error.message).toContain('room_overview');
      }
      expect(query).not.toHaveBeenCalled();expect(mutation).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();
    }finally{query.mockRestore();mutation.mockRestore();fetch.mockRestore();}
  });
  it('provides the executable furniture contract without contacting the backend',async()=>{
    const {result}=await (await post(rpc('tools/call',{name:'program_api'}),{Authorization:`Bearer ${'a'.repeat(64)}`})).json();
    const reference=JSON.parse(result.content[0].text);
    expect(reference.apiVersion).toBe(1);expect(reference.examples.spinningChair).toContain("api.on('tick'");
    expect(reference.methods['await saveState(json)']).toContain('Host only');
    expect(reference.examples.proximitySensor).toContain('api.sendSignal');
    expect(reference.examples.connectedLight).toContain('api.signals');
  });
  it('maps placed-copy connection tools to the authenticated backend',async()=>{
    vi.stubEnv('VITE_CONVEX_URL','https://example.convex.cloud');
    const mutation=vi.spyOn(ConvexHttpClient.prototype,'mutation').mockResolvedValue({itemId:'sensor',connections:[{name:'occupied',targetId:'light'}]});
    try{
      const {result}=await (await post(rpc('tools/call',{name:'set_connections',arguments:{item_id:'sensor',connections:[{name:'occupied',target_item_id:'light'}]}}),{Authorization:`Bearer ${'a'.repeat(64)}`})).json();
      expect(result.isError).toBeUndefined();expect(mutation.mock.calls[0][1]).toEqual({agentToken:'a'.repeat(64),itemId:'sensor',connections:[{name:'occupied',targetId:'light'}]});
      expect(JSON.parse(result.content[0].text)).toEqual({item_id:'sensor',connections:[{name:'occupied',target_item_id:'light'}]});
    }finally{mutation.mockRestore();vi.unstubAllEnvs();}
  });
  it('writes the design prompt with reference URLs on this origin, without a room server',async()=>{
    const key='a'.repeat(64);
    const {result}=await (await post(rpc('tools/call',{name:'design_asset',arguments:{name:'Lamp',description:'A brass desk lamp.',kind:'lamp',reference_image_path:'/tmp/lamp.png'}}),{Authorization:`Bearer ${key}`})).json();
    expect(result.isError).toBeUndefined();
    const design=JSON.parse(result.content[0].text);
    expect(design.prompt).toMatch(/REDRAW the object in reference image 1/);
    expect(design.attach).toEqual(['/tmp/lamp.png','https://chat.example.test/agent-reference/room-style.png','https://chat.example.test/agent-reference/sprite-sofa.png']);
    expect(design.then).toMatch(/upload_url/);
    expect(design.then).toMatch(/preview_asset/);expect(design.brief.scale.tile_px).toEqual([64,32]);
    expect(design.brief.views.map(v=>v.direction)).toEqual([2,4,6,0]);
    expect(result.content[1]).toMatchObject({type:'image',mimeType:'image/png'});
    const wall=JSON.parse((await (await post(rpc('tools/call',{name:'design_asset',arguments:{name:'Sign',description:'A neon sign.',kind:'wall'}}),{Authorization:`Bearer ${key}`})).json()).result.content[0].text);
    expect(wall.attach).toEqual(['https://chat.example.test/agent-reference/room-style.png','https://chat.example.test/agent-reference/sprite-wall-speaker.png']);
  });
  it('passes per-rotation seating corrections through the agent tool without mirroring them',async()=>{
    vi.stubEnv('CONVEX_URL','https://example.convex.cloud');
    const mutation=vi.spyOn(ConvexHttpClient.prototype,'mutation').mockResolvedValue({assetId:'chair'});
    try{
      const seat_offsets=[{rotation:6,x:0,y:-4}];
      const {result}=await (await post(rpc('tools/call',{name:'set_seat',arguments:{asset_id:'chair',seat_x:0,seat_z:1,seat_height:20,seat_offset_x:3,seat_offsets}}),{Authorization:`Bearer ${'a'.repeat(64)}`})).json();
      expect(result.isError).toBeUndefined();
      expect(mutation.mock.calls[0][1]).toEqual({agentToken:'a'.repeat(64),assetId:'chair',seat:{x:0,z:1,height:20,offsetX:3,offsets:seat_offsets}});
      const {result:listing}=await (await post(rpc('tools/list'))).json();
      for(const name of ['set_seat','submit_asset','add_asset','preview_asset'])expect(listing.tools.find(t=>t.name===name).inputSchema.properties.seat_offsets.items.required).toEqual(['rotation','x','y']);
    }finally{mutation.mockRestore();vi.unstubAllEnvs();}
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
