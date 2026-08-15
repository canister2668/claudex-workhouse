import {expect,test} from "@playwright/test";

test("Codex keeps the persisted Sol outfit while the reload snapshot is pending",async({page})=>{
  await page.addInitScript(()=>{
    localStorage.setItem("claudex-ui-locale","ko");
    localStorage.setItem("deck-global-settings",JSON.stringify({codexAvatar:"Gpt-Sol"}));
    class SilentEventSource{onerror:null|(()=>void)=null;constructor(public url:string){}addEventListener(){}close(){}}
    Object.defineProperty(globalThis,"EventSource",{value:SilentEventSource,configurable:true});
  });
  const now=new Date().toISOString();let releaseEmotion:()=>void=()=>{};const emotionPending=new Promise<void>(resolve=>releaseEmotion=resolve);
  await page.route("**/api/**",async route=>{
    const url=new URL(route.request().url()),path=url.pathname,json=(value:unknown)=>route.fulfill({contentType:"application/json",body:JSON.stringify(value)});
    if(path==="/api/emotion"){await emotionPending;return json({state:{emotion:"neutral",outfit:"normal"},codexState:{emotion:"neutral",outfit:"Gpt-Sol",source:"claudex-workhouse"},taskStates:{codex:{}},outfitsByProvider:{codex:["Gpt-Codex","Gpt-Sol"],claude:["normal"],antigravity:["Antigravity"],deepseek:["DeepSeek"],ollama:["Ollama"]},assets:{},mode:"catch"});}
    if(path==="/api/provider-connections")return json({singleUser:true,accounts:[{provider:"codex",state:"connected",checkedAt:now}],attempts:[]});
    if(path==="/api/provider-connections/attempts")return json({attempts:[]});
    if(path==="/api/tasks")return json({tasks:[],partial:false,warnings:[]});
    if(path==="/api/projects")return json({projects:[]});
    if(path==="/api/hosts")return json({hosts:[]});
    if(path==="/api/workspaces")return json({workspaces:[]});
    if(path==="/api/collaborations")return json({collaborations:[]});
    if(path==="/api/conversation-documents")return json({documents:[]});
    if(path==="/api/quota-reservations")return json({reservations:[]});
    if(path==="/api/providers/codex/models")return json({catalog:{models:[],permissions:[]}});
    if(path==="/api/providers/claude/permissions")return json({permissions:[],models:[],efforts:[],catalog:{models:[]}});
    if(path.startsWith("/api/system-settings/"))return json(path.endsWith("ui-locale")?{locale:"ko"}:{settings:null});
    if(path==="/api/quota")return json({claude:{},codex:{},fetchedAt:now});
    if(path==="/api/push")return json({preferences:{},publicKey:""});
    if(path==="/api/setup")return json({required:false});
    return json({});
  });
  await page.goto("/",{waitUntil:"domcontentloaded"});
  const avatar=page.locator(".agent-avatar-slot.codex img").first();
  await expect(avatar).toHaveAttribute("src",/\/emoticons\/Gpt-Sol\/Gpt-Sol_neutral\.webp$/);
  const bootstrapped=page.waitForResponse(response=>new URL(response.url()).pathname==="/api/emotion");
  releaseEmotion();
  await bootstrapped;
  await expect(avatar).toHaveAttribute("src",/\/emoticons\/Gpt-Sol\/Gpt-Sol_neutral\.webp$/);
});

test("avatar status is task-scoped and compatible providers receive terminal events",async({page})=>{
  await page.addInitScript(()=>{
    localStorage.setItem("claudex-ui-locale","ko");
    localStorage.setItem("deck-avatar-completed-codex","1");
    const streams:any[]=[];
    class FakeEventSource{
      onerror:null|(()=>void)=null;
      closed=false;
      handlers=new Map<string,Array<(event:any)=>void>>();
      constructor(public url:string){streams.push(this);}
      addEventListener(type:string,handler:(event:any)=>void){this.handlers.set(type,[...(this.handlers.get(type)??[]),handler]);}
      close(){this.closed=true;}
    }
    (window as any).__emitAvatarEvent=(fragment:string,type:string,data:unknown)=>{
      let count=0;
      for(const stream of streams.filter(item=>!item.closed&&item.url.includes(fragment)))for(const handler of stream.handlers.get(type)??[]){handler({data:JSON.stringify(data)});count++;}
      return count;
    };
    (window as any).__avatarStreamUrls=()=>streams.map(item=>item.url);
    Object.defineProperty(globalThis,"EventSource",{value:FakeEventSource,configurable:true});
  });

  const now=new Date().toISOString();
  const task={id:"antigravity:new-task",provider:"antigravity",nativeId:"new-task",threadId:"shared-thread",projectId:"claudex-workhouse",title:"현재 Gemini 작업",prompt:"fixture",status:"running",createdAt:now,updatedAt:now,result:null,error:null,log:"",owned:true,ownership:"claudex-workhouse",source:"claudex-workhouse",executionHostId:"local",workspaceId:"workspace-test",metadata:{}};
  const tasks=[task,{...task,id:"deepseek:new-task",nativeId:"deepseek-new",provider:"deepseek",threadId:"deepseek-thread",title:"현재 DeepSeek 작업"},{...task,id:"ollama:new-task",nativeId:"ollama-new",provider:"ollama",threadId:"ollama-thread",title:"현재 Ollama 작업"}];
  await page.route("**/api/**",async route=>{
    const request=route.request(),url=new URL(request.url()),path=url.pathname;
    const json=(value:unknown)=>route.fulfill({contentType:"application/json",body:JSON.stringify(value)});
    if(path==="/api/tasks"){const provider=url.searchParams.get("provider");return json({tasks:tasks.filter(item=>!provider||item.provider===provider),partial:false,warnings:[]});}
    if(path==="/api/provider-connections")return json({singleUser:true,accounts:[{provider:"codex",state:"connected",checkedAt:now},{provider:"antigravity",state:"connected",checkedAt:now},{provider:"deepseek",state:"connected",checkedAt:now},{provider:"ollama",state:"connected",checkedAt:now}],attempts:[]});
    if(path==="/api/provider-connections/attempts")return json({attempts:[]});
    if(path==="/api/emotion")return json({state:{emotion:"neutral",line:"",statusLine:"",outfit:"normal"},codexState:{emotion:"neutral",line:"",statusLine:"",outfit:"Gpt-Codex"},antigravityState:{emotion:"building",line:"오염된 이전 작업",statusLine:"실행 중.",outfit:"Antigravity",sessionId:"shared-thread",taskId:"antigravity:old-task"},deepseekState:{emotion:"chu",line:"DeepSeek 작업 대사",statusLine:"정상",outfit:"DeepSeek",source:"mcp-deepseek",sessionId:"stale-deepseek-thread",taskId:"deepseek:new-task"},ollamaState:{emotion:"chu",line:"Ollama 작업 대사",statusLine:"정상",outfit:"Ollama",sessionId:"stale-ollama-thread",taskId:"ollama:new-task"},outfits:["normal"],outfitsByProvider:{codex:["Gpt-Codex","Gpt-Sol"],claude:["normal"],antigravity:["Antigravity"],deepseek:["DeepSeek"],ollama:["Ollama"]},assets:{DeepSeek:[{emotion:"neutral",file:"neutral.webp"},{emotion:"chu",file:"chu.webp"}],Ollama:[{emotion:"neutral",file:"neutral.webp"},{emotion:"chu",file:"chu~.webp"}]},mode:"catch"});
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
  await expect(page.locator(".agent-avatar-slot.codex .avatar-speech")).toHaveCount(0);
  await expect(page.getByText("오염된 이전 작업",{exact:true})).toHaveCount(0);
  await expect(page.locator(".agent-avatar-slot.antigravity .avatar-speech")).toContainText("실행 중");
  await page.getByRole("navigation",{name:"주요 화면"}).getByRole("button",{name:"세션",exact:true}).click();
  expect(await page.evaluate(()=> (window as any).__emitAvatarEvent("/api/emotion/stream","deepseek-emotion",{emotion:"chu",line:"DeepSeek 작업 대사",statusLine:"정상",outfit:"DeepSeek",source:"mcp-deepseek",sessionId:"stale-deepseek-thread",taskId:"deepseek:new-task"}))).toBeGreaterThan(0);
  expect(await page.evaluate(()=> (window as any).__emitAvatarEvent("/api/emotion/stream","ollama-emotion",{emotion:"chu",line:"Ollama 작업 대사",statusLine:"정상",outfit:"Ollama",sessionId:"stale-ollama-thread",taskId:"ollama:new-task"}))).toBeGreaterThan(0);
  await expect(page.locator(".agent-status-tray.flow")).toContainText("DeepSeek 작업 대사");
  await expect(page.locator(".agent-status-tray.flow")).toContainText("Ollama 작업 대사");
  await expect(page.locator(".agent-avatar-slot.deepseek img")).toHaveAttribute("src",/\/emoticons\/DeepSeek\/chu\.webp$/);
  await expect(page.locator(".agent-avatar-slot.ollama img")).toHaveAttribute("src",/\/emoticons\/Ollama\/chu~\.webp$/);
  await expect.poll(()=>page.evaluate(()=> (window as any).__avatarStreamUrls())).toContainEqual(expect.stringContaining("/api/tasks/antigravity/"));

  expect(await page.evaluate(()=> (window as any).__emitAvatarEvent("/api/tasks/antigravity/","agent-event",{type:"task_completed",content:"done",sequence:999,terminal:true,timestamp:new Date().toISOString()}))).toBeGreaterThan(0);
  await expect(page.locator(".agent-avatar-slot.antigravity .avatar-speech")).toContainText("완료");
});

test("a stale completed turn cannot own the avatar after its follow-up starts",async({page})=>{
  await page.addInitScript(()=>{
    localStorage.setItem("claudex-ui-locale","ko");
    const urls:string[]=[];
    class FakeEventSource{onerror:null|(()=>void)=null;constructor(public url:string){urls.push(url);}addEventListener(){}close(){}}
    Object.defineProperty(globalThis,"EventSource",{value:FakeEventSource,configurable:true});
    (window as any).__avatarStreamUrls=()=>urls;
  });
  const now=new Date().toISOString(),threadId="44444444-4444-4444-8444-444444444444";
  const nextTask={id:"codex:next",provider:"codex",nativeId:"next",threadId,projectId:"claudex-workhouse",title:"새 후속 작업",prompt:"next",status:"running",createdAt:now,updatedAt:now,result:null,error:null,log:"",owned:true,ownership:"claudex-workhouse",source:"claudex-workhouse",executionHostId:"local",workspaceId:"workspace-test",metadata:{}};
  const previousTask={...nextTask,id:"codex:previous",nativeId:"previous",title:"이전 완료 작업",prompt:"old",status:"completed"};
  const staleSession={threadId,taskId:"codex:previous",projectId:"claudex-workhouse",title:"이전 완료 작업",preview:"old",source:"claudex-workhouse",ownership:"claudex-workhouse",status:"running",updatedAt:new Date(Date.now()+1000).toISOString(),canMutate:true,canStop:true,workspaceId:"workspace-test",executionHostId:"local",metadata:{}};
  let exactTaskAvailable=true;
  await page.route("**/api/**",async route=>{
    const url=new URL(route.request().url()),path=url.pathname,json=(value:unknown)=>route.fulfill({contentType:"application/json",body:JSON.stringify(value)});
    if(path==="/api/tasks"){const provider=url.searchParams.get("provider");return json({tasks:!provider||provider==="codex"?[exactTaskAvailable?nextTask:{...previousTask,status:"running"}]:[],partial:false,warnings:[]});}
    if(path==="/api/codex/threads")return json({sessions:[staleSession],nextCursor:null,stale:false,syncedAt:now,capabilities:{delete:true}});
    if(path==="/api/provider-connections")return json({singleUser:true,accounts:[{provider:"codex",state:"connected",checkedAt:now}],attempts:[]});
    if(path==="/api/provider-connections/attempts")return json({attempts:[]});
    if(path==="/api/emotion")return json({state:{emotion:"neutral",line:"",statusLine:"",outfit:"normal"},codexState:{emotion:"happy",line:"이전 완료 훅",statusLine:"완료!",outfit:"Gpt-Codex",source:"codex-worker",sessionId:threadId,taskId:"codex:previous"},taskStates:{codex:{"codex:previous":{emotion:"happy",line:"이전 완료 훅",statusLine:"완료!",outfit:"Gpt-Codex",source:"codex-worker",sessionId:threadId,taskId:"codex:previous"},"codex:next":{emotion:"thinking",line:"새 작업 시작 훅",statusLine:"생각 중.",outfit:"Gpt-Codex",source:"codex-worker",sessionId:threadId,taskId:"codex:next"}}},outfits:["normal"],outfitsByProvider:{codex:["Gpt-Codex","Gpt-Sol"],claude:["normal"]},assets:{},mode:"catch"});
    if(path==="/api/projects")return json({projects:[{id:"claudex-workhouse",name:"Claudex Workhouse",enabled:true}]});
    if(path==="/api/hosts")return json({hosts:[{id:"local",displayName:"Local",status:"online"}]});
    if(path==="/api/workspaces")return json({workspaces:[{id:"workspace-test",projectId:"claudex-workhouse",hostId:"local",displayName:"Claudex Workhouse",canonicalPath:"/srv/claudex-workhouse"}]});
    if(path==="/api/collaborations")return json({collaborations:[]});
    if(path==="/api/conversation-documents")return json({documents:[]});
    if(path==="/api/quota-reservations")return json({reservations:[]});
    if(path==="/api/providers/codex/models")return json({catalog:{models:[],permissions:[]}});
    if(path.startsWith("/api/system-settings/"))return json(path.endsWith("ui-locale")?{locale:"ko"}:{settings:null});
    if(path==="/api/quota")return json({claude:{},codex:{},fetchedAt:now});
    if(path==="/api/push")return json({preferences:{},publicKey:""});
    if(path==="/api/setup")return json({required:false});
    return json({});
  });
  await page.goto("/",{waitUntil:"domcontentloaded"});
  await page.getByRole("navigation",{name:"주요 화면"}).getByRole("button",{name:"세션",exact:true}).click();
  await page.locator(".agent-avatar-slot.codex").getByRole("button").first().click();
  const panel=page.locator(".agent-avatar-slot.codex .recent-session-pop");
  await expect(panel).toContainText("새 작업 시작 훅");
  await expect(panel).not.toContainText("이전 완료 훅");
  await expect.poll(()=>page.evaluate(()=>(window as any).__avatarStreamUrls())).toContainEqual(expect.stringContaining("/api/tasks/codex/codex%3Anext/events/stream"));

  // Reproduce the screenshot race: the native thread is already running, but
  // both snapshots still expose the preceding task id. Active status must win
  // over that task's completed worker hook until the new id becomes visible.
  exactTaskAvailable=false;
  await page.reload({waitUntil:"domcontentloaded"});
  await page.getByRole("navigation",{name:"주요 화면"}).getByRole("button",{name:"세션",exact:true}).click();
  await page.locator(".agent-avatar-slot.codex").getByRole("button").first().click();
  const racedPanel=page.locator(".agent-avatar-slot.codex .recent-session-pop");
  await expect(racedPanel).not.toContainText("이전 완료 훅");
  await expect(racedPanel.locator(".recent-avatar-profile img")).toHaveAttribute("src",/Gpt-Codex_coding\.webp$/);
});
