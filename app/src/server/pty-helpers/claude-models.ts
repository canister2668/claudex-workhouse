import fs from"node:fs";
import path from"node:path";
import{startTerminal,type TerminalFactory}from"./terminal.js";
import{PROBE_ARGS,probeEnvironment}from"./claude-usage.js";

/** Node port of bin/claude-models.py for hosts without a POSIX pty (Windows).
 * Same expressions, same JSON; tests hold the two to identical output. */

const PICKER_END=/(?:Enter selection|Select with numbers)\s*\[(\d+)-(\d+)\]/g;
const DISABLED=/\(disabled\)|\bUpdate to [\d.]+\+? to use\b/i;
const REGISTRY=/\{id:"(claude-[a-z0-9-]{1,60})",family:"([a-z]{1,20})",display_name:"([^"\\]{1,40})"/g;
const KNOWN_FAMILIES=["opus","sonnet","haiku","fable","mythos"];
export type RegistryEntry={id:string;family:string;displayName:string};
type Model={id:string;displayName:string;description:string};

const escapeRegExp=(value:string)=>value.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
const title=(value:string)=>value.charAt(0).toUpperCase()+value.slice(1).toLowerCase();
const modelId=(family:string,version:string,wide=false)=>`claude-${family.toLowerCase()}-${version.replaceAll(".","-")}${wide?"[1m]":""}`;

/** Scans the CLI bundle for its embedded model registry, in bounded chunks so
 * a large native binary is never read into memory at once. */
export function readRegistry(binary:string,cacheDir?:string):RegistryEntry[]{
  let real:string,stat:fs.BigIntStats;
  try{real=fs.realpathSync(binary);stat=fs.statSync(real,{bigint:true});}catch{return[];}
  const key=`${real}:${stat.size}:${stat.mtimeNs}`,cacheFile=cacheDir?path.join(cacheDir,"registry.json"):null;
  if(cacheFile)try{const cached=JSON.parse(fs.readFileSync(cacheFile,"utf8"));if(cached?.key===key&&Array.isArray(cached.models))return cached.models;}catch{}
  const models:RegistryEntry[]=[],seen=new Set<string>();
  try{
    const fd=fs.openSync(real,"r"),chunk=Buffer.alloc(8*1024*1024),overlap=512;let carry="",position=0;
    try{
      for(;;){
        const read=fs.readSync(fd,chunk,0,chunk.length,position);if(read<=0)break;position+=read;
        const text=carry+chunk.toString("latin1",0,read);
        for(const match of text.matchAll(REGISTRY)){
          const id=match[1];if(seen.has(id))continue;seen.add(id);
          models.push({id,family:match[2],displayName:Buffer.from(match[3],"latin1").toString("utf8")});
        }
        carry=text.slice(-overlap);
      }
    }finally{fs.closeSync(fd);}
  }catch{return[];}
  if(cacheFile&&models.length)try{const temporary=`${cacheFile}.${process.pid}.tmp`;fs.writeFileSync(temporary,JSON.stringify({key,models}));fs.renameSync(temporary,cacheFile);}catch{}
  return models;
}

function registryMatch(text:string,registry:RegistryEntry[]){
  for(const entry of [...registry].sort((a,b)=>b.displayName.length-a.displayName.length)){
    if(new RegExp(`(?<![\\w.])${escapeRegExp(entry.displayName)}(?!\\w|\\.\\d)`,"i").test(text))return entry;
  }
  return null;
}
function rowModel(text:string,registry:RegistryEntry[]):[string,string]|null{
  const entry=registryMatch(text,registry);
  if(entry)return[entry.id,entry.displayName];
  const families=[...new Set([...KNOWN_FAMILIES,...registry.map(item=>item.family)])].sort((a,b)=>b.length-a.length);
  const match=new RegExp(`\\b(${families.map(escapeRegExp).join("|")})\\s+(\\d+(?:\\.\\d+)*)\\b`,"i").exec(text);
  if(!match)return null;
  const family=title(match[1]),version=match[2];
  return[modelId(family,version),`${family} ${version}`];
}

function parseRender(picker:string,registry:RegistryEntry[]){
  const starts=[...picker.matchAll(/^\s*\d+\.\s+(?:\(selected\)\s+)?/gm)];
  const models:Model[]=[],unmapped:string[]=[];
  starts.forEach((start,index)=>{
    const from=start.index!+start[0].length,finish=index+1<starts.length?starts[index+1].index!:picker.length;
    const item=picker.slice(from,finish).replace(/\s+/g," ").trim();
    const split=item.indexOf(" — "),label=split<0?item:item.slice(0,split),description=split<0?"":item.slice(split+3);
    if(DISABLED.test(item))return;
    if(/^default\b/i.test(label)){models.push({id:"default",displayName:"기본값",description:description||label});return;}
    const found=rowModel(label,registry)??(description?rowModel(description,registry):null);
    if(!found){unmapped.push(item.slice(0,120));return;}
    const[model,name]=found,wide=/\b1M\s+context\b/i.test(item);
    models.push({id:wide?`${model}[1m]`:model,displayName:wide?`${name} · 1M`:name,description});
  });
  const unique:Model[]=[],seen=new Set<string>();
  for(const model of models)if(!seen.has(model.id)){unique.push(model);seen.add(model.id);}
  return{models:unique,unmapped,rows:starts.length};
}

export function parsePicker(text:string,registry:RegistryEntry[]=[]){
  const at=text.lastIndexOf("Select model"),picker=at<0?text:text.slice(at+"Select model".length);
  const footers=[...picker.matchAll(PICKER_END)];
  const starts=[0,...footers.map(footer=>footer.index!+footer[0].length)];
  let renders:[string,number|null][]=footers.map((footer,index)=>[picker.slice(starts[index],footer.index!),Number(footer[2])]);
  if(!renders.length)renders=[[picker,null]];
  let parsed:ReturnType<typeof parseRender>&{expected:number|null}={models:[],unmapped:[],rows:0,expected:null};
  for(const[render,expected] of [...renders].reverse()){parsed={...parseRender(render,registry),expected};if(parsed.models.length)break;}
  return{...parsed,complete:parsed.models.length>0&&!parsed.unmapped.length&&(parsed.expected===null||parsed.rows===parsed.expected)};
}

const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));

export async function probeClaudeModels(binary:string,cwd:string,options:{terminal?:TerminalFactory;timeoutMs?:number}={}){
  fs.mkdirSync(cwd,{recursive:true,mode:0o700});
  const registry=readRegistry(binary,cwd),limit=options.timeoutMs??25_000;
  const terminal=(options.terminal??startTerminal)({binary:path.resolve(binary),args:PROBE_ARGS,cwd:path.resolve(cwd),env:probeEnvironment(110,44),cols:110,rows:44});
  let started=Date.now(),trusted=false,importsAnswered=false,pickerSent=false,footerSeenAt:number|null=null;
  let result:any=null,incomplete:ReturnType<typeof parsePicker>|null=null;
  try{
    while(Date.now()-started<limit){
      await terminal.settle(250);
      const text=terminal.text();
      if(!trusted&&text.includes("Quick safety check")&&(text.includes("Enter y/n")||text.includes("Enter to confirm"))){terminal.write("y\r");trusted=true;started=Date.now();continue;}
      if(!importsAnswered&&text.includes("Allow external CLAUDE.md file imports?")&&(text.includes("Enter y/n")||text.includes("Enter to confirm"))){terminal.write("n\r");importsAnswered=true;started=Date.now();continue;}
      if(!pickerSent&&Date.now()-started>1250&&(text.includes("plan mode on")||text.includes("manual mode on"))){terminal.write("/model\r");pickerSent=true;}
      const at=text.lastIndexOf("Select model");
      if(pickerSent&&at>=0&&new RegExp(PICKER_END.source).test(text.slice(at+"Select model".length))){
        const parsed=parsePicker(text,registry);footerSeenAt??=Date.now();
        // An unmapped row fails the probe instead of shortening the catalog;
        // a repaint still in flight gets a moment first.
        if(parsed.complete||Date.now()-footerSeenAt>3000){
          if(parsed.complete)result={ok:true,source:"claude-cli-model-picker",models:parsed.models,registrySize:registry.length};else incomplete=parsed;
          terminal.write("\x1b");await sleep(100);terminal.write("/exit\r");break;
        }
      }
      if(terminal.closed)break;
    }
  }finally{terminal.kill();await Promise.race([terminal.exit,sleep(3000)]);}
  if(result)return result;
  if(incomplete)return{ok:false,source:"claude-cli-model-picker",error:"picker-parse-incomplete",expectedRows:incomplete.expected,rows:incomplete.rows,unmapped:incomplete.unmapped,models:incomplete.models};
  return{ok:false,source:"claude-cli-model-picker",error:"unavailable",models:[]};
}
