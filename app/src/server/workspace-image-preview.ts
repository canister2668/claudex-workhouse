export const MAX_WORKSPACE_IMAGE_PREVIEW_BYTES=20*1024*1024;

export function workspaceImageMime(value:Buffer){
  if(value.length>=8&&value.subarray(0,8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])))return"image/png";
  if(value.length>=3&&value[0]===0xff&&value[1]===0xd8&&value[2]===0xff)return"image/jpeg";
  if(value.length>=6&&["GIF87a","GIF89a"].includes(value.subarray(0,6).toString("ascii")))return"image/gif";
  if(value.length>=12&&value.subarray(0,4).toString("ascii")==="RIFF"&&value.subarray(8,12).toString("ascii")==="WEBP")return"image/webp";
  if(value.length>=12&&value.subarray(4,8).toString("ascii")==="ftyp")for(let offset=8;offset+4<=Math.min(value.length,32);offset+=4)if(["avif","avis"].includes(value.subarray(offset,offset+4).toString("ascii")))return"image/avif";
  return null;
}
