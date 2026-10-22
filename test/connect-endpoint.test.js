// @vitest-environment node
import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {POST,GET} from '../api/connect.js';
const client=vi.hoisted(()=>({mutation:vi.fn(),query:vi.fn()}));
vi.mock('convex/browser',()=>({ConvexHttpClient:class{constructor(){return client;}}}));
const post=(body,headers={})=>POST(new Request('https://chat.example.test/api/connect',{method:'POST',body:typeof body==='string'?body:JSON.stringify(body),headers}));
beforeEach(()=>{vi.resetAllMocks();vi.stubEnv('CONVEX_URL','https://example.convex.cloud');});
afterEach(()=>vi.unstubAllEnvs());
describe('entry HTTP endpoint',()=>{
  it('returns a non-cacheable launch link without putting the credential in its URL',async()=>{
    client.mutation.mockResolvedValue({code:'c'.repeat(64),agentToken:'d'.repeat(64),verification:'1234ABCD',expiresAt:123});
    const response=await post({action:'start',client:'Claude'}),body=await response.json();
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(body.launchUrl).toBe(`https://chat.example.test/#pair=${'c'.repeat(64)}`);expect(body.launchUrl).not.toContain(body.agentToken);
    expect(client.mutation.mock.calls[0][1]).toEqual({client:'Claude'});
  });
  it('requires the private bearer secret to poll and validates inputs before contacting the backend',async()=>{
    expect((await post({action:'status'})).status).toBe(401);
    expect((await post('not json')).status).toBe(400);
    expect((await post({action:'start',client:'<script>'})).status).toBe(400);
    expect((await post('x'.repeat(513))).status).toBe(413);
    expect(client.mutation).not.toHaveBeenCalled();expect(client.query).not.toHaveBeenCalled();
    client.query.mockResolvedValue({state:'approved'});
    expect(await (await post({action:'status'},{Authorization:`Bearer ${'d'.repeat(64)}`})).json()).toEqual({state:'approved'});
    expect((await GET()).headers.get('cache-control')).toBe('no-store');
  });
  it('does not expose backend logs in error responses',async()=>{
    client.mutation.mockRejectedValue(new Error('private deployment logs'));
    const response=await post({action:'start'});expect(response.status).toBe(503);expect(await response.text()).not.toContain('private deployment');
  });
});
