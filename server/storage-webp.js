import {decodeImage,encodeWebp} from '../shared/image-codec.js';

// Sharing is confined to the caller's independently deletable asset/space.
// Verify the complete RGBA bitmap before storing anything; retain source files.
export async function convertStoredImages(ctx,ids){
  const files=[],encoded=[];let filesChecked=0;
  for(const previous of new Set(ids)){
    const blob=await ctx.storage.get(previous);
    if(!blob)throw Error(`Missing image ${previous}`);
    const source=Buffer.from(await blob.arrayBuffer());filesChecked++;
    if(source.toString('ascii',0,4)==='RIFF'&&source.toString('ascii',8,12)==='WEBP')continue;
    const image=await decodeImage(source),webp=await encodeWebp(image),decoded=await decodeImage(webp);
    if(decoded.width!==image.width||decoded.height!==image.height||!decoded.bitmap.data.equals(image.bitmap.data))throw Error(`WebP conversion changed pixels: ${previous}`);
    const duplicate=encoded.find(file=>file.buffer.equals(webp));
    const next=duplicate?.id??await ctx.storage.store(new Blob([new Uint8Array(webp)],{type:'image/webp'}));
    if(!duplicate)encoded.push({buffer:webp,id:next});
    files.push({previous,next,sourceBytes:source.length,optimizedBytes:duplicate?0:webp.length});
  }
  return {files,filesChecked};
}
