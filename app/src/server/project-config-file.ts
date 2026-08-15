import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { AppConfig } from "./config.js";

export function persistConfiguredWorkspacePath(config:AppConfig,projectId:string,previousPath:string,nextPath:string) {
  const configured=config.projects.find(item=>item.id===projectId&&item.realPath===previousPath);if(!configured)return false;
  const file=path.join(config.dataRoot??config.root,"config","projects.json"),parsed=JSON.parse(fs.readFileSync(file,"utf8")) as {projects:Array<{id:string;name:string;path:string}>},entry=parsed.projects.find(item=>item.id===projectId);if(!entry)throw new Error("Configured project entry is unavailable.");
  const temporary=`${file}.${process.pid}.${crypto.randomUUID()}.tmp`,mode=fs.statSync(file).mode;entry.path=nextPath;
  fs.writeFileSync(temporary,`${JSON.stringify(parsed,null,2)}\n`,{encoding:"utf8",mode});try{fs.chmodSync(temporary,mode);}catch{}fs.renameSync(temporary,file);
  configured.path=nextPath;configured.realPath=nextPath;configured.enabled=true;configured.error=null;return true;
}
