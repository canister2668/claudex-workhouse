import { expect, test } from "@playwright/test";

test("keeps the final live output when a terminal Codex snapshot is stale",async({page},testInfo)=>{
  let eventReads=0;
  const now=new Date().toISOString(),threadId="11111111-1111-4111-8111-111111111111";
  const task={id:"task-live",provider:"codex",nativeId:"task-live",threadId,projectId:"claudex-workhouse",title:"Final output race reproduction",prompt:"재현 요청",status:"running",createdAt:now,updatedAt:now,result:null,error:null,log:"",owned:true,ownership:"claudex-workhouse",source:"claudex-workhouse",executionHostId:"local",workspaceId:"workspace-test",permissionProfile:":workspace",metadata:{automationLevel:"auto"}};
  const session={threadId,taskId:task.id,projectId:task.projectId,title:task.title,preview:task.prompt,source:"claudex-workhouse",ownership:"claudex-workhouse",status:"running",updatedAt:now,canMutate:true,canStop:true,workspaceId:task.workspaceId,executionHostId:"local",metadata:{automationLevel:"auto"}};
  await page.route("**/api/**",async route=>{
    const pathname=new URL(route.request().url()).pathname,json=(value:unknown)=>route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(value)});
    if(pathname.endsWith("/events/stream")){
      const processEvents=Array.from({length:28},(_,index)=>({type:"message_completed",content:`스크롤 위치 재현을 위한 긴 진행 설명 ${index+1}`,provider:"codex",turnId:"turn-1",itemId:`process-${index+1}`,sequence:index+2,eventId:`stream:${index+2}`,metadata:{role:"agent",phase:"commentary"}}));
      const commentary={type:"message_completed",content:"최종 결과 아래에 나오면 안 되는 작업 과정",provider:"codex",turnId:"turn-1",itemId:"commentary-1",sequence:30,eventId:"stream:30",metadata:{role:"agent",phase:"commentary"}};
      // The accumulated live draft and the completed history item can carry
      // different native IDs for the same answer. Keep this fixture dirty so
      // the open-session UI must normalize it without relying on re-entry.
      const liveFinalDraft={type:"message_delta",content:"브라우저에서 반드시 남아야 하는 최종 출력",provider:"codex",threadId,turnId:"turn-1",itemId:"msg-live-answer-1",sequence:31,eventId:"stream:31"};
      const finalEvent={type:"message_completed",content:"브라우저에서 반드시 남아야 하는 최종 출력",provider:"codex",turnId:"turn-1",itemId:"item-history-answer-1",sequence:32,eventId:"stream:32",metadata:{role:"agent",phase:"final_answer"}};
      const body=[...processEvents,commentary,liveFinalDraft,finalEvent].map(event=>`id: ${event.eventId}\nevent: agent-event\ndata: ${JSON.stringify(event)}\n\n`).join("");
      return route.fulfill({status:200,contentType:"text/event-stream",headers:{"Cache-Control":"no-cache"},body:`retry: 100\n${body}`});
    }
    if(pathname==="/api/tasks/codex/task-live/events"){
      eventReads++;
      if(eventReads===1)return json({taskId:task.id,status:"running",latestSequence:1,events:[{type:"message",content:"재현 요청",turnId:"turn-1",itemId:"user-1",sequence:1,eventId:"stream:1",metadata:{role:"user"}}]});
      // Deliberately omit the final answer while reporting the same latest
      // sequence. This models provider history lagging behind the live spool.
      return json({taskId:task.id,status:"completed",latestSequence:32,source:"app-server",events:[{type:"message",content:"재현 요청",turnId:"turn-1",itemId:"user-1",metadata:{role:"user"}}]});
    }
    if(pathname==="/api/tasks/codex/task-live")return json({task:{...task,status:"completed",updatedAt:new Date().toISOString()}});
    if(pathname==="/api/tasks")return json({tasks:[task]});
    if(pathname==="/api/codex/threads")return json({sessions:[session],nextCursor:null,stale:false,syncedAt:now,capabilities:{delete:true}});
    if(pathname===`/api/codex/threads/${threadId}/turns`)return json({turns:[],nextCursor:null});
    if(pathname==="/api/projects")return json({projects:[{id:"claudex-workhouse",name:"Claudex Workhouse",enabled:true}]});
    if(pathname==="/api/hosts")return json({hosts:[{id:"local",displayName:"Local",status:"online"}]});
    if(pathname==="/api/workspaces")return json({workspaces:[{id:"workspace-test",projectId:"claudex-workhouse",hostId:"local",displayName:"Claudex Workhouse",canonicalPath:"/srv/claudex-workhouse"}]});
    if(pathname==="/api/collaborations")return json({collaborations:[]});
    if(pathname==="/api/providers/codex/models")return json({catalog:{models:[],permissions:[]}});
    if(pathname==="/api/system-settings/ui-locale")return json({locale:"ko"});
    if(pathname==="/api/system-settings/credit-usage")return json({settings:{version:1,allowPaidCredits:false}});
    if(pathname==="/api/system-settings/models")return json({settings:null,candidates:{claude:[],codex:[]}});
    if(pathname==="/api/provider-connections")return json({accounts:["codex","claude","grok","antigravity","deepseek","ollama"].map(provider=>({provider,state:"connected",accountType:null,planType:null,emailMasked:null,errorCategory:null,checkedAt:new Date().toISOString()})),attempts:[]});
    if(pathname==="/api/provider-connections/attempts")return json({attempts:[]});
    if(pathname==="/api/quota")return json({claude:{},codex:{fiveHour:null,sevenDay:{pct:58,resetsAt:"2026-08-05T04:10:45.000Z",durationMins:10080}},fetchedAt:now});
    if(pathname==="/api/emotion")return json({state:{},codexState:{},outfits:[],assets:[],mode:"catch"});
    if(pathname==="/api/push")return json({preferences:{},publicKey:""});
    return json({});
  });

  await page.goto("/?task=task-live");
  const finalOutput=page.getByText("브라우저에서 반드시 남아야 하는 최종 출력",{exact:true});
  await expect(finalOutput).toBeVisible({timeout:10_000});
  const conversation=page.locator(".conversation");
  const statusBadge=page.locator(".work-status-badge");
  await expect(statusBadge).toBeVisible();
  await expect(statusBadge).toContainText(/(?:주간 사용률|Weekly usage) 58%/);
  if((page.viewportSize()?.width??0)>=761)await statusBadge.click();
  await expect(page.locator(".work-status-panel")).toHaveCount(0);
  await conversation.evaluate(element=>{element.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true}));element.scrollTop=Math.min(420,Math.max(0,element.scrollHeight-element.clientHeight-120));element.dispatchEvent(new Event("scroll"));});
  const readingPosition=await conversation.evaluate(element=>element.scrollTop);
  expect(readingPosition).toBeGreaterThan(80);
  await expect.poll(()=>eventReads,{timeout:10_000}).toBeGreaterThanOrEqual(2);
  await page.waitForTimeout(500);
  await expect(finalOutput).toBeVisible();
  expect(await conversation.evaluate(element=>element.scrollTop)).toBeGreaterThan(80);
  // Reproduce the real two-render completion race: the live rows disappear,
  // the browser clamps the short intermediate layout, and another local state
  // update lands before the persisted result expands the content again.
  const conversationContent=conversation.locator(".conversation-content");
  await conversationContent.evaluate(element=>{element.setAttribute("style","height:24px;overflow:hidden")});
  await page.waitForTimeout(100);
  await statusBadge.click({force:true});
  await conversationContent.evaluate(element=>element.removeAttribute("style"));
  await expect.poll(()=>conversation.evaluate(element=>element.scrollTop)).toBeGreaterThan(80);
  const statusPanel=page.locator(".work-status-panel");
  await expect(statusPanel.locator(".provider-quota")).toContainText(/주간 할당량|Weekly Quota/);
  await expect(statusPanel.locator(".provider-quota")).toContainText("58%");
  await expect(statusPanel.locator(".context-window-card")).toHaveCount(0);
  await expect(statusPanel.getByText("최종 결과 아래에 나오면 안 되는 작업 과정",{exact:true})).toHaveCount(1);
  await expect(page.getByText("브라우저에서 반드시 남아야 하는 최종 출력",{exact:true})).toHaveCount(1);
  await expect(statusPanel.getByText("브라우저에서 반드시 남아야 하는 최종 출력",{exact:true})).toHaveCount(0);
  expect(await finalOutput.evaluate(element=>Boolean(element.closest(".work-status-panel")))).toBe(false);
  await page.screenshot({path:testInfo.outputPath("final-output-preserved.png"),fullPage:true});
});

test("shows one copy of each output when a queued turn takes over",async({page})=>{
  let eventReads=0,queuedStreamReads=0;
  const now=new Date().toISOString(),threadId="22222222-2222-4222-8222-222222222222";
  const task={id:"task-queued",provider:"codex",nativeId:"task-queued",threadId,projectId:"claudex-workhouse",title:"Queued turn output race",prompt:"큐에 넣은 후속 요청",status:"running",createdAt:now,updatedAt:now,result:null,error:null,log:"",owned:true,ownership:"claudex-workhouse",source:"claudex-workhouse",executionHostId:"local",workspaceId:"workspace-test",permissionProfile:":workspace",metadata:{automationLevel:"auto"}};
  const oldTask={...task,id:"task-old",nativeId:"task-old",title:"Original running turn",prompt:"첫 요청",createdAt:new Date(Date.now()-1000).toISOString()};
  const session={threadId,taskId:oldTask.id,projectId:task.projectId,title:oldTask.title,preview:oldTask.prompt,source:"claudex-workhouse",ownership:"claudex-workhouse",status:"running",updatedAt:now,canMutate:true,canStop:true,workspaceId:task.workspaceId,executionHostId:"local",metadata:{automationLevel:"auto"}};
  const prior=[
    {type:"message",content:"첫 요청",metadata:{role:"user",turnId:"turn-1",itemId:"user-1"}},
    {type:"message_completed",content:"이전 작업 최종 출력",metadata:{role:"agent",phase:"final_answer",turnId:"turn-1",itemId:"answer-1"}},
    {type:"message",content:"큐에 넣은 후속 요청",metadata:{role:"user",turnId:"turn-2",itemId:"user-2"}}
  ];
  await page.route("**/api/**",async route=>{
    const pathname=new URL(route.request().url()).pathname,json=(value:unknown)=>route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(value)});
    if(pathname==="/api/tasks/codex/task-old/events/stream"){
      const buffered={type:"message_completed",content:"이전 작업 최종 출력",provider:"codex",threadId,turnId:"turn-1",itemId:"answer-1",sequence:1,eventId:"old:1",metadata:{role:"agent",phase:"final_answer"}};
      return route.fulfill({status:200,contentType:"text/event-stream",headers:{"Cache-Control":"no-cache"},body:`retry: 100\nid: old:1\nevent: agent-event\ndata: ${JSON.stringify(buffered)}\n\n`});
    }
    if(pathname==="/api/tasks/codex/task-queued/events/stream"){
      queuedStreamReads++;
      const taskStarted={type:"task_started",content:"worker started",provider:"codex",threadId,sequence:1,eventId:"queued:1"};
      const hookStarted={type:"tool_progress",content:"Claude hook_started event.",provider:"codex",threadId,sequence:2,eventId:"queued:2",metadata:{nativeType:"system",subtype:"hook_started"}};
      const hookCompleted={type:"tool_progress",content:"Claude hook_response event.",provider:"codex",threadId,sequence:3,eventId:"queued:3",metadata:{nativeType:"system",subtype:"hook_response"}};
      const promptFallback={type:"message",content:"큐에 넣은 후속 요청",provider:"codex",threadId,sequence:4,eventId:"queued:4",metadata:{role:"user",section:"request"}};
      const commentary={type:"message_completed",content:"후속 작업 진행 설명",provider:"codex",threadId,turnId:"turn-2",itemId:"commentary-2",sequence:5,eventId:"queued:5",metadata:{role:"agent",phase:"commentary"}};
      const finalEvent={type:"message_completed",content:"새 작업 최종 출력",provider:"codex",threadId,turnId:"turn-2",itemId:"msg-live-answer-2",sequence:6,eventId:"queued:6",metadata:{role:"agent",phase:"final_answer"}};
      const terminal={type:"task_completed",content:"Codex turn completed.",provider:"codex",threadId,turnId:"turn-2",sequence:7,eventId:"queued:7",terminal:true};
      const body=[taskStarted,hookStarted,hookCompleted,promptFallback,commentary,finalEvent,terminal].map(event=>`id: ${event.eventId}\nevent: agent-event\ndata: ${JSON.stringify(event)}\n\n`).join("");
      return route.fulfill({status:200,contentType:"text/event-stream",headers:{"Cache-Control":"no-cache"},body:`retry: 100\n${body}`});
    }
    if(pathname==="/api/tasks/codex/task-queued/events"){
      eventReads++;
      const hookStarted={type:"tool_progress",content:"Claude hook_started event.",metadata:{nativeType:"system",subtype:"hook_started"}};
      const hookCompleted={type:"tool_progress",content:"Claude hook_response event.",metadata:{nativeType:"system",subtype:"hook_response"}};
      const commentary={type:"message_completed",content:"후속 작업 진행 설명",metadata:{role:"agent",phase:"commentary",turnId:"turn-2",itemId:"commentary-2"}};
      const completed={type:"message_completed",content:"새 작업 최종 출력",metadata:{role:"agent",phase:"final_answer",turnId:"turn-2",itemId:"item-history-answer-2"}};
      const terminal=eventReads>1&&queuedStreamReads>0;
      return json({taskId:task.id,status:terminal?"completed":"running",latestSequence:terminal?7:0,source:"app-server",events:terminal?[...prior,hookStarted,hookCompleted,commentary,completed]:prior});
    }
    if(pathname==="/api/tasks/codex/task-old/events")return json({taskId:oldTask.id,status:"running",latestSequence:0,source:"app-server",events:prior.slice(0,2)});
    if(pathname==="/api/tasks/codex/task-queued")return json({task:{...task,status:queuedStreamReads>0?"completed":"running"}});
    if(pathname==="/api/tasks/codex/task-old")return json({task:{...oldTask,status:"completed"}});
    if(pathname==="/api/tasks/codex/task-old/message-queue")return json({items:[],activeTask:task});
    if(pathname==="/api/tasks/codex/task-queued/message-queue")return json({items:[],activeTask:task});
    if(pathname==="/api/tasks")return json({tasks:[oldTask,task]});
    if(pathname==="/api/codex/threads")return json({sessions:[session],nextCursor:null,stale:false,syncedAt:now,capabilities:{delete:true}});
    if(pathname===`/api/codex/threads/${threadId}/turns`)return json({turns:[],nextCursor:null});
    if(pathname==="/api/projects")return json({projects:[{id:"claudex-workhouse",name:"Claudex Workhouse",enabled:true}]});
    if(pathname==="/api/hosts")return json({hosts:[{id:"local",displayName:"Local",status:"online"}]});
    if(pathname==="/api/workspaces")return json({workspaces:[{id:"workspace-test",projectId:"claudex-workhouse",hostId:"local",displayName:"Claudex Workhouse",canonicalPath:"/srv/claudex-workhouse"}]});
    if(pathname==="/api/collaborations")return json({collaborations:[]});
    if(pathname==="/api/providers/codex/models")return json({catalog:{models:[],permissions:[]}});
    if(pathname==="/api/system-settings/ui-locale")return json({locale:"ko"});
    if(pathname==="/api/system-settings/credit-usage")return json({settings:{version:1,allowPaidCredits:false}});
    if(pathname==="/api/system-settings/models")return json({settings:null,candidates:{claude:[],codex:[]}});
    if(pathname==="/api/provider-connections")return json({accounts:["codex","claude","grok","antigravity","deepseek","ollama"].map(provider=>({provider,state:"connected",accountType:null,planType:null,emailMasked:null,errorCategory:null,checkedAt:new Date().toISOString()})),attempts:[]});
    if(pathname==="/api/provider-connections/attempts")return json({attempts:[]});
    if(pathname==="/api/quota")return json({claude:{},codex:{},fetchedAt:now});
    if(pathname==="/api/emotion")return json({state:{},codexState:{},outfits:[],assets:[],mode:"catch"});
    if(pathname==="/api/push")return json({preferences:{},publicKey:""});
    return json({});
  });

  await page.goto("/?task=task-old");
  await expect.poll(()=>eventReads,{timeout:10_000}).toBeGreaterThanOrEqual(2);
  await expect.poll(()=>queuedStreamReads,{timeout:10_000}).toBeGreaterThanOrEqual(1);
  await expect(page.getByText("이전 작업 최종 출력",{exact:true})).toHaveCount(1);
  await expect(page.getByText("큐에 넣은 후속 요청",{exact:true})).toHaveCount(1);
  const conversation=page.locator(".conversation"),commentary=conversation.getByText("후속 작업 진행 설명",{exact:true}),finalOutput=conversation.getByText("새 작업 최종 출력",{exact:true});
  await expect(commentary).toHaveCount(1);
  await expect(page.getByText("새 작업 최종 출력",{exact:true})).toHaveCount(1);
  expect(await commentary.evaluate((element,finalElement)=>Boolean(element.compareDocumentPosition(finalElement as Node)&Node.DOCUMENT_POSITION_FOLLOWING),await finalOutput.elementHandle())).toBe(true);
  const statusBadge=page.locator(".work-status-badge");
  if(await statusBadge.getAttribute("aria-expanded")!=="true")await statusBadge.click();
  await page.locator(".work-event-details > summary").click();
  const hookGroup=page.locator(".event-group").filter({hasText:/내부 훅|Internal hooks/});
  await expect(hookGroup).toHaveCount(1);
  await hookGroup.locator("summary").click();
  await expect(hookGroup.getByText("Claude hook_started event.",{exact:true})).toHaveCount(1);
  await expect(hookGroup.getByText("Claude hook_response event.",{exact:true})).toHaveCount(1);
});
