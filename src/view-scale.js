export function displayScaleForZoom(zoom,fit,pixelRatio){
  const physicalScale=fit*zoom*pixelRatio;
  // One extra overview level below native pixels.
  if(zoom!==1&&physicalScale<.75)return .5/pixelRatio;
  // Fit the untouched default view; snap chosen zoom levels to the nearest pixel.
  const steps=zoom===1?Math.floor(physicalScale+1e-6):Math.round(physicalScale);
  return Math.max(.5,steps)/pixelRatio;
}
