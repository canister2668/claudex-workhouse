import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterEach,describe,expect,it} from "vitest";
import {claudeEmotionForTool,codexEmotionForItem,providerEmotionWins,updateWorkerEmotion} from "../../src/server/worker-emotion.js";
import {translateFor} from "../../src/web/i18n/index.js";

const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});

describe("provider worker emotion bridge",()=>{
  it("keeps a late completion hook from replacing the newer task",()=>{
    const current={taskId:"new",taskStartedAt:200,emotion:"thinking"};
    expect(providerEmotionWins(current,"old",100)).toBe(false);
    expect(providerEmotionWins(current,"new",200)).toBe(true);
    expect(providerEmotionWins(current,"newer",300,"start")).toBe(true);
  });
  it("lets an older running task take the avatar back from a finished newer task",()=>{
    const finished={taskId:"new",taskStartedAt:200,emotion:"proud"};
    expect(providerEmotionWins(finished,"old",100,"update","building")).toBe(true);
    // Outcome against outcome still follows start order, so the newer task's
    // result is not undone by an earlier task finishing late.
    expect(providerEmotionWins(finished,"old",100,"update","happy")).toBe(false);
    expect(providerEmotionWins({taskId:"new",taskStartedAt:200,emotion:"thinking"},"old",100,"update","building")).toBe(false);
  });
  it("maps provider events without lifecycle hook configuration",()=>{
    expect(claudeEmotionForTool("Bash")).toBe("building");
    expect(claudeEmotionForTool("Write")).toBe("coding");
    expect(claudeEmotionForTool("Read")).toBe("reading");
    expect(claudeEmotionForTool("Agent")).toBe("searching");
    expect(codexEmotionForItem({type:"commandExecution"})).toBe("building");
    expect(codexEmotionForItem({type:"fileChange"})).toBe("coding");
    expect(codexEmotionForItem({type:"webSearch"})).toBe("reading");
    expect(codexEmotionForItem({type:"collabAgentToolCall"})).toBe("searching");
  });

  it("preserves the server-selected Codex outfit across worker updates",()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),"workhouse-emotion-"));roots.push(root);
    const file=path.join(root,"data","emotion","codex-state.json");fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify({emotion:"neutral",outfit:"Gpt-Sol"}));
    updateWorkerEmotion(root,"codex","coding","codex-session",()=>0);
    expect(JSON.parse(fs.readFileSync(file,"utf8"))).toMatchObject({emotion:"coding",outfit:"Gpt-Sol"});
  });

  it("writes state under the Workhouse root and preserves explicit MCP emotion holds",()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),"workhouse-emotion-"));roots.push(root);
    updateWorkerEmotion(root,"claude","coding","claude-session",()=>0);
    updateWorkerEmotion(root,"codex","building","codex-session",()=>0);
    const claudeFile=path.join(root,"data","emotion","state.json");
    expect(JSON.parse(fs.readFileSync(claudeFile,"utf8"))).toMatchObject({emotion:"coding",source:"claude-worker",sessionId:"claude-session"});
    fs.writeFileSync(claudeFile,JSON.stringify({emotion:"love",outfit:"normal",source:"mcp",sessionId:"claude-session",timestamp:Date.now()}));
    updateWorkerEmotion(root,"claude","reading","claude-session");
    expect(JSON.parse(fs.readFileSync(claudeFile,"utf8"))).toMatchObject({emotion:"love",source:"mcp",sessionId:"claude-session"});
    updateWorkerEmotion(root,"claude","reading","other-claude-session",()=>0);
    expect(JSON.parse(fs.readFileSync(claudeFile,"utf8"))).toMatchObject({emotion:"reading",source:"claude-worker",sessionId:"other-claude-session"});
    const codexFile=path.join(root,"data","emotion","codex-state.json"),held={emotion:"love",outfit:"Gpt-Codex",source:"mcp-codex",sessionId:"codex-session",holdUntil:Date.now()+60_000,timestamp:Date.now()};
    fs.writeFileSync(codexFile,JSON.stringify(held));
    updateWorkerEmotion(root,"codex","reading","codex-session");
    expect(JSON.parse(fs.readFileSync(codexFile,"utf8"))).toMatchObject({emotion:"love",source:"mcp-codex"});
    updateWorkerEmotion(root,"codex","reading","other-session",()=>0);
    expect(JSON.parse(fs.readFileSync(codexFile,"utf8"))).toMatchObject({emotion:"reading",source:"codex-worker",sessionId:"other-session"});
    const ollamaFile=path.join(root,"data","emotion","ollama-state.json"),caught={emotion:"chu",outfit:"Ollama",source:"ollama-catch",sessionId:"ollama-session",holdUntil:Date.now()+60_000,timestamp:Date.now()};
    fs.writeFileSync(ollamaFile,JSON.stringify(caught));
    updateWorkerEmotion(root,"ollama","done","ollama-session");
    expect(JSON.parse(fs.readFileSync(ollamaFile,"utf8"))).toMatchObject({emotion:"chu",source:"ollama-catch"});
    updateWorkerEmotion(root,"ollama","done","other-ollama-session",()=>0);
    expect(JSON.parse(fs.readFileSync(ollamaFile,"utf8"))).toMatchObject({emotion:"proud",source:"ollama-worker",sessionId:"other-ollama-session"});
    const heldMcp={emotion:"chu",outfit:"Ollama",source:"mcp-ollama",sessionId:"ollama-session",holdUntil:Date.now()+60_000,timestamp:Date.now()-10_000};
    fs.writeFileSync(ollamaFile,JSON.stringify(heldMcp));
    updateWorkerEmotion(root,"ollama","done","ollama-session");
    expect(JSON.parse(fs.readFileSync(ollamaFile,"utf8"))).toMatchObject({emotion:"chu",source:"mcp-ollama"});
    const grokFile=path.join(root,"data","emotion","grok-state.json"),grokMcp={emotion:"chu",outfit:"Grok",source:"mcp-grok",sessionId:"grok-session",taskId:"grok:one",holdUntil:Date.now()+60_000,timestamp:Date.now()};
    fs.writeFileSync(grokFile,JSON.stringify(grokMcp));
    const previousTask=process.env.CLAUDEX_WORKHOUSE_CURRENT_TASK_ID;try{process.env.CLAUDEX_WORKHOUSE_CURRENT_TASK_ID="grok:one";updateWorkerEmotion(root,"grok","done","grok-session");expect(JSON.parse(fs.readFileSync(grokFile,"utf8"))).toMatchObject({emotion:"chu",source:"mcp-grok",taskId:"grok:one"});process.env.CLAUDEX_WORKHOUSE_CURRENT_TASK_ID="grok:two";updateWorkerEmotion(root,"grok","done","other-grok-session",()=>0);expect(JSON.parse(fs.readFileSync(grokFile,"utf8"))).toMatchObject({emotion:"proud",source:"grok-worker",taskId:"grok:two"});}finally{if(previousTask===undefined)delete process.env.CLAUDEX_WORKHOUSE_CURRENT_TASK_ID;else process.env.CLAUDEX_WORKHOUSE_CURRENT_TASK_ID=previousTask;}
  });

  // A hold protects a requested expression, but it used to swallow the outcome
  // as well. A task that ended inside its own window then left the avatar on an
  // activity emotion forever, since nothing writes for a finished task again.
  it("lets an outcome replace a held activity emotion without disturbing a held expression",()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),"workhouse-emotion-"));roots.push(root);
    const file=path.join(root,"data","emotion","antigravity-state.json");
    const held=(emotion:string)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify({emotion,outfit:"Antigravity",source:"antigravity-catch",sessionId:"gemine",holdUntil:Date.now()+60_000,timestamp:Date.now()}));};

    held("searching");
    updateWorkerEmotion(root,"antigravity","disappointed","gemine",()=>0);
    expect(JSON.parse(fs.readFileSync(file,"utf8"))).toMatchObject({emotion:"disappointed",source:"antigravity-worker"});

    held("building_3");
    updateWorkerEmotion(root,"antigravity","done","gemine",()=>0);
    expect(JSON.parse(fs.readFileSync(file,"utf8"))).toMatchObject({emotion:"proud",source:"antigravity-worker"});

    // The keyword-matched expression a user actually asked for still outlives
    // the turn, and progress churn still cannot break a hold of either kind.
    held("chu");
    updateWorkerEmotion(root,"antigravity","done","gemine",()=>0);
    expect(JSON.parse(fs.readFileSync(file,"utf8"))).toMatchObject({emotion:"chu",source:"antigravity-catch"});
    held("searching");
    updateWorkerEmotion(root,"antigravity","coding","gemine",()=>0);
    expect(JSON.parse(fs.readFileSync(file,"utf8"))).toMatchObject({emotion:"searching",source:"antigravity-catch"});
  });

  // The two completion faces used to alternate off the emotion already on
  // screen, which at completion is always this task's own last activity. Every
  // task therefore read as the first one and "happy" never appeared. A coin
  // flip, matching the start hook, does not depend on that history at all.
  it("picks either completion face by coin flip, whatever the task was doing",()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),"workhouse-emotion-"));roots.push(root);
    const file=path.join(root,"data","emotion","codex-state.json");
    const readEmotion=()=>JSON.parse(fs.readFileSync(file,"utf8")).emotion;
    const task=(session:string,flip:number)=>{
      updateWorkerEmotion(root,"codex","building",session,()=>0);
      updateWorkerEmotion(root,"codex","reading",session,()=>0);
      updateWorkerEmotion(root,"codex","done",session,()=>flip);
      return readEmotion();
    };
    expect(task("codex-1",0)).toBe("proud");
    expect(task("codex-2",0.499)).toBe("proud");
    expect(task("codex-3",0.5)).toBe("happy");
    expect(task("codex-4",0.999)).toBe("happy");
    // Repeating a face is allowed: each completion is an independent flip.
    expect(task("codex-5",0.999)).toBe("happy");
    // A failure is not a coin flip.
    updateWorkerEmotion(root,"codex","disappointed","codex-6",()=>0.999);
    expect(readEmotion()).toBe("disappointed");
  });

  it("randomizes activity artwork and keeps each variant's dialogue paired",()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),"workhouse-emotion-"));roots.push(root);
    const activities=["thinking","coding","building","reading","searching"];
    const selectors=[0,0.5,0.999];
    for(const provider of ["claude","codex"] as const){
      for(const requested of activities)for(let index=0;index<selectors.length;index++){
        const stateFile=path.join(root,"data","emotion",provider==="codex"?"codex-state.json":"state.json");
        fs.mkdirSync(path.dirname(stateFile),{recursive:true});
        fs.writeFileSync(stateFile,JSON.stringify({emotion:"neutral",outfit:provider==="codex"?"Gpt-Codex":"normal"}));
        const emotion=index===0?requested:`${requested}_${index+1}`,lineKey=`avatar.line.${emotion}`,statusKey=`avatar.status.${emotion}`;
        updateWorkerEmotion(root,provider,requested,`${provider}-${requested}-${index}`,()=>selectors[index]!);
        expect(JSON.parse(fs.readFileSync(stateFile,"utf8"))).toMatchObject({emotion,line:translateFor("ko",lineKey),statusLine:translateFor("ko",statusKey),lineKey,statusKey,source:`${provider}-worker`});
        for(const language of ["en","ja"] as const){
          expect(translateFor(language,lineKey)).not.toBe(lineKey);
          expect(translateFor(language,statusKey)).not.toBe(statusKey);
        }
      }
    }
  });

  it("does not immediately repeat the same activity variant",()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),"workhouse-emotion-"));roots.push(root);
    updateWorkerEmotion(root,"codex","coding","codex-session",()=>0);
    updateWorkerEmotion(root,"codex","coding","codex-session",()=>0);
    const stateFile=path.join(root,"data","emotion","codex-state.json");
    expect(JSON.parse(fs.readFileSync(stateFile,"utf8"))).toMatchObject({emotion:"coding_2",lineKey:"avatar.line.coding_2"});
  });
  it("records the current task and never inherits a previous task session",()=>{
    const root=fs.mkdtempSync(path.join(os.tmpdir(),"workhouse-emotion-"));roots.push(root);const previous=process.env.CLAUDEX_WORKHOUSE_CURRENT_TASK_ID;
    try{
      process.env.CLAUDEX_WORKHOUSE_CURRENT_TASK_ID="ollama:new-task";
      const stateFile=path.join(root,"data","emotion","ollama-state.json");fs.mkdirSync(path.dirname(stateFile),{recursive:true});fs.writeFileSync(stateFile,JSON.stringify({emotion:"happy",line:"old",statusLine:"",outfit:"Ollama",sessionId:"old-session",taskId:"ollama:old-task"}));
      updateWorkerEmotion(root,"ollama","thinking",null,()=>0);
      expect(JSON.parse(fs.readFileSync(stateFile,"utf8"))).toMatchObject({taskId:"ollama:new-task",sessionId:""});
      const snapshots=fs.readdirSync(path.join(root,"data","emotion","tasks","ollama"));expect(snapshots).toHaveLength(1);expect(JSON.parse(fs.readFileSync(path.join(root,"data","emotion","tasks","ollama",snapshots[0]!),"utf8"))).toMatchObject({taskId:"ollama:new-task"});
    }finally{if(previous===undefined)delete process.env.CLAUDEX_WORKHOUSE_CURRENT_TASK_ID;else process.env.CLAUDEX_WORKHOUSE_CURRENT_TASK_ID=previous;}
  });
});
