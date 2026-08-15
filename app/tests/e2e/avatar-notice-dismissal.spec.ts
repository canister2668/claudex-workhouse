import {expect,test} from "@playwright/test";

// Dismissing the floating notice used to be scoped to the session, so a single
// tap -- the primary interaction on a phone, where the card is deliberately
// tappable -- silenced every later notice of that session, the completion
// included. The dismissal now belongs to the task, and an outcome always speaks.
let task:any;
const emotionState=(over:Record<string,unknown>={})=>({emotion:"thinking",line:"음... 생각 중이에요",statusLine:"생각 중.",outfit:"normal",source:"claude-start",sessionId:"thread-a",taskId:"claude:running",...over});

async function boot(page:any){
  const now=new Date().toISOString();
  task={id:"claude:running",provider:"claude",nativeId:"running",threadId:"thread-a",projectId:"claudex-workhouse",title:"실행 중 작업",prompt:"fixture",status:"running",createdAt:now,updatedAt:now,result:null,error:null,log:"",owned:true,ownership:"claudex-workhouse",source:"claudex-workhouse",executionHostId:"local",workspaceId:"workspace-test",metadata:{}};
  await page.addInitScript(()=>{
    localStorage.setItem("claudex-ui-locale","ko");
    const streams:any[]=[];
    class FakeEventSource{
      onerror:null|(()=>void)=null;closed=false;handlers=new Map<string,Array<(event:any)=>void>>();
      constructor(public url:string){streams.push(this);}
      addEventListener(type:string,handler:(event:any)=>void){this.handlers.set(type,[...(this.handlers.get(type)??[]),handler]);}
      close(){this.closed=true;}
    }
    (window as any).__emitEmotion=(data:unknown)=>{
      let count=0;
      for(const stream of streams.filter(item=>!item.closed&&item.url.includes("/api/emotion/stream")))for(const handler of stream.handlers.get("emotion")??[]){handler({data:JSON.stringify(data)});count++;}
      return count;
    };
    Object.defineProperty(globalThis,"EventSource",{value:FakeEventSource,configurable:true});
  });
  await page.route("**/api/**",async (route:any)=>{
    const url=new URL(route.request().url()),path=url.pathname;
    const json=(value:unknown)=>route.fulfill({contentType:"application/json",body:JSON.stringify(value)});
    if(path==="/api/tasks"){const provider=url.searchParams.get("provider");return json({tasks:[task].filter(item=>!provider||item.provider===provider),partial:false,warnings:[]});}
    if(path==="/api/provider-connections")return json({singleUser:true,accounts:[{provider:"claude",state:"connected",checkedAt:now}],attempts:[]});
    if(path==="/api/provider-connections/attempts")return json({attempts:[]});
    if(path==="/api/emotion")return json({state:emotionState(),codexState:{emotion:"neutral",line:"",statusLine:"",outfit:"Gpt-Codex"},taskStates:{claude:{"claude:running":emotionState()}},outfits:["normal"],outfitsByProvider:{codex:["Gpt-Codex"],claude:["normal"],antigravity:["Antigravity"],deepseek:["DeepSeek"],ollama:["Ollama"]},assets:{normal:[{emotion:"thinking",file:"thinking.webp"}]},mode:"mcp"});
    if(path==="/api/projects")return json({projects:[{id:"claudex-workhouse",name:"Claudex Workhouse",enabled:true}]});
    if(path==="/api/hosts")return json({hosts:[{id:"local",displayName:"Local",status:"online"}]});
    if(path==="/api/workspaces")return json({workspaces:[{id:"workspace-test",projectId:"claudex-workhouse",hostId:"local",displayName:"Claudex Workhouse",canonicalPath:"/srv/claudex-workhouse"}]});
    if(path==="/api/collaborations")return json({collaborations:[]});
    if(path==="/api/conversation-documents")return json({documents:[]});
    if(path==="/api/quota-reservations")return json({reservations:[]});
    if(path==="/api/providers/codex/models")return json({catalog:{models:[],permissions:[]}});
    if(path==="/api/providers/antigravity/models"||path==="/api/providers/claude/permissions")return json({permissions:[],models:[],efforts:[],catalog:{models:[]}});
    if(path.startsWith("/api/system-settings/"))return json(path.endsWith("ui-locale")?{locale:"ko"}:{settings:null});
    if(path==="/api/quota")return json({claude:{},codex:{},antigravity:{},fetchedAt:now});
    if(path==="/api/push")return json({preferences:{},publicKey:""});
    if(path==="/api/setup")return json({required:false});
    return json({});
  });
  await page.goto("/",{waitUntil:"domcontentloaded"});
  await page.getByRole("navigation",{name:"주요 화면"}).getByRole("button",{name:"세션",exact:true}).click();
  await expect(page.locator(".agent-status-tray.flow")).toContainText("생각 중");
}

const notice=(page:any)=>page.locator(".agent-status-tray.flow .emotion-side").first();
// The notice reveals and then auto-collapses again after the configured delay,
// so a single sample after the fact proves nothing: sample until it opens.
async function opensWithin(page:any,ms:number){
  const end=Date.now()+ms;
  while(Date.now()<end){
    if(!await notice(page).evaluate((node:Element)=>node.classList.contains("collapsed")))return true;
    await page.waitForTimeout(150);
  }
  return false;
}

test("a dismissed notice stays quiet for its own task and speaks again for the outcome and the next task",async({page})=>{
  await boot(page);
  await expect.poll(()=>notice(page).evaluate((node:Element)=>node.classList.contains("collapsed")),{timeout:12000}).toBe(true);

  // Navigation only hides automatic notices. It must not recreate an unchanged
  // recent status and present it as a fresh notification on every tab entry.
  await page.getByRole("navigation",{name:"주요 화면"}).getByRole("button",{name:"홈",exact:true}).click();
  await page.getByRole("navigation",{name:"주요 화면"}).getByRole("button",{name:"세션",exact:true}).click();
  await expect.poll(()=>notice(page).evaluate((node:Element)=>node.classList.contains("collapsed"))).toBe(true);

  // Without a dismissal, a new emotion re-reveals the card.
  expect(await page.evaluate(()=> (window as any).__emitEmotion({emotion:"coding",line:"코드 수정 중이에요",statusLine:"코딩 중.",outfit:"normal",source:"claude-worker",sessionId:"thread-a",taskId:"claude:running"}))).toBeGreaterThan(0);
  expect(await opensWithin(page,3000)).toBe(true);

  // One tap dismisses it, and the rest of that task's activity respects it.
  await page.locator(".agent-status-tray.flow .avatar-panel").first().click();
  await expect.poll(()=>notice(page).evaluate((node:Element)=>node.classList.contains("collapsed"))).toBe(true);
  expect(await page.evaluate(()=> (window as any).__emitEmotion({emotion:"reading",line:"꼼꼼히 읽는 중이에요",statusLine:"읽는 중.",outfit:"normal",source:"claude-worker",sessionId:"thread-a",taskId:"claude:running"}))).toBeGreaterThan(0);
  expect(await opensWithin(page,3000)).toBe(false);

  // The outcome speaks through the dismissal.
  task={...task,status:"completed",updatedAt:new Date().toISOString()};
  expect(await opensWithin(page,15000)).toBe(true);

  // So does the next task.
  await page.locator(".agent-status-tray.flow .avatar-panel").first().click();
  await expect.poll(()=>notice(page).evaluate((node:Element)=>node.classList.contains("collapsed"))).toBe(true);
  task={...task,id:"claude:next",nativeId:"next",status:"running",title:"다음 작업",updatedAt:new Date().toISOString()};
  expect(await opensWithin(page,15000)).toBe(true);
});
