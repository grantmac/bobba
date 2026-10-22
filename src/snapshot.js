// Off-screen rendering for local visual fixtures.
import * as THREE from 'three';
// Render targets come back in the renderer's linear working space; the screen gets sRGB.
const SRGB=Uint8ClampedArray.from({length:256},(_,i)=>{const c=i/255;return Math.round(255*(c<=.0031308?12.92*c:1.055*c**(1/2.4)-.055));});
export function renderPicture(renderer,scene,bounds,scale){
  const width=Math.round((bounds.right-bounds.left)*scale),height=Math.round((bounds.top-bounds.bottom)*scale);
  const camera=new THREE.OrthographicCamera(bounds.left,bounds.right,bounds.top,bounds.bottom,0.1,2000);camera.position.z=1000;
  const target=new THREE.WebGLRenderTarget(width,height,{minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter});
  const previous=renderer.getRenderTarget();
  renderer.setRenderTarget(target);renderer.render(scene,camera);
  const pixels=new Uint8Array(width*height*4);renderer.readRenderTargetPixels(target,0,0,width,height,pixels);
  renderer.setRenderTarget(previous);target.dispose();
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const ctx=canvas.getContext('2d'),image=ctx.createImageData(width,height);
  // GL hands rows back bottom-up.
  for(let y=0;y<height;y++){const from=(height-1-y)*width*4,to=y*width*4;for(let i=0;i<width*4;i+=4){image.data[to+i]=SRGB[pixels[from+i]];image.data[to+i+1]=SRGB[pixels[from+i+1]];image.data[to+i+2]=SRGB[pixels[from+i+2]];image.data[to+i+3]=255;}}
  ctx.putImageData(image,0,0);
  return canvas;
}
