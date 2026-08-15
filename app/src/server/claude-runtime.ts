import fs from "node:fs";
import path from "node:path";

export type ClaudeRuntimeInfo={managed:boolean;version:string|null;checksum:string|null;platform:string|null;channel:string|null;source:string|null;buildDate:string|null;verifiedAt:string|null};

const text=(value:unknown)=>typeof value==="string"&&value.length<=200?value:null;

export function readClaudeRuntime(root:string):ClaudeRuntimeInfo{
  try{
    const state=JSON.parse(fs.readFileSync(path.join(root,"runtime","claude-bin","claude-runtime.json"),"utf8"));
    const checksum=text(state.checksum);
    return{managed:state.source==="anthropic-official"||state.source==="local-backup",version:text(state.version),checksum:checksum&&/^[a-f0-9]{64}$/.test(checksum)?checksum:null,platform:text(state.platform),channel:text(state.channel),source:text(state.source),buildDate:text(state.buildDate),verifiedAt:text(state.verifiedAt)};
  }catch{return{managed:false,version:null,checksum:null,platform:null,channel:null,source:null,buildDate:null,verifiedAt:null};}
}
