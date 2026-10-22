export function displayScaleForZoom(zoom,fit,pixelRatio){
  const physicalScale=fit*zoom*pixelRatio;
  // Fit the untouched default view; snap chosen zoom levels to the nearest pixel.
  const steps=zoom===1?Math.floor(physicalScale+1e-6):Math.round(physicalScale);
  return Math.max(1,steps)/pixelRatio;
}
