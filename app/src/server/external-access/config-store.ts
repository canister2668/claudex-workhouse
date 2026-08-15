import fs from"node:fs";
import path from"node:path";
import type{AppConfig}from"../config.js";
function safeDirectory(root:string){const directory=path.join(root,"config","external-access");fs.mkdirSync(directory,{recursive:true,mode:0o700});const stat=fs.lstatSync(directory);if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error("External access config directory is unsafe.");fs.chmodSync(directory,0o700);return directory;}
function atomic(file:string,value:string,mode=0o600){const directory=path.dirname(file),temporary=path.join(directory,`.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);fs.writeFileSync(temporary,value,{encoding:"utf8",mode,flag:"wx"});fs.chmodSync(temporary,mode);fs.renameSync(temporary,file);}
export function storeCloudflareToken(dataRoot:string,token:string){if(token.length<40||token.length>4096||/[\r\n\0]/.test(token))throw new Error("Cloudflare tunnel token is invalid.");const file=path.join(safeDirectory(dataRoot),"cloudflared.token");atomic(file,`${token}\n`);return file;}
export function writeManagedCloudflareFiles(dataRoot:string,input:{hostname:string;localTarget:string;runMode:"host"|"sidecar"}){
 const directory=safeDirectory(dataRoot),config=path.join(directory,"cloudflared.yml"),tokenFile=path.join(directory,"cloudflared.token");
 const yaml=`# Managed by Claudex Workhouse. Dashboard-managed tunnel routes remain authoritative.\n# Expected public hostname: ${input.hostname}\nmetrics: 127.0.0.1:49312\nno-autoupdate: true\n`;
 atomic(config,yaml);
 let sidecar:string|null=null;
 if(input.runMode==="sidecar"){
   sidecar=path.join(directory,"compose.cloudflared.yaml");
   atomic(sidecar,`services:\n  cloudflared:\n    image: cloudflare/cloudflared:latest\n    restart: unless-stopped\n    network_mode: host\n    command: [\"tunnel\",\"run\",\"--token-file\",\"/run/secrets/tunnel-token\"]\n    volumes:\n      - ./cloudflared.token:/run/secrets/tunnel-token:ro\n`);
 }
 return{config,tokenFile,sidecar,localTarget:input.localTarget};
}
export function updatePrimaryConfig(config:AppConfig,change:{provider:"local"|"tailscale"|"cloudflare";externalOrigin:string;allowedEmail?:string;teamDomain?:string;audience?:string}){
 const file=path.join(config.dataRoot,"config","claudex-workhouse.json"),stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>1024*1024)throw new Error("Primary configuration file is unsafe.");
 const current=JSON.parse(fs.readFileSync(file,"utf8"));current.authMode=change.provider;current.externalOrigin=change.externalOrigin;
 if(change.allowedEmail)current.allowedEmail=change.allowedEmail;
 if(change.provider==="tailscale"){current.tailscaleAllowedEmail=change.allowedEmail;current.tailscaleRequireServeIdentity=true;current.tailscaleAllowFunnel=false;}
 if(change.provider==="cloudflare"){current.teamDomain=change.teamDomain??current.teamDomain;current.audience=change.audience??current.audience;}
 const backup=path.join(safeDirectory(config.dataRoot),"claudex-workhouse.before-external-access.json");if(!fs.existsSync(backup))atomic(backup,`${JSON.stringify(JSON.parse(fs.readFileSync(file,"utf8")),null,2)}\n`);
 atomic(file,`${JSON.stringify(current,null,2)}\n`);return{file,backup};
}
export function removeManagedCloudflareFiles(dataRoot:string){const directory=safeDirectory(dataRoot),removed:string[]=[];for(const name of["cloudflared.yml","cloudflared.token","compose.cloudflared.yaml"]){const file=path.join(directory,name);try{const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink())throw new Error("Refusing to remove an unsafe managed Cloudflare path.");fs.unlinkSync(file);removed.push(name);}catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}}return removed;}
export function restorePrimaryConfig(config:AppConfig){const directory=safeDirectory(config.dataRoot),backup=path.join(directory,"claudex-workhouse.before-external-access.json"),target=path.join(config.dataRoot,"config","claudex-workhouse.json");const stat=fs.lstatSync(backup);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>1024*1024)throw new Error("External access configuration backup is unsafe.");JSON.parse(fs.readFileSync(backup,"utf8"));atomic(target,fs.readFileSync(backup,"utf8"));return target;}
