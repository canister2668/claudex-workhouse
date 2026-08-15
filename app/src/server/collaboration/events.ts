import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type CollaborationEventType =
  | "collaboration/created" | "collaboration/status" | "participant/created" | "participant/status"
  | "run/started" | "run/progress" | "run/waiting-approval" | "run/completed" | "run/failed"
  | "run/cancelled" | "run/stop-unconfirmed" | "relay/created" | "relay/delivered"
  | "avatar/state" | "collaboration/completed" | "collaboration/partial";

export interface CollaborationEvent {
  type: CollaborationEventType; collaborationSessionId: string; participantId: string | null;
  runId: string | null; generation: number; sequence: number; revision: number; eventId: string; timestamp: string;
  metadata: Record<string, unknown>;
}

const MAX_BYTES = 2 * 1024 * 1024;
const TTL_MS = 24 * 60 * 60 * 1000;

function key(id: string) { return crypto.createHash("sha256").update(id).digest("hex"); }
function safeMetadata(value: Record<string, unknown>) {
  const blocked = /(?:content|prompt|result|transcript|token|cookie|secret|authorization|environment)/i;
  return Object.fromEntries(Object.entries(value).filter(([name]) => !blocked.test(name)).map(([name, item]) => [name, typeof item === "string" ? item.slice(0, 300) : item]));
}

export class CollaborationEventBus {
  private listeners = new Map<string, Set<(event: CollaborationEvent) => void>>();
  private sequences = new Map<string, number>();
  private directory: string;

  constructor(root: string) {
    this.directory = path.join(root, "data", "collaboration-events");
    fs.mkdirSync(this.directory, { recursive:true, mode:0o700 });
    fs.chmodSync(this.directory, 0o700);
    for (const name of fs.readdirSync(this.directory)) {
      const file=path.join(this.directory,name);
      try { if (Date.now()-fs.statSync(file).mtimeMs>TTL_MS) fs.rmSync(file,{force:true}); } catch {}
    }
  }

  private file(id: string) { return path.join(this.directory, `${key(id)}.ndjson`); }
  private lastSequence(id: string) {
    if (this.sequences.has(id)) return this.sequences.get(id)!;
    let value=0;
    for(const file of [this.file(id),`${this.file(id)}.1`]){try { value=Number(JSON.parse(fs.readFileSync(file,"utf8").trim().split("\n").at(-1)??"{}").sequence)||0;if(value)break; } catch {}}
    this.sequences.set(id,value); return value;
  }

  emit(input: Omit<CollaborationEvent,"sequence"|"eventId"|"timestamp"|"metadata"|"revision"> & { revision?:number;metadata?:Record<string,unknown> }) {
    const sequence=this.lastSequence(input.collaborationSessionId)+1;
    this.sequences.set(input.collaborationSessionId,sequence);
    const event:CollaborationEvent={...input,revision:Math.max(1,Number(input.revision)||sequence),metadata:safeMetadata(input.metadata??{}),sequence,eventId:`${key(input.collaborationSessionId).slice(0,16)}:${sequence}`,timestamp:new Date().toISOString()};
    const file=this.file(input.collaborationSessionId);
    if(fs.existsSync(file)&&fs.statSync(file).size>=MAX_BYTES){fs.rmSync(`${file}.1`,{force:true});fs.renameSync(file,`${file}.1`);}
    fs.appendFileSync(file,`${JSON.stringify(event)}\n`,{encoding:"utf8",mode:0o600}); fs.chmodSync(file,0o600);
    for (const listener of this.listeners.get(input.collaborationSessionId)??[]) listener(event);
    return event;
  }

  read(id: string, afterSequence=0, limit=500) {
    return this.replay(id,afterSequence,limit).events;
  }

  replay(id:string,afterSequence=0,limit=500){
    const all:CollaborationEvent[]=[];
    for(const file of [`${this.file(id)}.1`,this.file(id)])try{for(const line of fs.readFileSync(file,"utf8").split("\n")){if(!line)continue;const event=JSON.parse(line);if(event.collaborationSessionId===id)all.push(event);}}catch{}
    const bounded=Math.max(1,Math.min(limit,500)),firstSequence=all[0]?.sequence??null,latestSequence=all.at(-1)?.sequence??0,pending=all.filter(event=>event.sequence>afterSequence),replayMissed=afterSequence>0&&((firstSequence!==null&&afterSequence<firstSequence-1)||afterSequence>latestSequence||pending.length>bounded);
    return{events:replayMissed?[]:pending.slice(-bounded),firstSequence,latestSequence,replayMissed};
  }

  subscribe(id:string, listener:(event:CollaborationEvent)=>void) {
    const set=this.listeners.get(id)??new Set(); set.add(listener); this.listeners.set(id,set);
    return ()=>{set.delete(listener);if(!set.size)this.listeners.delete(id);};
  }

  remove(id:string) {
    fs.rmSync(this.file(id),{force:true});fs.rmSync(`${this.file(id)}.1`,{force:true});this.sequences.delete(id);return true;
  }
}
