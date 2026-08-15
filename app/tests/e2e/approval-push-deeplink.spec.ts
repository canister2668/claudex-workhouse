import {expect,test} from "@playwright/test";

test("user-input Push deep link opens the local Codex question UI and approval buttons submit every decision",async({page})=>{
  await page.addInitScript(()=>{
    localStorage.setItem("claudex-ui-locale","ko");
    class QuietEventSource{onerror:null|(()=>void)=null;constructor(_url:string){setTimeout(()=>this.dispatch("open"),0);}listeners=new Map<string,Array<(event:any)=>void>>();addEventListener(type:string,listener:(event:any)=>void){this.listeners.set(type,[...(this.listeners.get(type)??[]),listener]);}dispatch(type:string){for(const listener of this.listeners.get(type)??[])listener({});}close(){}}
    (globalThis as any).EventSource=QuietEventSource;
  });
  const now=new Date().toISOString(),taskId="codex:push-question",threadId="11111111-1111-4111-8111-111111111111",workspace={id:"workspace",projectId:"project",hostId:"local",displayName:"Workspace",canonicalPath:"/workspace"};
  const task={id:taskId,provider:"codex",nativeId:"push-question",threadId,projectId:"project",title:"Push question fixture",prompt:"Need a choice",status:"waiting",createdAt:now,updatedAt:now,result:null,error:null,log:"",owned:true,ownership:"claudex-workhouse",source:"claudex-workhouse",executionHostId:"local",workspaceId:"workspace",metadata:{}};
  const session={threadId,taskId,projectId:"project",title:task.title,preview:task.prompt,source:"claudex-workhouse",ownership:"claudex-workhouse",status:"waiting",archived:false,canMutate:true,canStop:true,executionHostId:"local",workspaceId:"workspace",updatedAt:now,metadata:{}};
  let approvals=["accept","acceptForSession","decline"].map((decision,index)=>({id:`${index+1}aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`,provider:"codex",taskId,hostId:"local",workspaceId:"workspace",kind:"command",summary:`${decision} fixture`,command:"git status",paths:[],access:["execute"],risk:"medium",availableDecisions:["accept","acceptForSession","decline"],requestedAt:now,expiresAt:new Date(Date.now()+5*60_000).toISOString(),title:task.title}));
  const decisions:string[]=[];
  let questionsSubmitted:Record<string,{answers:string[]}>|null=null;
  let userInputRequests=[{id:"44444444-4444-4444-8444-444444444444",taskId,questions:[
    {id:"choice",header:"Continue?",question:"Which path should the task use?",options:[{label:"Safe",description:"Use the safe path"}],isOther:true,isSecret:false},
    {id:"runtime",header:"Runtime",question:"Which runtime should continue?",options:[{label:"Local",description:"Use the local runtime"}],isOther:true,isSecret:false}
  ],expiresAt:new Date(Date.now()+5*60_000).toISOString(),title:task.title}];
  await page.route("**/api/**",async route=>{
    const url=new URL(route.request().url()),pathname=url.pathname,json=(value:unknown)=>route.fulfill({contentType:"application/json",body:JSON.stringify(value)});
    if(pathname==="/api/tasks")return json({tasks:[task],partial:false,warnings:[]});
    if(pathname==="/api/codex/threads")return json({sessions:[session],nextCursor:null,stale:false,syncedAt:now,capabilities:{search:true,turns:true,settings:true,delete:true}});
    if(/^\/api\/codex\/threads\/[^/]+\/turns$/.test(pathname))return json({turns:[],nextCursor:null});
    if(/^\/api\/tasks\/codex\/[^/]+\/events$/.test(pathname))return json({events:[],latestSequence:0,status:"waiting"});
    if(pathname==="/api/approvals"){
      if(route.request().method()!=="GET")return json({});
      return json({approvals,capabilities:{codex:true,claude:false},checkedAt:now});
    }
    if(/^\/api\/tasks\/codex\/[^/]+\/approvals\/[0-9a-f-]+$/.test(pathname)){
      const body=route.request().postDataJSON() as {decision:string};decisions.push(body.decision);const approvalId=decodeURIComponent(pathname.split("/").at(-1)!);approvals=approvals.filter(item=>item.id!==approvalId);return json({resolved:true,approvalId,decision:body.decision});
    }
    if(pathname==="/api/user-input")return json({requests:userInputRequests,capabilities:{codex:true,claude:false},checkedAt:now});
    if(/^\/api\/tasks\/codex\/[^/]+\/user-input\/[0-9a-f-]+$/.test(pathname)){
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

  await page.goto(`/?task=${encodeURIComponent(taskId)}&provider=codex&event=event-question&view=session`);
  await expect(page.locator(".codex-detail")).toContainText(task.title);
  await expect(page.locator(".user-input-stack")).toContainText("Which path should the task use?");
  await expect(page.locator(".user-input-stack")).not.toContainText("Which runtime should continue?");
  const choiceCard=page.locator(".user-input-stack article");
  const fold=choiceCard.locator(".user-input-head");
  await expect(fold).toHaveAttribute("aria-expanded","true");
  await fold.click();
  await expect(fold).toHaveAttribute("aria-expanded","false");
  await expect(choiceCard).not.toContainText("Which path should the task use?");
  await fold.click();
  await choiceCard.getByText("직접 입력",{exact:true}).click();
  const manual=choiceCard.locator('.other input[type="text"]');
  await expect(manual).toBeVisible();
  await manual.fill("Keep compatibility");
  await choiceCard.getByRole("button",{name:"다음 질문"}).click();
  await expect(choiceCard).toContainText("Which runtime should continue?");
  await expect(choiceCard).not.toContainText("Which path should the task use?");
  await choiceCard.getByText("Local",{exact:true}).click();
  await choiceCard.getByRole("button",{name:"이전"}).click();
  await expect(manual).toHaveValue("Keep compatibility");
  await choiceCard.getByRole("button",{name:"다음 질문"}).click();
  await choiceCard.getByRole("button",{name:"선택 제출"}).click();
  await expect.poll(()=>questionsSubmitted).toEqual({choice:{answers:["Keep compatibility"]},runtime:{answers:["Local"]}});
  await expect(page.locator(".user-input-stack")).toHaveCount(0);
  await expect(page).toHaveURL(/\/$/);

  await page.locator(".approval-stack article").filter({hasText:"accept fixture"}).getByRole("button",{name:"한 번 허용"}).click();
  await page.locator(".approval-stack article").filter({hasText:"acceptForSession fixture"}).getByRole("button",{name:"이 세션 동안"}).click();
  await page.locator(".approval-stack article").filter({hasText:"decline fixture"}).getByRole("button",{name:"거절"}).click();
  await expect.poll(()=>decisions).toEqual(["accept","acceptForSession","decline"]);
});
