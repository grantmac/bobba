import {wearablePrompt,wearableSize,wearableLayout} from '../shared/wearables.js';
import {prepareWearable} from '../shared/wearable-build.js';
import {decodeImage} from '../shared/image-codec.js';
import {choices} from '../convex/lib/appearance.js';
const object=(properties,required=[])=>({type:'object',properties,required,additionalProperties:false});
const slot={type:'string',enum:['headwear','top','jacket'],description:'Use top for custom shirts, T-shirts and tops that replace the base shirt; headwear for hats/helmets; jacket for outerwear.'},source={slot,storage_id:{type:'string'},template_model:{type:'string',description:'Required for top: copy template_model from design_wearable. Preserves the exact shirt cut and sleeve fit.'}};
export const wearableTools=[
  {name:'design_wearable',description:'Create custom clothing: shirts/T-shirts/tops (top), hats/helmets (headwear), or jackets (jacket). Tops replace the base shirt in the normal Tops tab. Returns an avatar alignment guide, exact cell/pose layout and, for tops, a clothing-only fitting template from the current shirt cut. Repaint that template; every sleeve stays in its original layer. All eight angles; tops and jackets include walking, sitting, waving, dancing and carrying a drink. Use this workflow for custom shirts; no browser editor workaround is needed.',inputSchema:object({name:{type:'string'},slot,description:{type:'string'}},['name','slot','description'])},
  {name:'preview_wearable',description:'Preview an uploaded wearable on your avatar before publishing. Uses the same renderer as the room. Inspect alignment in every supplied pose.',inputSchema:object(source,['slot','storage_id'])},
  {name:'submit_wearable',description:'Save custom clothing after previewing it. Appears under Hats, Tops or Jackets in the normal appearance editor. For tops, pass template_model from design_wearable; artwork must cover the fitting template, and pixels outside the garment are clipped. No room placement or online presence is needed. Does not automatically equip it.',inputSchema:object({...source,name:{type:'string'}},['slot','storage_id','name'])},
  {name:'list_wearables',description:'Read your latest 100 wearable designs, current outfit and equipped pieces. Clothing belongs to your avatar, independently of any room.',inputSchema:object({})},
  {name:'equip_wearable',description:'Equip a shared wearable on your own player, or pass null to remove that slot. Each player chooses their own clothes; matching team outfits use the same wearable ID.',inputSchema:object({slot,wearable_id:{type:['string','null']}},['slot','wearable_id'])},
];
export function wearableHandlers({call,api,render,loadSource,uploader}){
  async function fittingTemplate(args,token,origin){
    if(args.slot!=='top')return null;
    if(!choices.top.includes(args.template_model))throw new Error('Pass the template_model returned by design_wearable.');
    const {look}=await call('query',api.wearables.outfit,{agentToken:token});
    const data=await render(origin,{mode:'wearable',look,slot:'top',template:true,templateModel:args.template_model});
    return decodeImage(Buffer.from(data,'base64'));
  }
  return {
    async design_wearable(args,{token,origin}){
      if(!['headwear','top','jacket'].includes(args.slot))throw new Error('Choose headwear, top or jacket.');
      const {look,wearables=[]}=await call('query',api.wearables.outfit,{agentToken:token});
      const templateModel=wearables.find(w=>w.slot==='top')?.templateModel??look.top.model;
      const data=await render(origin,{mode:'wearable',look,slot:args.slot,guide:true,templateModel});
      const next=args.slot==='top'?'Use the attached guide and fitting template to align the generated clothing. Keep template_model in preview and submission.':'Use the attached guide to align the generated clothing.';
      const content=[{type:'text',text:JSON.stringify({prompt:wearablePrompt(args),size:wearableSize(args.slot),layout:wearableLayout(args.slot),...(args.slot==='top'?{template_model:templateModel}:{}),next:next+' upload_url → preview_wearable → submit_wearable → equip_wearable when requested.'})},{type:'image',mimeType:'image/webp',data}];
      if(args.slot==='top')content.push({type:'image',mimeType:'image/webp',data:await render(origin,{mode:'wearable',look,slot:'top',template:true,templateModel})});
      return {content};
    },
    async preview_wearable(args,{token,origin}){
      const template=await fittingTemplate(args,token,origin);
      const buffer=await prepareWearable(await loadSource(token,args),args.slot,template);
      const {look,wearables}=await call('query',api.wearables.outfit,{agentToken:token});
      const data=await render(origin,{mode:'wearable',look:{...look,_wearables:wearables},slot:args.slot,wearable:{slot:args.slot,templateModel:args.template_model,url:'data:image/webp;base64,'+buffer.toString('base64')}});
      return {content:[{type:'image',mimeType:'image/webp',data},{type:'text',text:'Check all eight directions and, for tops and jackets, walking, sitting, standing/seated waving, all eight dance frames and the drink-carrying versions. Publish with submit_wearable only if every pose is aligned.'}]};
    },
    async submit_wearable(args,{token,origin}){
      const template=await fittingTemplate(args,token,origin);
      const buffer=await prepareWearable(await loadSource(token,args),args.slot,template),storageId=await uploader(token)(buffer);
      try{
        const result=await call('mutation',api.wearables.create,{agentToken:token,name:args.name,slot:args.slot,...(args.slot==='top'?{templateModel:args.template_model}:{}),storageId});
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
