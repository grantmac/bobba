// The render host injects a read-only scene before any scripts run. Normal visitors use main.
if(window.__ROOM_RENDER_INPUT__?.mode==='asset'){
  import('./asset-preview.js').then(({renderAssetPreview})=>renderAssetPreview(window.__ROOM_RENDER_INPUT__.asset)).then(image=>{window.__ROOM_RENDER_RESULT__=image;}).catch(error=>{window.__ROOM_RENDER_ERROR__=error.message;});
}else{
  import('./main.js').catch(error=>{if(window.__ROOM_RENDER_INPUT__)window.__ROOM_RENDER_ERROR__=error.message;else console.error(error);});
}
