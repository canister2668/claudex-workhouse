import fs from "node:fs";
import path from "node:path";
import type { ApplicationUpdateAttempt, ApplicationUpdateStore } from "./application-updates.js";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,SHA256=/^[a-f0-9]{64}$/;
interface ResultStore extends ApplicationUpdateStore{getApplicationUpdateAttempt(id:string):Promise<ApplicationUpdateAttempt|null>;}
export async function reconcileApplicationUpdateResults(directory:string,store:ResultStore){
  const resolved=path.resolve(directory);if(!fs.existsSync(resolved))return{processed:0,rejected:0};const status=fs.lstatSync(resolved);if(status.isSymbolicLink()||!status.isDirectory())throw new Error("Application update result directory is unsafe.");
  let processed=0,rejected=0;
  for(const name of fs.readdirSync(resolved).sort().slice(0,100)){
    if(!name.endsWith(".json")||!UUID.test(name.slice(0,-5))){rejected++;continue;}const file=path.join(resolved,name),fileStatus=fs.lstatSync(file);if(fileStatus.isSymbolicLink()||!fileStatus.isFile()||fileStatus.size<2||fileStatus.size>1024*1024){rejected++;continue;}
    let value:any;try{value=JSON.parse(fs.readFileSync(file,"utf8"));}catch{rejected++;continue;}
    if(value?.schemaVersion!==1||value.attemptId!==name.slice(0,-5)||!["completed","rolled-back","failed"].includes(value.state)||typeof value.sourceVersion!=="string"||typeof value.targetVersion!=="string"||typeof value.manifestSha256!=="string"||!SHA256.test(value.manifestSha256)||typeof value.rollbackPerformed!=="boolean"||typeof value.completedAt!=="string"||!Number.isFinite(Date.parse(value.completedAt))||(value.error!==null&&typeof value.error!=="string")){rejected++;continue;}
    const attempt=await store.getApplicationUpdateAttempt(value.attemptId);if(!attempt){rejected++;continue;}if(["completed","rolled-back","failed"].includes(attempt.state)){processed++;continue;}
    if(attempt.sourceVersion!==value.sourceVersion||attempt.targetVersion!==value.targetVersion||attempt.manifestSha256!==value.manifestSha256){rejected++;continue;}
    await store.updateApplicationUpdateAttempt({...attempt,state:value.state,rollbackPerformed:value.rollbackPerformed,error:value.error?.slice(0,1000)??null,updatedAt:value.completedAt,completedAt:value.completedAt});processed++;
  }
  return{processed,rejected};
}
