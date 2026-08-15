import {expect,test} from "@playwright/test";

test("keeps Claude classification on the latest turn and restores tabs after leaving Codex detail",async({page})=>{
  await page.addInitScript(()=>localStorage.setItem("claudex-ui-locale","ko"));
  const pageErrors:string[]=[];
  page.on("pageerror",error=>pageErrors.push(error.message));
  const old={id:"claude-old",provider:"claude",nativeId:"claude-old",threadId:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",projectId:"project",title:"Claude old completed",prompt:"old",status:"completed",createdAt:"2026-07-25T10:00:00.000Z",updatedAt:"2026-07-25T12:00:00.000Z",result:"done",error:null,log:"",owned:true,ownership:"claudex-workhouse",source:"claudex-workhouse",executionHostId:"local",workspaceId:"workspace",requestedModel:"claude-opus-5",requestedReasoningEffort:"medium",metadata:{}};
  const running={...old,id:"claude-running",nativeId:"claude-running",title:"Claude newest running",prompt:"new",status:"running",createdAt:"2026-07-25T11:00:00.000Z",updatedAt:"2026-07-25T11:01:00.000Z",result:null};
  const codex={...old,id:"codex-task",nativeId:"codex-task",provider:"codex",threadId:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",title:"Codex detail fixture",status:"completed",createdAt:"2026-07-25T09:00:00.000Z",updatedAt:"2026-07-25T09:01:00.000Z"};
  await page.route("**/api/**",async route=>{
    const url=new URL(route.request().url()),pathname=url.pathname,json=(value:unknown)=>route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(value)});
    if(pathname.endsWith("/events/stream"))return route.fulfill({status:200,contentType:"text/event-stream",body:": ready\n\n"});
    if(pathname==="/api/tasks"){const provider=url.searchParams.get("provider");return json({tasks:[old,running,codex].filter(item=>!provider||item.provider===provider),partial:false,warnings:[]});}
    if(pathname==="/api/tasks/claude/claude-running")return json({task:running});
    if(pathname.includes("/events"))return json({latestSequence:0,events:[]});
    if(pathname==="/api/codex/threads"){
      const session={threadId:codex.threadId,taskId:codex.id,projectId:codex.projectId,title:codex.title,preview:codex.prompt,source:"claudex-workhouse",ownership:"claudex-workhouse",status:"completed",updatedAt:codex.updatedAt,canMutate:true,canStop:false,workspaceId:"workspace",executionHostId:"local",requestedModel:"gpt-5.6-sol",requestedReasoningEffort:"medium",requestedServiceTier:"priority",metadata:{}};
      return json({sessions:[session,{...session,title:"Codex duplicate identity"}],nextCursor:null,stale:false,syncedAt:codex.updatedAt,capabilities:{delete:true}});
    }
    if(pathname.endsWith("/turns"))return json({turns:[],nextCursor:null});
    if(pathname==="/api/projects")return json({projects:[{id:"project",name:"Project",enabled:true,error:null}]});
    if(pathname==="/api/hosts")return json({hosts:[{id:"local",displayName:"Local",status:"online"}]});
    if(pathname==="/api/workspaces")return json({workspaces:[{id:"workspace",projectId:"project",hostId:"local",displayName:"Workspace",canonicalPath:"/workspace"}]});
    if(pathname==="/api/collaborations")return json({collaborations:[]});
    if(pathname==="/api/providers/codex/models")return json({catalog:{models:[],permissions:[]}});
    if(pathname==="/api/providers/claude/permissions")return json({models:[],permissions:[],efforts:[],catalog:{models:[],stale:false}});
    if(pathname==="/api/provider-connections"||pathname==="/api/provider-connections/attempts")return json({accounts:["codex","claude","grok","antigravity","deepseek","ollama"].map(provider=>({provider,state:"connected",accountType:null,planType:null,emailMasked:null,errorCategory:null,checkedAt:new Date().toISOString()})),attempts:[]});
    if(pathname==="/api/quota")return json({claude:{},codex:{},fetchedAt:new Date().toISOString()});
    if(pathname==="/api/emotion")return json({state:{},codexState:{},outfits:[],assets:[],mode:"catch"});
    if(pathname==="/api/push")return json({preferences:{},publicKey:""});
    if(pathname.startsWith("/api/system-settings/"))return json({settings:null,candidates:{claude:[],codex:[]}});
    return json({});
  });

  await page.goto("/");
  await page.getByRole("navigation",{name:"주요 화면"}).getByRole("button",{name:"세션",exact:true}).click();
  await expect(page.getByRole("navigation",{name:"엔진 필터"})).toBeVisible();
  const claudeCard=page.getByRole("button",{name:/Claude newest running/});
  await expect(claudeCard).toBeVisible();
  const taskList=page.locator(".task-list.session-browser-list");
  await expect(taskList).toBeVisible();
  await expect.poll(()=>taskList.evaluate(element=>{
    const style=getComputedStyle(element);
    return `${style.rowGap}|${style.paddingTop}`;
  })).toBe("16px|18px");
  await expect.poll(()=>claudeCard.evaluate(element=>Math.round(element.getBoundingClientRect().height))).toBeGreaterThanOrEqual(112);
  await expect.poll(()=>claudeCard.locator(".meta").evaluate(element=>getComputedStyle(element).flexWrap)).toBe("nowrap");
  await expect(claudeCard.locator(".session-model-chip.model")).toHaveText("claude-opus-5");
  await expect(claudeCard.locator(".session-model-badges")).toContainText("중간");
  await page.locator(".filters.sub button").filter({hasText:"완료"}).click();
  await expect(page.getByRole("button",{name:/Claude old completed/})).toHaveCount(0);
  await page.locator(".filters.sub button").filter({hasText:"전체"}).click();

  await page.locator(".filters").first().getByRole("button",{name:"Codex",exact:true}).click();
  const codexCard=page.getByRole("button",{name:/Codex detail fixture/});
  const codexList=page.locator(".session-list.session-browser-list");
  await expect(codexList).toBeVisible();
  await expect.poll(()=>codexList.evaluate(element=>{
    const style=getComputedStyle(element);
    return `${style.rowGap}|${style.paddingTop}`;
  })).toBe("16px|18px");
  await expect.poll(()=>codexCard.evaluate(element=>Math.round(element.getBoundingClientRect().height))).toBeGreaterThanOrEqual(112);
  await expect(codexCard.locator(".host-badge")).toHaveText("Local");
  await expect(codexCard.locator(".host-badge")).not.toHaveText("local");
  await expect.poll(()=>codexCard.locator(".meta").evaluate(element=>getComputedStyle(element).flexWrap)).toBe("nowrap");
  await expect(codexCard.locator(".session-model-badges")).toContainText("gpt-5.6-sol");
  await expect(codexCard.locator(".session-model-badges")).toContainText("빠르게");
  await codexCard.click();
  if((page.viewportSize()?.width??0)<=599)await expect(page.locator(".task-heading")).toHaveClass(/collapsed/);
  else await expect(page.locator(".task-heading")).not.toHaveClass(/collapsed/);
  await page.locator(".agent-avatar-slot.claude .avatar-mini").click();
  await page.locator(".agent-avatar-slot.claude .recent-session-list.active-list button").click();
  await page.locator(".brand-back").click();
  await expect(page.getByRole("navigation",{name:"엔진 필터"})).toBeVisible();
  await expect(page.locator(".filters").first().getByRole("button",{name:"Claude",exact:true})).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test("keeps the Claude conversation at the latest output when completion restores older history",async({page})=>{
  test.setTimeout(45_000);
  await page.addInitScript(()=>{
    localStorage.setItem("claudex-ui-locale","ko");
    localStorage.removeItem("deck-show-running-history");
    class MockEventSource{
      listeners:Record<string,Array<(event:any)=>void>>={};
      onerror:((event:any)=>void)|null=null;
      constructor(public url:string){
        setTimeout(()=>this.emit("open",{}),20);
        if(!url.includes("/api/tasks/claude/claude-current/events/stream"))return;
        setTimeout(()=>{
          for(let index=1;index<=24;index++)this.emit("agent-event",{data:JSON.stringify({type:"message_completed",content:`현재 작업 진행 출력 ${index}`,provider:"claude",itemId:`process-${index}`,eventId:`live:${index}`,sequence:index,metadata:{role:"agent",phase:"commentary"}})});
          this.emit("agent-event",{data:JSON.stringify({type:"message_completed",content:"Claude 최신 최종 출력",provider:"claude",eventId:"live:25",sequence:25,metadata:{role:"agent",phase:"final_answer"}})});
        },120);
        (globalThis as any).__finishClaudeSession=()=>this.emit("agent-event",{data:JSON.stringify({type:"task_completed",content:"completed",provider:"claude",eventId:"live:26",sequence:26,terminal:true})});
      }
      addEventListener(type:string,listener:(event:any)=>void){(this.listeners[type]??=[]).push(listener);}
      emit(type:string,event:any){for(const listener of this.listeners[type]??[])listener(event);}
      close(){}
    }
    (globalThis as any).EventSource=MockEventSource;
  });
  const now=new Date().toISOString(),threadId="cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const old={id:"claude-old-turn",provider:"claude",nativeId:"claude-old-turn",threadId,projectId:"project",title:"Claude scroll regression",prompt:"이전 요청",status:"completed",createdAt:"2026-07-25T10:00:00.000Z",updatedAt:"2026-07-25T10:01:00.000Z",result:"old",error:null,log:"",owned:true,ownership:"claudex-workhouse",source:"claudex-workhouse",executionHostId:"local",workspaceId:"workspace",metadata:{}};
  const oldTurns=Array.from({length:57},(_,index)=>({...old,id:`claude-old-turn-${index+1}`,nativeId:`claude-old-turn-${index+1}`,prompt:`이전 요청 ${index+1}`}));
  const current={...old,id:"claude-current",nativeId:"claude-current",prompt:"현재 요청",status:"running",createdAt:"2026-07-25T11:00:00.000Z",updatedAt:now,result:null};
  const oldEvents=Array.from({length:30},(_,index)=>({type:"message_completed",content:`복원되는 이전 히스토리 ${index+1}`,metadata:{role:"agent",phase:"final_answer"},itemId:`old-${index+1}`}));
  let currentEventReads=0,oldEventReads=0;
  await page.route("**/api/**",async route=>{
    const url=new URL(route.request().url()),pathname=url.pathname,json=(value:unknown)=>route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(value)});
    if(pathname==="/api/tasks")return json({tasks:[...oldTurns,current],partial:false,warnings:[]});
    if(pathname==="/api/tasks/claude/claude-current")return json({task:{...current,status:"completed"}});
    if(/^\/api\/tasks\/claude\/claude-old-turn-\d+\/events$/.test(pathname)){oldEventReads++;return json({latestSequence:0,events:oldEvents});}
    if(pathname==="/api/tasks/claude/claude-current/events"){
      currentEventReads++;
      return json({latestSequence:currentEventReads===1?0:26,events:currentEventReads===1?[]:[
        {type:"message",content:"이전 요청",metadata:{role:"user"}},
        ...oldEvents,
        {type:"message",content:"현재 요청",metadata:{role:"user"}},
        {type:"message_completed",content:"Claude 최신 최종 출력",metadata:{role:"agent",phase:"final_answer"}},
      ]});
    }
    if(pathname==="/api/tasks/claude/claude-current/message-queue")return json({items:[],activeTask:null});
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

  await page.goto("/?task=claude-current");
  if((page.viewportSize()?.width??0)<=599)await expect(page.locator(".task-heading")).toHaveClass(/collapsed/);
  else await expect(page.locator(".task-heading")).not.toHaveClass(/collapsed/);
  const finalOutput=page.getByText("Claude 최신 최종 출력",{exact:true});
  await expect(finalOutput).toBeVisible({timeout:10_000});
  await expect(finalOutput).toBeInViewport();
  const conversation=page.locator(".conversation");
  const historyControl=page.locator(".running-history-control");
  if((page.viewportSize()?.width??0)>599){
    await expect(historyControl).toHaveCount(1);
    await expect(historyControl).not.toBeInViewport();
    await conversation.evaluate(element=>{element.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true}));element.scrollTop=0;element.dispatchEvent(new Event("scroll"));});
    await expect(page.locator(".task-heading")).not.toHaveClass(/collapsed/);
    await expect(historyControl).toBeInViewport();
  }
  await conversation.evaluate(element=>{element.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true}));element.scrollTop=element.scrollHeight;element.dispatchEvent(new Event("scroll"));});
  await expect(historyControl).toHaveCount(1);
  await expect(historyControl).not.toBeInViewport();
  await conversation.evaluate(element=>{element.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true}));element.scrollTop=0;element.dispatchEvent(new Event("scroll"));});
  await expect(historyControl).toBeInViewport();
  await conversation.evaluate(element=>{element.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true}));element.scrollTop=element.scrollHeight;element.dispatchEvent(new Event("scroll"));});
  await expect(historyControl).not.toBeInViewport();
  const viewportWidth=page.viewportSize()?.width??0;
  const processDrawer=page.locator(".work-status-drawer").last();
  const processToggle=processDrawer.locator(".work-status-badge");
  const readingAnchor=page.getByText("현재 작업 진행 출력 12",{exact:true});
  let readingAnchorTop:number|null=null;
  if(viewportWidth===412){
    await expect(processDrawer).not.toHaveClass(/open/);
    await processToggle.evaluate((element:HTMLButtonElement)=>element.click());
    await expect(processDrawer).toHaveClass(/open/);
    await processToggle.evaluate((element:HTMLButtonElement)=>element.click());
    await expect(processDrawer).not.toHaveClass(/open/);
  }else if(viewportWidth>599){
    await conversation.evaluate(element=>element.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true})));
    await readingAnchor.evaluate(element=>element.scrollIntoView({block:"center"}));
    await conversation.evaluate(element=>element.dispatchEvent(new Event("scroll")));
    readingAnchorTop=(await readingAnchor.boundingBox())?.y??null;
    expect(readingAnchorTop).not.toBeNull();
  }
  await page.evaluate(()=>(globalThis as any).__finishClaudeSession());
  await expect(historyControl).toHaveCount(0,{timeout:10_000});
  await expect.poll(()=>currentEventReads,{timeout:10_000}).toBeGreaterThanOrEqual(2);
  expect(oldEventReads).toBe(0);
  if(viewportWidth===412){
    await expect(processDrawer).not.toHaveClass(/open/);
    await processToggle.evaluate((element:HTMLButtonElement)=>element.click());
    await expect(processDrawer).toHaveClass(/open/);
    await conversation.evaluate(element=>{element.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true}));element.scrollTop=element.scrollHeight;element.dispatchEvent(new Event("scroll"));});
  }else if(viewportWidth>599){
    await expect.poll(async()=>{
      const restoredAnchorTop=(await readingAnchor.boundingBox())?.y??null;
      return restoredAnchorTop===null?Number.POSITIVE_INFINITY:Math.abs(restoredAnchorTop-readingAnchorTop!);
    }).toBeLessThanOrEqual(4);
  }
  const position=await conversation.evaluate(element=>({top:element.scrollTop,max:element.scrollHeight-element.clientHeight}));
  expect(position.top).toBeGreaterThan(100);
  if(viewportWidth<=599)expect(position.max-position.top).toBeLessThanOrEqual(60);
  await expect(finalOutput).toHaveCount(1);
  await expect(finalOutput).toBeVisible();
});
