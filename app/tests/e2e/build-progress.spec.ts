import{expect,test}from"@playwright/test";

test("shows a Claude build with expandable logs and collapses it into the build history when it finishes",async({page})=>{
  await page.addInitScript(()=>{
    localStorage.setItem("claudex-ui-locale","ko");
    class MockEventSource{
      listeners:Record<string,Array<(event:any)=>void>>={};
      onerror:((event:any)=>void)|null=null;
      constructor(public url:string){
        setTimeout(()=>this.emit("open",{}),20);
        if(!url.includes("/api/tasks/claude/build-task/events/stream"))return;
        setTimeout(()=>this.emit("agent-event",{data:JSON.stringify({
          type:"command_output",content:"transforming...\n3955 modules transformed.",
          provider:"claude",itemId:"build-tool",eventId:"build:2",sequence:2,
        })}),100);
        setTimeout(()=>this.emit("agent-event",{data:JSON.stringify({
          type:"tool_completed",content:"✓ built in 4.2s",provider:"claude",
          itemId:"build-tool",eventId:"build:3",sequence:3,
          metadata:{isError:false,durationMs:4200},
        })}),1800);
      }
      addEventListener(type:string,listener:(event:any)=>void){(this.listeners[type]??=[]).push(listener);}
      emit(type:string,event:any){for(const listener of this.listeners[type]??[])listener(event);}
      close(){}
    }
    (globalThis as any).EventSource=MockEventSource;
  });

  const now=new Date().toISOString();
  const task={
    id:"build-task",provider:"claude",nativeId:"build-task",
    threadId:"dddddddd-dddd-4ddd-8ddd-dddddddddddd",projectId:"project",
    title:"Claude build progress",prompt:"프로덕션 빌드해줘",status:"running",
    createdAt:now,updatedAt:now,result:null,error:null,log:"",
    owned:true,ownership:"claudex-workhouse",source:"claudex-workhouse",
    executionHostId:"local",workspaceId:"workspace",metadata:{},
  };
  await page.route("**/api/**",async route=>{
    const url=new URL(route.request().url()),pathname=url.pathname;
    const json=(value:unknown)=>route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(value)});
    if(pathname==="/api/tasks")return json({tasks:[task],partial:false,warnings:[]});
    if(pathname==="/api/tasks/claude/build-task")return json({task});
    if(pathname==="/api/tasks/claude/build-task/events")return json({latestSequence:1,events:[
      {type:"message",content:task.prompt,itemId:"user-1",sequence:0,metadata:{role:"user"}},
      {type:"command_started",content:"pnpm run build",provider:"claude",itemId:"build-tool",eventId:"build:1",sequence:1,timestamp:now,metadata:{description:"Build app"}},
    ]});
    if(pathname==="/api/tasks/claude/build-task/message-queue")return json({items:[],activeTask:null});
    if(pathname==="/api/projects")return json({projects:[{id:"project",name:"Project",enabled:true,error:null}]});
    if(pathname==="/api/hosts")return json({hosts:[{id:"local",displayName:"Local",status:"online"}]});
    if(pathname==="/api/workspaces")return json({workspaces:[{id:"workspace",projectId:"project",hostId:"local",displayName:"Workspace",canonicalPath:"/workspace"}]});
    if(pathname==="/api/collaborations")return json({collaborations:[]});
    if(pathname==="/api/providers/codex/models")return json({catalog:{models:[],permissions:[]}});
    if(pathname==="/api/providers/claude/permissions")return json({models:[],permissions:[],efforts:[],catalog:{models:[],stale:false}});
    if(pathname==="/api/provider-connections"||pathname==="/api/provider-connections/attempts")return json({accounts:["codex","claude","grok","antigravity","deepseek","ollama"].map(provider=>({provider,state:"connected",accountType:null,planType:null,emailMasked:null,errorCategory:null,checkedAt:new Date().toISOString()})),attempts:[]});
    if(pathname==="/api/quota")return json({claude:{},codex:{},fetchedAt:now});
    if(pathname==="/api/emotion")return json({state:{},codexState:{},outfits:[],assets:[],mode:"catch"});
    if(pathname==="/api/push")return json({preferences:{},publicKey:""});
    if(pathname.startsWith("/api/system-settings/"))return json({settings:null,candidates:{claude:[],codex:[]}});
    return json({});
  });

  await page.goto("/?task=build-task");
  await page.locator(".work-status-badge").click();
  const card=page.locator(".build-progress");
  await expect(card).toHaveAttribute("data-build-status","running");
  await expect(card).toContainText("빌드 중");
  await expect(card).toContainText("3955 modules transformed.");
  await card.locator("summary").click();
  await expect(card.locator("pre")).toContainText("$ pnpm run build");
  await expect(card.locator("pre")).toContainText("3955 modules transformed.");
  // A finished build leaves the live card and collapses into the build history,
  // so the panel keeps one row per run instead of a stack of completed cards.
  const history=page.locator(".build-history-row");
  await expect(history).toHaveCount(1);
  await expect(history).toHaveClass(/completed/);
  await expect(history.locator("code")).toHaveText("pnpm run build");
  await expect(history.locator("small")).toHaveText("4초");
  await expect(card).toHaveCount(0);
  await expect(page.locator(".event-group").filter({hasText:"pnpm run build"})).toHaveCount(0);
});
