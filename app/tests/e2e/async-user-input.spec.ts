import {expect,test} from "@playwright/test";

for(const scenario of ["codex","claude","deepseek","ollama","antigravity","grok","codex-completed"]){
const late=scenario==="codex-completed",provider=late?"codex":scenario;
test(`${scenario} async choice card submits selected and free-text answers`,async({page})=>{
  await page.addInitScript(()=>{
    localStorage.setItem("claudex-ui-locale","ko");
    class QuietEventSource{onerror:null|(()=>void)=null;constructor(_url:string){setTimeout(()=>this.dispatch("open"),0);}listeners=new Map<string,Array<(event:any)=>void>>();addEventListener(type:string,listener:(event:any)=>void){this.listeners.set(type,[...(this.listeners.get(type)??[]),listener]);}dispatch(type:string){for(const listener of this.listeners.get(type)??[])listener({});}close(){}}
    (globalThis as any).EventSource=QuietEventSource;
  });
  const now=new Date().toISOString(),taskId=`${provider}:push-question`,threadId="11111111-1111-4111-8111-111111111111",workspace={id:"workspace",projectId:"project",hostId:"local",displayName:"Workspace",canonicalPath:"/workspace"};
  const task={id:taskId,provider,nativeId:"push-question",threadId,projectId:"project",title:"Push question fixture",prompt:"Need a choice",status:"running",createdAt:now,updatedAt:now,result:null,error:null,log:"",owned:true,ownership:"claudex-workhouse",source:"claudex-workhouse",executionHostId:"local",workspaceId:"workspace",metadata:{}};
  const session={threadId,taskId,projectId:"project",title:task.title,preview:task.prompt,source:"claudex-workhouse",ownership:"claudex-workhouse",status:"running",archived:false,canMutate:true,canStop:true,executionHostId:"local",workspaceId:"workspace",updatedAt:now,metadata:{}};
  let questionsSubmitted:Record<string,{answers:string[]}>|null=null;
  let userInputRequests=[{id:"44444444-4444-4444-8444-444444444444",taskId,provider,delivery:"async",questions:[
    {id:"choice",header:"Continue?",question:"Which path should the task use?",options:[{label:"Safe",description:"Use the safe path"}],isOther:true,isSecret:false},
    {id:"runtime",header:"Runtime",question:"Which runtime should continue?",options:[{label:"Local",description:"Use the local runtime"}],isOther:true,isSecret:false}
  ],expiresAt:new Date(Date.now()+5*60_000).toISOString(),title:task.title}];
  await page.route("**/api/**",async route=>{
    const url=new URL(route.request().url()),pathname=url.pathname,json=(value:unknown)=>route.fulfill({contentType:"application/json",body:JSON.stringify(value)});
    if(pathname==="/api/tasks")return json({tasks:[task],partial:false,warnings:[]});
    if(pathname==="/api/codex/threads")return json({sessions:[session],nextCursor:null,stale:false,syncedAt:now,capabilities:{search:true,turns:true,settings:true,delete:true}});
    if(/^\/api\/codex\/threads\/[^/]+\/turns$/.test(pathname))return json({turns:[],nextCursor:null});
    if(/^\/api\/tasks\/codex\/[^/]+\/events$/.test(pathname))return json({events:[],latestSequence:0,status:"running"});
    if(pathname==="/api/approvals")return json({approvals:[],capabilities:{codex:true,claude:false},checkedAt:now});
    if(pathname==="/api/user-input")return json({requests:userInputRequests,capabilities:{codex:true,claude:false},checkedAt:now});
    if(/^\/api\/tasks\/[^/]+\/[^/]+\/user-input\/[0-9a-f-]+$/.test(pathname)){
      questionsSubmitted=(route.request().postDataJSON() as {answers:Record<string,{answers:string[]}>}).answers;userInputRequests=[];return json({accepted:true});
    }
    if(pathname==="/api/projects")return json({projects:[{id:"project",name:"Project",enabled:true,error:null}]});
    if(pathname==="/api/workspaces")return json({workspaces:[workspace]});
    if(pathname==="/api/hosts")return json({hosts:[{id:"local",type:"local",displayName:"Local",status:"online",capabilities:{}}]});
    if(pathname==="/api/providers/codex/models")return json({catalog:{models:[],permissions:[]}});
    if(pathname==="/api/providers/claude/permissions")return json({permissions:[],models:[],efforts:[],catalog:{models:[]}});
    if(pathname==="/api/collaborations")return json({collaborations:[]});
    if(pathname==="/api/provider-connections"||pathname==="/api/provider-connections/attempts")return json({singleUser:true,accounts:[],attempts:[]});
    if(pathname==="/api/quota")return json({claude:{},codex:{}});
    if(pathname==="/api/emotion")return json({state:null,codexState:null,outfits:[]});
    if(pathname.startsWith("/api/system-settings/"))return json({settings:null,candidates:{claude:[],codex:[]}});
    return json({});
  });

  const completionQuestions=userInputRequests;if(late)userInputRequests=[];
  await page.goto(`/?task=${encodeURIComponent(taskId)}&provider=${provider}&view=session`);
  const card=page.locator(".user-input-stack").first();
  if(late){await expect(page.locator(".codex-detail")).toContainText(task.title);await expect(card).toHaveCount(0);task.status="completed";session.status="completed";userInputRequests=completionQuestions;}
  await expect(card).toContainText("Which path should the task use?",{timeout:15000});
  await expect(page.locator(".bottom-chrome-drawer > .user-input-stack + .composer")).toBeVisible();
  const cardBox=await card.boundingBox(),composerBox=await page.locator(".composer").last().boundingBox();
  expect(cardBox).not.toBeNull();expect(composerBox).not.toBeNull();
  expect(cardBox!.y+cardBox!.height).toBeLessThanOrEqual(composerBox!.y+1);
  expect(composerBox!.y+composerBox!.height).toBeLessThanOrEqual(page.viewportSize()!.height+1);
  await card.locator(".user-input-head").click();
  await expect(card.locator("fieldset")).toHaveCount(0);
  await card.locator(".user-input-head").click();
  await expect(card.getByRole("button",{name:"다음 질문"})).toBeDisabled();
  await card.getByText("Safe",{exact:true}).click();
  await card.getByRole("button",{name:"다음 질문"}).click();
  await expect(card).toContainText("Which runtime should continue?");
  await expect(card).not.toContainText("Which path should the task use?");
  await card.getByText("직접 입력",{exact:true}).click();
  await card.locator('.other input[type="text"]').fill("My runtime");
  await expect(card.locator('.other input[type="radio"]')).toBeChecked();
  await card.getByRole("button",{name:"선택 제출"}).click();
  await expect.poll(()=>questionsSubmitted).toEqual({choice:{answers:["Safe"]},runtime:{answers:["My runtime"]}});
  await expect(card).toHaveCount(0);
});
}
