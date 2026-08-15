import type {AgentEvent} from "./events";

export type BuildStatus="running"|"completed"|"failed";
export type BuildPhase="preparing"|"typeChecking"|"compiling"|"bundling"|"packaging"|"finalizing";
export type BuildProgress={
  id:string;
  command:string;
  tool:string;
  status:BuildStatus;
  phase:BuildPhase;
  output:string;
  latestLine:string;
  outputLines:number;
  exitCode:number|null;
  durationMs:number|null;
  startedAt:string|null;
  completedAt:string|null;
  events:AgentEvent[];
};

const stripAnsi=(value:string)=>value.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g,"").replace(/\r/g,"").trim();
const text=(value:unknown)=>typeof value==="string"?value:"";
const numberOrNull=(value:unknown)=>Number.isFinite(Number(value))?Number(value):null;
const itemId=(event:AgentEvent)=>text(event.itemId??event.metadata?.itemId);
const commandOf=(event:AgentEvent)=>{
  const metadataCommand=event.metadata?.command;
  if(Array.isArray(metadataCommand))return metadataCommand.map(String).join(" ");
  if(typeof metadataCommand==="string"&&metadataCommand.trim())return metadataCommand.trim();
  return event.type==="command_started"||event.type==="command"?event.content.trim():"";
};
const commandKey=(event:AgentEvent,index:number)=>{
  const native=itemId(event);
  return native?`item:${event.threadId??event.metadata?.threadId??""}:${event.turnId??event.metadata?.turnId??""}:${native}`:`event:${index}`;
};

// A heredoc body is data, not commands. Without cutting it, writing a file that
// merely mentions "npm run build" registers as a build and leaves a card that
// never finishes.
export function commandWithoutHeredocBody(command:string){
  const match=/<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/.exec(command);
  return match?command.slice(0,match.index):command;
}

// The history groups runs of "the same build". A shell line carries noise that
// does not change what was built — a directory hop in front, an output pipe or
// redirection behind — so grouping on the raw line split one build across
// several rows the moment the invocation was typed slightly differently.
export function buildCommandIdentity(command:string){
  let value=commandWithoutHeredocBody(command).replace(/\\\n/g," ").replace(/\s+/g," ").trim();
  // Drop leading directory hops.
  value=value.replace(/^(?:cd\s+[^&|;]+&&\s*)+/i,"");
  // Cut everything from the first pipe or output redirection.
  const cut=value.search(/\s(?:\||>|>>|2>|&>)/);
  if(cut>=0)value=value.slice(0,cut);
  // Keep only the segment that actually builds when several are chained.
  const segments=value.split(/\s*&&\s*/).filter(Boolean);
  const building=segments.find(segment=>isBuildCommand(segment));
  return(building??segments.at(-1)??value).trim();
}

export function isBuildCommand(command:string){
  const normalized=commandWithoutHeredocBody(command).replace(/\\\n/g," ").replace(/\s+/g," ").trim();
  if(!normalized)return false;
  const prefix=String.raw`^(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*(?:sudo\s+)?`;
  const patterns=[
    new RegExp(`${prefix}(?:npm|pnpm|yarn|bun)\\b[^\\n]*\\b(?:run\\s+)?build(?=\\s|$)`,"i"),
    new RegExp(`${prefix}(?:(?:npx|pnpm\\s+exec|bunx)\\s+)?(?:vite|next|nuxt|astro|svelte-kit)\\s+build(?=\\s|$)`,"i"),
    new RegExp(`${prefix}(?:(?:npx|pnpm\\s+exec)\\s+)?tsc(?:\\s+-b\\b|\\s+--build\\b)`,"i"),
    new RegExp(`${prefix}(?:docker|podman)\\s+(?:compose\\s+)?build(?=\\s|$)`,"i"),
    new RegExp(`${prefix}(?:cargo|go)\\s+build(?=\\s|$)`,"i"),
    new RegExp(`${prefix}(?:\\./)?(?:gradle|gradlew|mvn|mvnw)\\b[^\\n]*\\b(?:build|assemble|package)(?=\\s|$)`,"i"),
    new RegExp(`${prefix}cmake\\s+--build(?=\\s|$)`,"i"),
    new RegExp(`${prefix}make(?:\\s+(?:all|build|release))?(?=\\s|$)`,"i"),
  ];
  return normalized.split(/\s*(?:&&|\|\||;|\n)\s*/).some(segment=>patterns.some(pattern=>pattern.test(segment)));
}

export function buildTool(command:string){
  if(/\b(?:docker|podman)\b/i.test(command))return"Docker";
  if(/\b(?:vite)\b/i.test(command))return"Vite";
  if(/\bnext\b/i.test(command))return"Next.js";
  if(/\bnuxt\b/i.test(command))return"Nuxt";
  if(/\bastro\b/i.test(command))return"Astro";
  if(/\bsvelte-kit\b/i.test(command))return"SvelteKit";
  if(/\btsc\b/i.test(command))return"TypeScript";
  if(/\bcargo\b/i.test(command))return"Cargo";
  if(/\bgo\s+build\b/i.test(command))return"Go";
  if(/\b(?:gradle|gradlew)\b/i.test(command))return"Gradle";
  if(/\b(?:mvn|mvnw)\b/i.test(command))return"Maven";
  if(/\bcmake\b/i.test(command))return"CMake";
  if(/(?:^|[;&|]\s*)make\b/i.test(command))return"Make";
  return"Build";
}

export function buildPhase(command:string,output:string,status:BuildStatus):BuildPhase{
  if(status!=="running")return"finalizing";
  const value=`${command}\n${output}`;
  if(/\b(?:type-?check|tsc|checking types|type checking)\b/i.test(value))return"typeChecking";
  if(/\b(?:transforming|modules transformed|rendering chunks|vite|rollup|webpack|esbuild|bundl)\b/i.test(value))return"bundling";
  if(/\b(?:packag|image export|exporting layers|writing image|assemble)\b/i.test(value))return"packaging";
  if(/\b(?:compil|building|cargo build|go build|cmake)\b/i.test(value))return"compiling";
  return"preparing";
}

const ATTACHABLE=new Set(["command_output","command_completed","tool_completed"]);
const TERMINAL=new Set(["command_completed","tool_completed"]);

// Matched in one ordered pass against the build that is currently open. The
// previous version resolved stray completions against the last build seen in
// the whole event list, so with several builds every completion landed on the
// final row and the earlier ones stayed "running" forever. Item ids still win
// when present; history responses that drop them now fall back to ordering
// instead of losing the completion outright.
export function buildProgressRows(events:AgentEvent[]):BuildProgress[]{
  const rows=new Map<string,{command:string;events:AgentEvent[];order:number}>();
  const keyByItem=new Map<string,string>();
  let openKey:string|null=null;

  events.forEach((event,index)=>{
    const native=itemId(event);
    const mapped=native?keyByItem.get(native):undefined;
    const attachable=ATTACHABLE.has(event.type);
    const target=mapped??(attachable?openKey:null);
    if(target){
      const row=rows.get(target);
      if(row&&attachable&&!row.events.includes(event)){
        row.events.push(event);
        if(TERMINAL.has(event.type)&&target===openKey)openKey=null;
      }
      return;
    }
    // Nothing to attach to. A completion that names its own command is a build
    // reported as a single event, which is how Codex delivers a finished run.
    const command=commandOf(event);
    if(!command||!isBuildCommand(command))return;
    const key=native?`item:${event.threadId??event.metadata?.threadId??""}:${event.turnId??event.metadata?.turnId??""}:${native}`:`event:${index}`;
    const row=rows.get(key)??{command,events:[],order:index};
    if(!row.command)row.command=command;
    row.events.push(event);
    rows.set(key,row);
    if(native)keyByItem.set(native,key);
    openKey=TERMINAL.has(event.type)?null:key;
  });

  return[...rows.entries()].sort((left,right)=>left[1].order-right[1].order).map(([id,row])=>{
    const completed=[...row.events].reverse().find(event=>event.type==="command_completed"||event.type==="tool_completed");
    const exitCode=numberOrNull(completed?.metadata?.exitCode);
    const failed=Boolean(completed&&(exitCode!==null&&exitCode!==0||completed.status==="failed"||completed.status==="error"||completed.metadata?.isError===true));
    const status:BuildStatus=!completed?"running":failed?"failed":"completed";
    const outputEvents=row.events.filter(event=>event.type==="command_output"||event.type==="tool_completed"||event.type==="command_completed"&&stripAnsi(event.content)!==stripAnsi(row.command));
    const output=stripAnsi(outputEvents.map(event=>event.content).filter(Boolean).join("\n"));
    const lines=output.split("\n").map(line=>line.trim()).filter(Boolean);
    const started=row.events.find(event=>event.type==="command_started")??row.events[0];
    const startedAt=started?.timestamp??null,completedAt=completed?.timestamp??null;
    const explicitDuration=numberOrNull(completed?.metadata?.durationMs);
    const timestampDuration=startedAt&&completedAt?Math.max(0,Date.parse(completedAt)-Date.parse(startedAt)):null;
    return{id,command:row.command,tool:buildTool(row.command),status,phase:buildPhase(row.command,output,status),output,latestLine:lines.at(-1)??"",outputLines:lines.length,exitCode,durationMs:explicitDuration??timestampDuration,startedAt,completedAt,events:row.events};
  });
}

export function buildEventSet(rows:BuildProgress[]){
  return new Set(rows.flatMap(row=>row.events));
}

// A build card is a progress affordance: the track, phase and live log only
// earn their height while the command runs. Finished runs keep accumulating
// full-size cards otherwise, and a session that builds repeatedly ends up
// scrolling through a stack of identical completed ones.
export type BuildHistoryEntry={
  id:string;
  command:string;
  detail:string;
  tool:string;
  status:BuildStatus;
  count:number;
  durationMs:number|null;
  exitCode:number|null;
  completedAt:string|null;
};

export function activeBuilds(rows:BuildProgress[]){
  return rows.filter(row=>row.status==="running");
}

// Repeating the same command collapses into one row with a count rather than
// one row per run: "npm run build ×8" is the useful reading, not eight lines.
export function buildHistory(rows:BuildProgress[]):BuildHistoryEntry[]{
  const groups=new Map<string,BuildHistoryEntry&{order:number}>();
  rows.forEach((row,index)=>{
    if(row.status==="running")return;
    const command=buildCommandIdentity(row.command)||row.command;
    const key=`${row.status}:${command}`,existing=groups.get(key);
    if(existing){
      existing.count+=1;
      existing.order=index;
      existing.id=row.id;
      existing.detail=row.command;
      existing.durationMs=row.durationMs??existing.durationMs;
      existing.exitCode=row.exitCode??existing.exitCode;
      existing.completedAt=row.completedAt??existing.completedAt;
      return;
    }
    groups.set(key,{id:row.id,command,detail:row.command,tool:row.tool,status:row.status,count:1,durationMs:row.durationMs,exitCode:row.exitCode,completedAt:row.completedAt,order:index});
  });
  return[...groups.values()].sort((left,right)=>right.order-left.order).map(({order:_order,...entry})=>entry);
}

// A long session can finish many different builds. The panel shows the newest
// ones and states how many it left out rather than silently trimming the list.
export const BUILD_HISTORY_VISIBLE=8;

// Returned as a key plus params so the caller can translate it, keeping the
// formatting rules testable without pulling the i18n store into this module.
export function buildDurationLabel(durationMs:number|null){
  if(durationMs===null||!Number.isFinite(durationMs))return null;
  const value=Math.max(0,durationMs);
  if(value<1_000)return{key:"build.lessThanSecond",params:{} as Record<string,number>};
  if(value<60_000)return{key:"build.seconds",params:{count:Math.round(value/1_000)}};
  return{key:"build.minutes",params:{count:Math.floor(value/60_000),seconds:Math.round(value%60_000/1_000)}};
}
