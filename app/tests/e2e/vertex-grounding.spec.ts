import{expect,test}from"@playwright/test";

test("renders Vertex Google Search sources and the provided search suggestion",async({page})=>{
  await page.addInitScript(()=>{localStorage.setItem("claudex-ui-locale","ko");class SilentEventSource{onerror:null|(()=>void)=null;constructor(public url:string){}addEventListener(){}close(){}}Object.defineProperty(globalThis,"EventSource",{value:SilentEventSource,configurable:true});});
  const now=new Date().toISOString(),grounding={webSearchQueries:["latest Gemini model"],sources:[{uri:"https://vertexaisearch.cloud.google.com/grounding-api-redirect/source",title:"Google Cloud release notes"}],renderedContent:'<a id="search-chip" href="https://www.google.com/search?q=latest+Gemini+model" target="_blank">latest Gemini model</a>'},task={id:"antigravity:grounding-test",provider:"antigravity",nativeId:"grounding-test",threadId:"vertex:grounding",projectId:"project",title:"Vertex grounding",prompt:"최신 Gemini 모델은?",status:"completed",createdAt:now,updatedAt:now,result:"최신 공개 모델입니다.",error:null,log:"",owned:true,ownership:"claudex-workhouse",source:"claudex-workhouse",executionHostId:"local",workspaceId:"workspace",requestedModel:"gemini-3.6-flash",metadata:{grounding}};
  await page.route("**/api/**",async route=>{const pathname=new URL(route.request().url()).pathname,json=(value:unknown)=>route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(value)});
    if(pathname==="/api/tasks")return json({tasks:[task],partial:false,warnings:[]});
    if(pathname.includes("/api/tasks/antigravity/")&&pathname.endsWith("/events"))return json({latestSequence:1,events:[{type:"message_completed",content:task.result,sequence:1,provider:"antigravity",metadata:{role:"agent",phase:"final_answer",grounding}}]});
    if(pathname.includes("/api/tasks/antigravity/"))return json({task});
    if(pathname==="/api/projects")return json({projects:[{id:"project",name:"Project",enabled:true,error:null}]});
    if(pathname==="/api/hosts")return json({hosts:[{id:"local",displayName:"Local",status:"online"}]});
    if(pathname==="/api/workspaces")return json({workspaces:[{id:"workspace",projectId:"project",hostId:"local",displayName:"Workspace",canonicalPath:"/workspace"}]});
    if(pathname==="/api/collaborations")return json({collaborations:[]});
    if(pathname==="/api/providers/codex/models")return json({catalog:{models:[],permissions:[]}});
    if(pathname==="/api/providers/claude/permissions")return json({models:[],permissions:[],efforts:[],catalog:{models:[],stale:false}});
    if(pathname==="/api/provider-connections"||pathname==="/api/provider-connections/attempts")return json({accounts:[],attempts:[]});
    if(pathname==="/api/quota")return json({claude:{},codex:{},antigravity:{},fetchedAt:now});
    if(pathname==="/api/emotion")return json({state:{},codexState:{},antigravityState:{},outfits:[],assets:[],mode:"catch"});
    if(pathname==="/api/push")return json({preferences:{},publicKey:""});
    if(pathname.startsWith("/api/system-settings/"))return json({settings:null,candidates:{claude:[],codex:[],antigravity:[]}});
    return json({});
  });
  await page.goto("/?task=antigravity%3Agrounding-test",{waitUntil:"domcontentloaded"});
  const answer=page.locator('.bubble.agent[data-event-type="message_completed"]').filter({hasText:"최신 공개 모델입니다."});
  await expect(answer).toBeVisible();
  await expect(answer.locator(".grounding-sources a")).toHaveText("Google Cloud release notes");
  const suggestions=answer.locator("iframe.google-search-suggestions");await expect(suggestions).toBeVisible();await expect(suggestions.contentFrame().locator("#search-chip")).toHaveText("latest Gemini model");
});

test("new Vertex sessions default Google Search grounding to off",async({page})=>{
  await page.addInitScript(()=>{localStorage.setItem("claudex-ui-locale","ko");class SilentEventSource{onerror:null|(()=>void)=null;constructor(public url:string){}addEventListener(){}close(){}}Object.defineProperty(globalThis,"EventSource",{value:SilentEventSource,configurable:true});});
  const now=new Date().toISOString(),model={id:"gemini-3.6-flash",displayName:"Gemini 3.6 Flash",source:"runtime"},workspace={id:"workspace",projectId:"project",hostId:"local",displayName:"Workspace",canonicalPath:"/workspace"};let created:any=null;
  await page.route("**/api/**",async route=>{const pathname=new URL(route.request().url()).pathname,json=(value:unknown)=>route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(value)});
    if(pathname==="/api/tasks"&&route.request().method()==="POST"){created=route.request().postDataJSON();return json({task:{id:"antigravity:created",provider:"antigravity",nativeId:"created",threadId:"vertex:created",projectId:"project",title:"test",prompt:created.prompt,status:"running",createdAt:now,updatedAt:now,result:null,error:null,log:"",owned:true,executionHostId:"local",workspaceId:"workspace",requestedModel:model.id,metadata:{modelBackend:"vertex-api",googleSearchMode:created.googleSearchMode}}});}
    if(pathname==="/api/tasks")return json({tasks:[],partial:false,warnings:[]});
    if(pathname==="/api/location-options")return json({projects:[{id:"project",name:"Project",enabled:true,error:null}],workspaces:[workspace]});
    if(pathname==="/api/projects")return json({projects:[{id:"project",name:"Project",enabled:true,error:null}]});
    if(pathname==="/api/hosts")return json({hosts:[{id:"local",type:"local",displayName:"Local",platform:"linux",architecture:"x64",status:"online",lastSeenAt:now}]});
    if(pathname==="/api/workspaces")return json({workspaces:[workspace]});
    if(pathname==="/api/providers/antigravity/models")return json({models:[model],permissions:[],efforts:[{id:"default",displayName:"Default"}],health:{ok:true}});
    if(pathname==="/api/providers/codex/models")return json({catalog:{models:[],permissions:[]}});
    if(pathname==="/api/providers/claude/permissions")return json({models:[],permissions:[],efforts:[],catalog:{models:[],stale:false}});
    if(pathname==="/api/system-settings/antigravity-execution")return json({settings:{version:1,backend:"vertex",vertex:{projectId:"project",location:"global",credentialsPath:"/secret.json",creditsUrl:""}}});
    if(pathname==="/api/system-settings/models")return json({settings:{version:1,codex:{models:[]},claude:{models:[]},deepseek:{models:[]},ollama:{models:[]},antigravity:{models:[model]}},candidates:{codex:[],claude:[],deepseek:[],ollama:[],antigravity:[model]}});
    if(pathname==="/api/provider-connections")return json({accounts:[{provider:"antigravity",state:"connected",accountLabel:"Vertex",authenticated:true}],attempts:[]});
    if(pathname==="/api/provider-connections/attempts")return json({attempts:[]});
    if(pathname==="/api/collaborations")return json({collaborations:[]});
    if(pathname==="/api/quota")return json({antigravity:{quotaMode:"vertex-credit",projectId:"project",location:"global"},fetchedAt:now});
    if(pathname==="/api/emotion")return json({state:{},codexState:{},outfits:[],assets:[],mode:"catch"});
    if(pathname==="/api/push")return json({preferences:{},publicKey:""});
    if(pathname==="/api/setup")return json({required:false});
    return json({settings:null});
  });
  await page.goto("/",{waitUntil:"domcontentloaded"});await page.locator(".new-button").click();const dialog=page.getByRole("dialog",{name:"새 작업"});await dialog.getByRole("group",{name:"엔진",exact:true}).getByRole("button",{name:"Gemini",exact:true}).click();const search=dialog.getByRole("group",{name:"Google 검색 그라운딩"});await expect(search.locator("button").filter({hasText:"끔"})).toHaveClass(/active/);await dialog.getByLabel("요청",{exact:true}).fill("안녕하세요");await dialog.getByRole("button",{name:"지금 시작",exact:true}).click();await expect.poll(()=>created).not.toBeNull();expect(created.googleSearchMode).toBe("off");
});
