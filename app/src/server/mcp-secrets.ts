import fs from "node:fs";
import path from "node:path";

export type McpSecretFile={version:1;secrets:Record<string,string>};
export type McpSecretUpdate={serverId:string;secret:string|null;clear:boolean};
const SERVER_ID=/^[a-z][a-z0-9-]{0,62}$/;

function validateServerId(serverId:string){if(!SERVER_ID.test(serverId))throw new Error("External MCP server id is invalid.");return serverId;}
function validateSecret(secret:string){const value=String(secret).trim();if(!value||value.length>8192||/[\u0000-\u001f\u007f]/.test(value))throw new Error("External MCP secret is invalid.");return value;}

function safeDirectory(dataRoot:string){
  const root=path.resolve(dataRoot),parent=path.join(root,"secrets"),directory=path.join(parent,"mcp");
  for(const candidate of[parent,directory]){
    try{const stat=fs.lstatSync(candidate);if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error("External MCP secret directory is unsafe.");}
    catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;fs.mkdirSync(candidate,{mode:0o700});}
    fs.chmodSync(candidate,0o700);
  }
  return directory;
}

export class McpSecretStore{
  readonly directory:string;
  readonly file:string;
  constructor(dataRoot:string){this.directory=safeDirectory(dataRoot);this.file=path.join(this.directory,"external-mcp.json");}

  private read():McpSecretFile{
    try{
      const stat=fs.lstatSync(this.file);
      if(!stat.isFile()||stat.isSymbolicLink()||stat.size>1024*1024||(process.platform!=="win32"&&((stat.mode&0o777)!==0o600||stat.uid!==process.getuid?.())))throw new Error("External MCP secret file is unsafe.");
      const parsed=JSON.parse(fs.readFileSync(this.file,"utf8"));
      if(parsed?.version!==1||!parsed.secrets||typeof parsed.secrets!=="object"||Array.isArray(parsed.secrets))throw new Error("External MCP secret file is invalid.");
      const secrets:Record<string,string>={};
      for(const[id,secret]of Object.entries(parsed.secrets))secrets[validateServerId(id)]=validateSecret(String(secret));
      return{version:1,secrets};
    }catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return{version:1,secrets:{}};throw error;}
  }

  private write(value:McpSecretFile){
    const existing=fs.existsSync(this.file)?fs.lstatSync(this.file):null;
    if(existing&&(!existing.isFile()||existing.isSymbolicLink()))throw new Error("External MCP secret file is unsafe.");
    const temporary=path.join(this.directory,`.external-mcp.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`);
    let descriptor:number|null=null;
    try{
      descriptor=fs.openSync(temporary,"wx",0o600);
      fs.writeFileSync(descriptor,`${JSON.stringify(value,null,2)}\n`,"utf8");
      fs.fsyncSync(descriptor);fs.closeSync(descriptor);descriptor=null;
      fs.chmodSync(temporary,0o600);fs.renameSync(temporary,this.file);fs.chmodSync(this.file,0o600);
      const directoryDescriptor=fs.openSync(this.directory,"r");try{fs.fsyncSync(directoryDescriptor);}finally{fs.closeSync(directoryDescriptor);}
    }catch(error){if(descriptor!==null)try{fs.closeSync(descriptor);}catch{}try{fs.unlinkSync(temporary);}catch{}throw error;}
  }

  has(serverId:string){return Object.hasOwn(this.read().secrets,validateServerId(serverId));}
  ids(){return Object.keys(this.read().secrets);}
  get(serverId:string){return this.read().secrets[validateServerId(serverId)]??null;}
  snapshot(){return structuredClone(this.read());}
  restore(value:McpSecretFile){this.write(structuredClone(value));}
  applyForSettings(updates:readonly McpSecretUpdate[],retained:ReadonlySet<string>){
    const current=this.read();
    for(const update of updates){const id=validateServerId(update.serverId);if(update.clear)delete current.secrets[id];else current.secrets[id]=validateSecret(update.secret??"");}
    for(const id of Object.keys(current.secrets))if(!retained.has(id))delete current.secrets[id];
    this.write(current);
  }
  set(serverId:string,secret:string){const current=this.read();current.secrets[validateServerId(serverId)]=validateSecret(secret);this.write(current);}
  delete(serverId:string){const current=this.read(),id=validateServerId(serverId);if(!Object.hasOwn(current.secrets,id))return false;delete current.secrets[id];this.write(current);return true;}
}

export type McpSecretReader=Pick<McpSecretStore,"has">;
