import fs from "node:fs";
import path from "node:path";
import {createAutomaticDatabaseSnapshot} from "./snapshot-store.js";

function backupDate(directory:string){try{const value=JSON.parse(fs.readFileSync(path.join(directory,"manifest.json"),"utf8"));const parsed=new Date(value.createdAt);return Number.isFinite(parsed.getTime())?parsed:null;}catch{return null;}}
function weekKey(date:Date){const value=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate()));value.setUTCDate(value.getUTCDate()+4-(value.getUTCDay()||7));const yearStart=new Date(Date.UTC(value.getUTCFullYear(),0,1)),week=Math.ceil((((value.getTime()-yearStart.getTime())/86400000)+1)/7);return`${value.getUTCFullYear()}-${String(week).padStart(2,"0")}`;}

// Kept as a pure planner for legacy inventories and tests. Managed snapshots
// apply the same policy by moving stale entries to trash, never by deleting
// them during the pre-database startup backup.
export function automaticBackupRetentionPlan(parent:string,daily=7,weekly=4){
  const entries=fs.existsSync(parent)?fs.readdirSync(parent,{withFileTypes:true}).filter(item=>item.isDirectory()&&!item.name.startsWith(".")).map(item=>({directory:path.join(parent,item.name),date:backupDate(path.join(parent,item.name)),pinned:fs.existsSync(path.join(parent,item.name,"PINNED"))})).filter((item):item is {directory:string;date:Date;pinned:boolean}=>Boolean(item.date)).sort((a,b)=>b.date.getTime()-a.date.getTime()):[];
  const keep=new Set(entries.filter(item=>item.pinned).map(item=>item.directory));for(const item of entries.slice(0,Math.max(1,daily)))keep.add(item.directory);
  const weeks=new Set<string>();for(const item of entries){const key=weekKey(item.date);if(weeks.has(key))continue;if(weeks.size>=weekly)break;weeks.add(key);keep.add(item.directory);}
  return{keep:[...keep],remove:entries.filter(item=>!keep.has(item.directory)).map(item=>item.directory)};
}

export function createAutomaticDatabaseBackup(root:string,dbPath:string,date=new Date(),_retention=7,options:{platform?:NodeJS.Platform;appRoot?:string;nodeBinary?:string;pythonBinary?:string}={}){return createAutomaticDatabaseSnapshot(root,dbPath,date,options);}
