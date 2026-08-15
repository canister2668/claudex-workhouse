import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterEach,beforeEach,describe,expect,it} from "vitest";
import {RemoteTaskManager} from "../../src/server/desktop-worker/tasks.js";
import {StreamSpool} from "../../src/server/stream-events.js";
import type {WorkerConfig} from "../../src/server/desktop-worker/config.js";

let home="";
const managers:RemoteTaskManager[]=[];

const config=(taskId:string):WorkerConfig=>({
  schemaVersion:1,serverUrl:null,hostId:"local",credential:null,credentialVersion:0,entryKey:"k",
  roots:[],workspaces:[],claudeBinary:"claude",codexBinary:"codex",runtimeHome:home,
  tasks:[{id:taskId,provider:"claude",workspaceId:"w",stateFile:path.join(home,"state.json"),pid:null,marker:"m",createdAt:"",updatedAt:"",status:"running",threadId:null,lastForwardedSequence:0}]
});

function drain(taskId:string,total:number){
  const spool=new StreamSpool(home,taskId,"claude");
  for(let index=0;index<total;index++)spool.append({type:"agent_message_delta",content:`chunk-${index}`});
  const forwarded:Array<{eventId:string;event:any}>=[];
  const manager=new RemoteTaskManager(config(taskId),(_task,eventId,event)=>{forwarded.push({eventId,event});return true;});
  managers.push(manager);
  (manager as unknown as {poll:()=>Promise<void>}).poll();
  return forwarded;
}

beforeEach(()=>{home=fs.mkdtempSync(path.join(os.tmpdir(),"worker-forward-"));});
afterEach(()=>{for(const manager of managers.splice(0))manager.close();fs.rmSync(home,{recursive:true,force:true});});

describe("Worker event forwarding",()=>{
  it("forwards a small backlog in order",()=>{
    const forwarded=drain("task-small",12);
    expect(forwarded).toHaveLength(12);
    expect(forwarded.map(item=>item.event.content)).toEqual(Array.from({length:12},(_value,index)=>`chunk-${index}`));
  });

  it("forwards a burst larger than one read window instead of declaring it lost",()=>{
    // A local Windows host emits far more than 500 events inside one 300ms
    // tick. Reading a single bounded batch made `readStreamEvents` report
    // `replayMissed`, so the Worker skipped to the newest sequence and the
    // browser rendered a truncated stream with half-built output cards.
    const forwarded=drain("task-burst",1400);
    expect(forwarded).toHaveLength(1400);
    expect(forwarded.some(item=>item.eventId.startsWith("replay-missed:"))).toBe(false);
    expect(forwarded.at(-1)?.event.content).toBe("chunk-1399");
    expect(new Set(forwarded.map(item=>item.eventId)).size).toBe(1400);
  });

  it("still reports a real gap when the spool rotated past the last forwarded sequence",()=>{
    const taskId="task-rotated",spool=new StreamSpool(home,taskId,"claude");
    for(let index=0;index<5;index++)spool.append({type:"agent_message_delta",content:`chunk-${index}`});
    const forwarded:Array<{eventId:string}>=[];
    const state=config(taskId);state.tasks[0].lastForwardedSequence=1;
    // Drop the first events so the spool no longer covers sequence 1.
    const file=(spool as unknown as {file:string}).file;
    fs.writeFileSync(file,fs.readFileSync(file,"utf8").split("\n").slice(3).join("\n"));
    const manager=new RemoteTaskManager(state,(_task,eventId)=>{forwarded.push({eventId});return true;});
    managers.push(manager);
    (manager as unknown as {poll:()=>Promise<void>}).poll();
    expect(forwarded.map(item=>item.eventId)).toEqual(["replay-missed:5"]);
    expect(state.tasks[0].lastForwardedSequence).toBe(5);
  });

  it("stops forwarding when the transport refuses a message and resumes from there",()=>{
    const taskId="task-backpressure",spool=new StreamSpool(home,taskId,"claude");
    for(let index=0;index<10;index++)spool.append({type:"agent_message_delta",content:`chunk-${index}`});
    const state=config(taskId);let accepted=0;
    const manager=new RemoteTaskManager(state,()=>++accepted<=4);
    managers.push(manager);
    (manager as unknown as {poll:()=>Promise<void>}).poll();
    expect(state.tasks[0].lastForwardedSequence).toBe(4);
  });
});
