import{expect,test}from"@playwright/test";

test("recovers a failed selected attempt to the active writer in the same Codex thread",async({page})=>{
  await page.addInitScript(()=>{
    localStorage.setItem("claudex-ui-locale","ko");
    class SilentEventSource{onerror:null|(()=>void)=null;constructor(public url:string){}addEventListener(){}close(){}}
    Object.defineProperty(globalThis,"EventSource",{value:SilentEventSource,configurable:true});
  });
  let followupRequested=false; let activeVisible=false; let activeEventsLoaded=false;
  const now=new Date().toISOString(),threadId="33333333-3333-4333-8333-333333333333";
  const previous={id:"codex-followup-old",provider:"codex",nativeId:"codex-followup-old",threadId,projectId:"claudex-workhouse",title:"Codex follow-up output card",prompt:"첫 요청",status:"failed",createdAt:now,updatedAt:now,result:"다음 입력 뒤에도 남아야 하는 직전 최종 출력",error:null,log:"",owned:true,ownership:"claudex-workhouse",source:"claudex-workhouse",executionHostId:"local",workspaceId:"workspace-test",permissionProfile:":workspace",metadata:{automationLevel:"auto"}};
  const next={...previous,id:"codex-followup-new",nativeId:"codex-followup-new",prompt:"두 번째 요청",status:"running",result:null,createdAt:new Date(Date.now()+1000).toISOString(),updatedAt:new Date(Date.now()+1000).toISOString()};
  const session={threadId,taskId:previous.id,projectId:previous.projectId,title:previous.title,preview:previous.prompt,source:previous.source,ownership:previous.ownership,status:previous.status,updatedAt:previous.updatedAt,canMutate:true,canStop:false,workspaceId:previous.workspaceId,executionHostId:"local",permissionProfile:previous.permissionProfile,metadata:previous.metadata};
  const previousEvents=[
    {type:"message",content:previous.prompt,turnId:"turn-old",itemId:"user-old",metadata:{role:"user"}},
    {type:"message_completed",content:previous.result,turnId:"turn-old",itemId:"answer-old",metadata:{role:"agent",phase:"final_answer"}}
  ];
  await page.route("**/api/**",async route=>{
    const pathname=new URL(route.request().url()).pathname,json=(value:unknown)=>route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(value)});
    if(pathname===`/api/codex/threads/${threadId}/messages`){followupRequested=true;await new Promise(resolve=>setTimeout(resolve,3200));return json({task:next});}
    if(pathname==="/api/tasks/codex/codex-followup-old/events")return json({taskId:previous.id,status:"completed",latestSequence:2,events:previousEvents});
    if(pathname==="/api/tasks/codex/codex-followup-new/events"){activeEventsLoaded=true;return json({taskId:next.id,status:"running",latestSequence:1,events:[{type:"message_completed",content:"실제 실행 중인 작업의 최신 응답",taskId:next.id,sequence:1,eventId:"active:1",metadata:{role:"agent",phase:"commentary"}}]});}
    if(pathname==="/api/tasks/codex/codex-followup-old")return json({task:previous});
    if(pathname==="/api/tasks/codex/codex-followup-new")return json({task:next});
    if(pathname==="/api/tasks")return json({tasks:[previous],partial:false,warnings:[]});
    if(pathname==="/api/codex/threads")return json({sessions:[activeVisible?{...session,taskId:next.id,status:"running",canStop:true}:session],nextCursor:null,stale:false,syncedAt:now,capabilities:{delete:true}});
    if(pathname===`/api/codex/threads/${threadId}/turns`)return json({turns:[],nextCursor:null});
    if(pathname.includes("/message-queue"))return json({items:[],activeTask:followupRequested?next:null});
    if(pathname==="/api/projects")return json({projects:[{id:"claudex-workhouse",name:"Claudex Workhouse",enabled:true}]});
    if(pathname==="/api/hosts")return json({hosts:[{id:"local",displayName:"Local",status:"online"}]});
    if(pathname==="/api/workspaces")return json({workspaces:[{id:"workspace-test",projectId:"claudex-workhouse",hostId:"local",displayName:"Claudex Workhouse",canonicalPath:"/srv/claudex-workhouse"}]});
    if(pathname==="/api/collaborations")return json({collaborations:[]});
    if(pathname==="/api/providers/codex/models")return json({catalog:{models:[],permissions:[]}});
    if(pathname==="/api/system-settings/ui-locale")return json({locale:"ko"});
    if(pathname==="/api/system-settings/credit-usage")return json({settings:{version:1,allowPaidCredits:false}});
    if(pathname==="/api/system-settings/models")return json({settings:null,candidates:{claude:[],codex:[]}});
    if(pathname==="/api/provider-connections"||pathname==="/api/provider-connections/attempts")return json({accounts:[],attempts:[]});
    if(pathname==="/api/quota")return json({claude:{},codex:{},fetchedAt:now});
    if(pathname==="/api/emotion")return json({state:{},codexState:{},outfits:[],assets:[],mode:"catch"});
    if(pathname==="/api/push")return json({preferences:{},publicKey:""});
    return json({});
  });

  await page.goto("/?task=codex-followup-old");
  await expect(page.locator(".composer textarea")).toBeVisible();
  activeVisible=true;
  await expect.poll(()=>activeEventsLoaded,{timeout:20000}).toBe(true);
  await expect(page.getByText("실제 실행 중인 작업의 최신 응답",{exact:true})).toBeVisible();
});
