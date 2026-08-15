import fs from"node:fs";
import path from"node:path";
import{runCommand,type CommandResult}from"../process.js";
export type ExternalCommandRunner=(command:string,args:string[],options:{cwd:string;timeoutMs:number;outputLimit:number;env?:NodeJS.ProcessEnv;input?:string|Buffer})=>Promise<CommandResult>;
export function findExecutable(name:string,environment:NodeJS.ProcessEnv=process.env){
  if(!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(name))return null;
  for(const directory of String(environment.PATH??"").split(path.delimiter).filter(Boolean)){
    const candidate=path.join(directory,process.platform==="win32"&&!name.toLowerCase().endsWith(".exe")?`${name}.exe`:name);
    try{const stat=fs.lstatSync(candidate);if(stat.isFile()&&!stat.isSymbolicLink()){fs.accessSync(candidate,fs.constants.X_OK);return candidate;}}catch{}
  }
  return null;
}
export const defaultExternalCommandRunner:ExternalCommandRunner=(command,args,options)=>runCommand(command,args,{...options,env:{PATH:process.env.PATH,HOME:process.env.HOME,LANG:"C.UTF-8",LC_ALL:"C.UTF-8",NO_COLOR:"1",...options.env}});
export async function boundedCommand(runner:ExternalCommandRunner,command:string,args:string[],cwd:string,timeoutMs=8000){return runner(command,args,{cwd,timeoutMs,outputLimit:1024*1024});}
