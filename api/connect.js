import {ConvexHttpClient} from 'convex/browser';
import {anyApi} from 'convex/server';

const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
export async function POST(request){
  const text=await request.text();
  if(text.length>512)return json({error:'Request too large.'},413);
  let body;
  try{body=JSON.parse(text);}catch{return json({error:'Expected JSON.'},400);}
  if(!body||!['start','status'].includes(body.action))return json({error:'Use action start or status.'},400);
  if(body.client!==undefined&&!['ChatGPT','Claude','Agent'].includes(body.client))return json({error:'Unknown client.'},400);
  const token=/^Bearer ([a-f0-9]{64})$/i.exec(request.headers.get('authorization')??'')?.[1];
  if(body.action==='status'&&!token)return json({error:'Missing pairing secret.'},401);
  const url=process.env.CONVEX_URL||process.env.VITE_CONVEX_URL;
  if(!url)return json({error:'The room server is not configured.'},503);
  try{
    const client=new ConvexHttpClient(url);
    if(body.action==='status')return json(await client.query(anyApi.agentPairing.status,{agentToken:token}));
    const {code,...pair}=await client.mutation(anyApi.agentPairing.start,{...(token?{agentToken:token}:{}),...(body.client?{client:body.client}:{})});
    return json({...pair,launchUrl:`${new URL(request.url).origin}/#pair=${code}`,pollAfterMs:3000});
  }catch(error){
    // ConvexError.data is the deliberately public error; don't expose server logs.
    return json({error:typeof error?.data==='string'?error.data:'The room could not prepare the connection. Try again.'},503);
  }
}
export const GET=()=>json({guide:'/connect',message:'Read the entry guide, then POST action start.'});
