// Encode once at upload time. Both strategies preserve every RGBA pixel; keep the
// smaller result so noisy art never grows while repetitive sprites compress better.
export async function encodePng(image){
  const original=await image.getBuffer('image/png');
  const compressed=await image.getBuffer('image/png',{deflateStrategy:0});
  return compressed.length<original.length?compressed:original;
}
