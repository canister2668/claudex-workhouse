import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {afterEach,describe,expect,it} from "vitest";
import {claudeAgentStartedEvent,claudeAgentSystemEvent,claudeAgentToolResultEvent} from "../../src/server/claude-subagents.js";
import {claudeTranscriptEvents,transcriptFile} from "../../src/server/claude-transcript.js";
import type {AgentEvent} from "../../src/web/events";
import {parallelAgentCards} from "../../src/web/parallel-agents";

const created:string[]=[];const originalHome=process.env.HOME;
afterEach(()=>{process.env.HOME=originalHome;for(const directory of created.splice(0))fs.rmSync(directory,{recursive:true,force:true});});

// Shapes captured from `claude -p --output-format stream-json` 2.1.302 running two background Agent calls.
const agentUse=(id:string,description:string)=>({type:"tool_use",id,name:"Agent",input:{subagent_type:"fork",description,prompt:`${description} with Bash and report the output.`}});
const launched=(id:string,agentId:string)=>({part:{tool_use_id:id,type:"tool_result",content:[{type:"text",text:`Async agent launched successfully.\nagentId: ${agentId} (internal ID)`}]},result:{isAsync:true,status:"async_launched",agentId}});

describe("Claude subagent lifecycle",()=>{
  it("turns background Agent calls and their task records into roster cards",()=>{
    const ids=new Set(["toolu_a","toolu_b"]),root="session-1";
    const events=[
      {...claudeAgentStartedEvent(agentUse("toolu_a","Run echo alpha")),threadId:root},
      {...claudeAgentToolResultEvent(launched("toolu_a","agent-a").part,launched("toolu_a","agent-a").result),threadId:root},
      {...claudeAgentStartedEvent(agentUse("toolu_b","Run echo beta")),threadId:root},
      {...claudeAgentToolResultEvent(launched("toolu_b","agent-b").part,launched("toolu_b","agent-b").result),threadId:root},
      {...claudeAgentSystemEvent({type:"system",subtype:"task_progress",task_id:"agent-a",tool_use_id:"toolu_a",description:"Running Print alpha",last_tool_name:"Bash"},ids)!,threadId:root},
      // The subagent's own command runs on its child thread.
      {type:"command_started",content:"echo alpha",threadId:"toolu_a",itemId:"toolu_cmd"},
      {...claudeAgentSystemEvent({type:"system",subtype:"task_notification",task_id:"agent-a",tool_use_id:"toolu_a",status:"completed",summary:"Output: `alpha`"},ids)!,threadId:root}
    ] as AgentEvent[];
    const cards=parallelAgentCards(events,root);
    expect(cards.map(card=>card.id)).toEqual(["toolu_a","toolu_b"]);
    expect(cards.map(card=>card.status)).toEqual(["completed","running"]);
    expect(cards[0]?.prompt).toBe("Run echo alpha with Bash and report the output.");
    expect(cards[0]?.activity).toBe("Output: `alpha`");
    expect(cards[0]?.activityCount).toBe(1);
  });

  it("ignores task records of background shell commands",()=>{
    expect(claudeAgentSystemEvent({type:"system",subtype:"task_notification",task_id:"bash-1",tool_use_id:"toolu_bash",status:"completed"},new Set(["toolu_a"]))).toBeNull();
  });

  it("closes a foreground Agent call from its tool result",()=>{
    const failed=claudeAgentToolResultEvent({tool_use_id:"toolu_a",type:"tool_result",content:"boom",is_error:true},undefined);
    expect(failed).toMatchObject({type:"agent_failed",status:"failed",content:"boom",metadata:{agentThreadId:"toolu_a"}});
  });

  it("rebuilds the roster from a transcript's task notifications",()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),"claudex-workhouse-subagents-"));created.push(root);process.env.HOME=path.join(root,"home");
    const sessionId=crypto.randomUUID(),file=transcriptFile("/srv/project",sessionId);fs.mkdirSync(path.dirname(file),{recursive:true});
    const row=(value:object,second:number)=>JSON.stringify({...value,timestamp:`2026-10-18T00:00:${String(second).padStart(2,"0")}.000Z`});
    const notification=(body:string)=>({type:"user",message:{role:"user",content:`<task-notification>\n${body}\n</task-notification>`}});
    fs.writeFileSync(file,[
      row({type:"user",message:{role:"user",content:"Fix both bots"}},0),
      row({type:"assistant",message:{id:"msg_1",content:[agentUse("toolu_a","Fix alpha"),agentUse("toolu_b","Fix beta")]}},1),
      row({type:"user",message:{role:"user",content:[launched("toolu_a","agent-a").part]},toolUseResult:launched("toolu_a","agent-a").result},2),
      row({type:"user",message:{role:"user",content:[launched("toolu_b","agent-b").part]},toolUseResult:launched("toolu_b","agent-b").result},3),
      row(notification(`<task-id>agent-a</task-id>\n<tool-use-id>toolu_a</tool-use-id>\n<status>completed</status>\n<summary>Agent "Fix alpha" finished</summary>\n<result>alpha fixed</result>`),4),
      row(notification(`<task-id>agent-b</task-id>\n<status>stopped</status>\n<summary>1 background agent didn't finish</summary>`),5)
    ].join("\n")+"\n");
    const events=claudeTranscriptEvents(file,"/srv/project").events as AgentEvent[];
    expect(events.some(event=>event.type==="tool_started"||event.type==="tool_completed")).toBe(false);
    const cards=parallelAgentCards(events,sessionId);
    expect(cards.map(card=>[card.id,card.status,card.activity])).toEqual([["toolu_a","completed","alpha fixed"],["toolu_b","failed","1 background agent didn't finish"]]);
  });
});
