import {wearablePrompt,wearableSize} from '../shared/wearables.js';
import {prepareWearable} from '../shared/wearable-build.js';
const object=(properties,required=[])=>({type:'object',properties,required,additionalProperties:false});
const slot={type:'string',enum:['headwear','jacket']},source={slot,storage_id:{type:'string'}};
export const wearableTools=[
  {name:'design_wearable',description:'Start a custom hat, helmet or jacket. Returns the exact sprite-sheet prompt and an avatar alignment guide image. Generate only the clothing on transparency, then upload_url, preview_wearable and submit_wearable. All eight angles; jackets include walking, sitting, waving, dancing and carrying a drink.',inputSchema:object({name:{type:'string'},slot,description:{type:'string'}},['name','slot','description'])},
  {name:'preview_wearable',description:'Preview an uploaded wearable on your avatar before publishing. Uses the same renderer as the room. Inspect alignment in every supplied pose.',inputSchema:object(source,['slot','storage_id'])},
  {name:'submit_wearable',description:'Save a transparent wearable sheet to your avatar after previewing it. It appears under Hats or Jackets in the normal appearance editor. No room placement or online presence is needed. Does not automatically equip it.',inputSchema:object({...source,name:{type:'string'}},['slot','storage_id','name'])},
  {name:'list_wearables',description:'Read your latest 100 wearable designs, current outfit and equipped pieces. Clothing belongs to your avatar, independently of any room.',inputSchema:object({})},
  {name:'equip_wearable',description:'Equip a shared wearable on your own player, or pass null to remove that slot. Each player chooses their own clothes; matching team outfits use the same wearable ID.',inputSchema:object({slot,wearable_id:{type:['string','null']}},['slot','wearable_id'])},
];
export function wearableHandlers({call,api,render,loadSource,uploader}){
  return {
    async design_wearable(args,{token,origin}){
      if(!['headwear','jacket'].includes(args.slot))throw new Error('Choose headwear or jacket.');
      const {look}=await call('query',api.wearables.outfit,{agentToken:token});
      const data=await render(origin,{mode:'wearable',look,slot:args.slot,guide:true});
      return {content:[{type:'text',text:JSON.stringify({prompt:wearablePrompt(args),size:wearableSize(args.slot),next:'Use the attached guide to align the generated transparent clothing. upload_url → preview_wearable → submit_wearable → equip_wearable when requested.'})},{type:'image',mimeType:'image/png',data}]};
    },
    async preview_wearable(args,{token,origin}){
      const buffer=await prepareWearable(await loadSource(token,args),args.slot);
      const {look,wearables}=await call('query',api.wearables.outfit,{agentToken:token});
      const data=await render(origin,{mode:'wearable',look:{...look,_wearables:wearables},slot:args.slot,wearable:{slot:args.slot,url:'data:image/png;base64,'+buffer.toString('base64')}});
      return {content:[{type:'image',mimeType:'image/png',data},{type:'text',text:'Check all eight directions and, for jackets, walking, sitting, standing/seated waving, all eight dance frames and the drink-carrying versions. Publish with submit_wearable only if every pose is aligned.'}]};
    },
    async submit_wearable(args,{token}){
      const buffer=await prepareWearable(await loadSource(token,args),args.slot),storageId=await uploader(token)(buffer);
      try{
        const result=await call('mutation',api.wearables.create,{agentToken:token,name:args.name,slot:args.slot,storageId});
        await call('mutation',api.agents.discardUpload,{agentToken:token,storageId:args.storage_id}).catch(()=>{});
        return result;
      }catch(error){
        await call('mutation',api.agents.discardUpload,{agentToken:token,storageId}).catch(()=>{});
        throw error;
      }
    },
    async list_wearables(_,{token}){
      const outfit=await call('query',api.wearables.outfit,{agentToken:token});
      return {...outfit,catalogue:await call('query',api.wearables.listAgent,{agentToken:token})};
    },
    async equip_wearable({slot,wearable_id},{token}){return call('mutation',api.wearables.equipAgent,{agentToken:token,slot,wearableId:wearable_id});},
  };
}
