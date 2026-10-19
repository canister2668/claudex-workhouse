import fs from "node:fs";
import path from "node:path";
import {resolveWorkspaceTextPath} from "./workspace-file-edit.js";
import {workspaceImageMime} from "./workspace-image-preview.js";

// Only raster files inside the selected Workspace may enter the sandbox.
export function readHtmlPreviewImages(root:string,htmlPath:string,references:string[]){
  const images:Record<string,string>=Object.create(null);
  let remaining=64*1024*1024;
  for(const ref of [...new Set(references)].slice(0,200)){
    try{
      if(!ref||ref.length>4096||/^(?:[a-z][a-z\d+.-]*:|[/\\#])/i.test(ref)||ref.includes("\\"))continue;
      const requested=decodeURIComponent(ref.split(/[?#]/,1)[0]!);
      if(path.isAbsolute(requested)||requested.includes("\\"))continue;
      const target=resolveWorkspaceTextPath(root,path.dirname(htmlPath),requested);
      if(!/\.(png|jpe?g|gif|webp|avif)$/i.test(target.relative)||target.stat.size>20*1024*1024||target.stat.size>remaining)continue;
      const value=fs.readFileSync(target.real),mime=workspaceImageMime(value.subarray(0,32));
      if(!mime||value.length>20*1024*1024||value.length>remaining)continue;
      remaining-=value.length;
      images[ref]=`data:${mime};base64,${value.toString("base64")}`;
    }catch{/* Missing or forbidden resources remain blocked by the preview sanitizer. */}
  }
  return images;
}
