type EventLike={type?:string;status?:string;content?:string;metadata?:Record<string,any>};
type TaskLike={status:string;result?:string|null;error?:string|null;metadata?:Record<string,any>};
export type TaskOutcomeImage={path:string;pathBase:"workspace"|"task-cwd"};
export type TaskOutcomeFile={path:string;pathBase:"workspace"|"task-cwd"};
// The summary is computed outside the component tree, so it carries dictionary keys
// and lets the view translate. `reason` holds provider error text, which has no key.
export type TaskFailure={reasonKey:string|null;reason:string;actionKey:string};
export type TaskCheckStatus="passed"|"failed"|"running"|"unverified";
export type TaskCheck={command:string;status:TaskCheckStatus;source:"provider"|"heuristic"};
export type TaskOutcome={headline:string;headlineKey:string|null;headlineIsModel:boolean;files:string[];uploadCandidates:TaskOutcomeFile[];images:TaskOutcomeImage[];checks:TaskCheck[];failure:TaskFailure|null};

const imagePath=(value:string)=>/\.(?:avif|gif|jpe?g|png|webp)$/i.test(value);

const packageScript=/^(?:pnpm|npm|yarn|bun)\s+(?:run\s+)?(?:test|check|lint|build|typecheck)(?:[:.-][\w:.-]+)?(?:\s|$)/i;
const directRunner=/^(?:npx\s+)?(?:pytest|vitest|jest|tox)(?:\s|$)|^cargo\s+(?:test|check|clippy|build)(?:\s|$)|^go\s+test(?:\s|$)|^(?:\.\/)?gradlew\s+(?:test|check|build)(?:\s|$)|^mvn(?:w)?\s+(?:test|verify|package)(?:\s|$)|^make\s+(?:test|check|lint|build|typecheck)(?:\s|$)/i;
const checkCommand=(value:string)=>value.split(/&&|\|\||;|\n/).some(part=>{
  let command=part.trim().replace(/^(?:sudo\s+)?(?:env\s+)?(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*/,"");
  command=command.replace(/^sudo\s+/,"");
  return packageScript.test(command)||directRunner.test(command);
});
const clean=(value:unknown,max=500)=>String(value??"").replace(/\s+/g," ").trim().slice(0,max);
function commandFor(event:EventLike){return clean(event.metadata?.command??(event.type==="command_started"?event.content:""),500);}
const failureCopy=(id:string):TaskFailure=>({reasonKey:`task.failure.${id}.reason`,reason:"",actionKey:`task.failure.${id}.action`});
function failure(task:TaskLike):TaskFailure|null{
  if(task.status!=="failed")return null;
  const category=clean(task.metadata?.errorCategory??task.metadata?.failureCategory??"",100).toUpperCase(),detail=clean(task.error,300);
  if(category.includes("TIMEOUT")||/timed? out|시간.*초과/i.test(detail))return failureCopy("timeout");
  if(category.includes("AUTH")||/login|auth|로그인|인증/i.test(detail))return failureCopy("auth");
  if(category.includes("HOST_OFFLINE")||/host.*offline|호스트.*오프라인/i.test(detail))return failureCopy("hostOffline");
  if(category.includes("OUTPUT_UNAVAILABLE"))return failureCopy("outputUnavailable");
  const fallback=failureCopy("unknown");
  return detail?{...fallback,reasonKey:null,reason:detail}:fallback;
}

export function taskOutcomeSummary(task:TaskLike,events:EventLike[]):TaskOutcome{
  const files=new Set<string>(),uploadCandidates=new Map<string,TaskOutcomeFile>(),images=new Map<string,TaskOutcomeImage>(),checks=new Map<string,TaskCheck>();
  for(const event of events){
    const changes=Array.isArray(event.metadata?.changes)?event.metadata!.changes:[];
    const candidates=[{path:event.metadata?.path,pathBase:event.metadata?.pathBase},...changes.map((item:any)=>({path:item?.path??item?.file??item?.filePath,pathBase:item?.pathBase??event.metadata?.pathBase}))];
    if(event.type?.startsWith("file_change")||event.type==="file_write")for(const candidate of candidates){
      const file=clean(candidate.path,1000);if(!file)continue;files.add(file);
      const pathBase=candidate.pathBase;
      if(pathBase==="workspace"||pathBase==="task-cwd")uploadCandidates.set(`${pathBase}:${file}`,{path:file,pathBase});
      if(imagePath(file)&&(pathBase==="workspace"||pathBase==="task-cwd"))images.set(`${pathBase}:${file}`,{path:file,pathBase});
    }
    if(event.type?.startsWith("command")){
      const command=commandFor(event);if(!command||!checkCommand(command))continue;
      const rawExit=event.metadata?.exitCode,exit=typeof rawExit==="number"&&Number.isFinite(rawExit)?rawExit:null,ok=typeof event.metadata?.ok==="boolean"?event.metadata.ok:null;
      const failed=event.status==="failed"||exit!==null&&exit!==0||ok===false,completed=event.type==="command_completed"||event.status==="completed"||failed;
      const passed=exit===0||ok===true,source=event.metadata?.source==="provider"||exit!==null||ok!==null?"provider":"heuristic";
      checks.set(command,{command,status:failed?"failed":passed?"passed":completed?"unverified":"running",source});
    }
  }
  const modelResult=clean(task.result,500),headline=(modelResult||clean(task.error,500)).split(/(?<=[.!?。])\s/)[0];
  return{headline,headlineKey:headline?null:"task.outcome.noSummary",headlineIsModel:Boolean(modelResult),files:[...files].slice(0,100),uploadCandidates:[...uploadCandidates.values()].slice(0,100),images:[...images.values()].slice(0,12),checks:[...checks.values()].slice(-20),failure:failure(task)};
}

export function hasTaskOutcomeDetails(summary:TaskOutcome){
  return Boolean(summary.failure||summary.files.length||summary.checks.length);
}
