#!/usr/bin/env node
import os from "node:os";
import { addRoot, removeRoot } from "./workspaces.js";
import { DesktopWorkerClient, pairWorker } from "./client.js";
import { loadWorkerConfig, redactConfig, saveWorkerConfig } from "./config.js";
import { diagnostics, RemoteTaskManager } from "./tasks.js";
import { installService, uninstallService } from "./service.js";
import { sanitizeSensitiveText } from "../sensitive-data.js";

function option(name:string){const index=process.argv.indexOf(name);return index>=0?process.argv[index+1]:undefined;}
function print(value:unknown){process.stdout.write(`${JSON.stringify(value,null,2)}\n`);}
async function main(){const command=process.argv[2]??"status",sub=process.argv[3];
  if(command==="pair"){const url=option("--url"),code=option("--code"),name=option("--name")??os.hostname();if(!url||!code)throw new Error("Usage: claudex-workhouse-worker pair --url https://workhouse.example --code XXXX-XXXX-XXXX [--name Desktop]");print(await pairWorker(url,code,name));return;}
  if(command==="run"){const client=new DesktopWorkerClient();for(const signal of ["SIGINT","SIGTERM"] as const)process.once(signal,()=>client.stop());await client.run();return;}
  const config=loadWorkerConfig();
  if(command==="status"){print(redactConfig(config));return;}
  if(command==="roots"&&sub==="list"){print(config.roots.map(item=>({id:item.id,displayName:item.displayName,canonicalPath:item.canonicalPath})));return;}
  if(command==="roots"&&sub==="add"){const rootPath=process.argv[4],name=option("--name"),allowDelete=process.argv.includes("--allow-delete");if(!rootPath)throw new Error("Usage: claudex-workhouse-worker roots add <path> [--name Name] [--allow-delete]");const item=addRoot(config,rootPath,name,allowDelete);saveWorkerConfig(config);print(item);return;}
  if(command==="roots"&&sub==="remove"){const id=process.argv[4];if(!id)throw new Error("Usage: claudex-workhouse-worker roots remove <root-id>");print({removed:removeRoot(config,id)});saveWorkerConfig(config);return;}
  if(command==="diagnose"){const tasks=new RemoteTaskManager(config,()=>false);try{print(await diagnostics(config,tasks));}finally{tasks.close();}return;}
  if(command==="unpair"){config.hostId=null;config.credential=null;config.credentialVersion=0;config.serverUrl=null;saveWorkerConfig(config);print({unpaired:true,filesRemain:true});return;}
  if(command==="install-service"){print(installService());return;}
  if(command==="uninstall-service"){print(uninstallService());return;}
  throw new Error("Commands: run, pair, status, roots list, roots add, roots remove, diagnose, unpair, install-service, uninstall-service");
}
main().catch(error=>{process.stderr.write(`${sanitizeSensitiveText(error instanceof Error?error.message:String(error))}\n`);process.exitCode=1;});
