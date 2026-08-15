import{expect,test}from"@playwright/test";

test.use({reducedMotion:"no-preference"});

test("live commentary waves and becomes a decorated final answer",async({page})=>{
  await page.setViewportSize({width:916,height:1356});
  await page.addInitScript(()=>{localStorage.setItem("claudex-ui-locale","ko");localStorage.setItem("deck-theme","light");class SilentEventSource{onerror:null|(()=>void)=null;constructor(public url:string){}addEventListener(){}close(){}}Object.defineProperty(globalThis,"EventSource",{value:SilentEventSource,configurable:true});});
  const now=new Date().toISOString(),threadId="wave-root";let finished=false;
  const task={id:"output-polish",provider:"claude",nativeId:"output-polish",threadId,projectId:"project",title:"출력 카드 광택",prompt:"결과 카드를 확인해 주세요.",status:"running",createdAt:now,updatedAt:now,result:null,error:null,log:"",owned:true,ownership:"claudex-workhouse",source:"claudex-workhouse",executionHostId:"local",workspaceId:"workspace",metadata:{}};
  const base=[{type:"message",content:task.prompt,threadId,turnId:"turn-1",itemId:"user-1",sequence:1,eventId:"wave:1",metadata:{role:"user"}},{type:"message_completed",content:"작업 활동과 통계 배치를 확인하고 있습니다.",threadId,turnId:"turn-1",itemId:"commentary-1",sequence:2,eventId:"wave:2",metadata:{role:"agent",phase:"commentary"}}];
  const final={type:"message_completed",content:"카드 광택 적용을 마쳤습니다.",threadId,turnId:"turn-1",itemId:"final-1",sequence:3,eventId:"wave:3",metadata:{role:"agent",phase:"final_answer"}};
  await page.route("**/api/**",async route=>{
    const pathname=new URL(route.request().url()).pathname,json=(value:unknown)=>route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(value)}),rows=finished?[...base,final]:base,status=finished?"completed":"running";
    if(pathname==="/api/tasks")return json({tasks:[{...task,status}],partial:false,warnings:[]});
    if(pathname==="/api/tasks/claude/output-polish")return json({task:{...task,status}});
    if(pathname==="/api/tasks/claude/output-polish/events")return json({taskId:task.id,status,latestSequence:rows.length,events:rows});
    if(pathname.includes("/message-queue"))return json({items:[],activeTask:null});
    if(pathname==="/api/projects")return json({projects:[{id:"project",name:"Project",enabled:true,error:null}]});
    if(pathname==="/api/hosts")return json({hosts:[{id:"local",displayName:"Local",status:"online"}]});
    if(pathname==="/api/workspaces")return json({workspaces:[{id:"workspace",projectId:"project",hostId:"local",displayName:"Workspace",canonicalPath:"/workspace"}]});
    if(pathname==="/api/collaborations")return json({collaborations:[]});
    if(pathname==="/api/providers/codex/models")return json({catalog:{models:[],permissions:[]}});
    if(pathname==="/api/providers/claude/permissions")return json({models:[],permissions:[],efforts:[],catalog:{models:[],stale:false}});
    if(pathname==="/api/provider-connections"||pathname==="/api/provider-connections/attempts")return json({accounts:[],attempts:[]});
    if(pathname==="/api/quota")return json({claude:{},codex:{},fetchedAt:now});
    if(pathname==="/api/emotion")return json({state:{},codexState:{},outfits:[],assets:[],mode:"catch"});
    if(pathname==="/api/push")return json({preferences:{},publicKey:""});
    if(pathname.startsWith("/api/system-settings/"))return json({settings:null,candidates:{claude:[],codex:[]}});
    return json({});
  });
  await page.goto("/?task=output-polish");
  const commentary=page.locator(".bubble.agent.live-writing-card").filter({hasText:"작업 활동과 통계 배치를 확인하고 있습니다."});
  await expect(commentary).toBeVisible();await expect(commentary.locator(".live-writing-wave i")).toHaveCount(3);
  await expect(commentary.locator(".live-writing-wave i").first()).toHaveCSS("animation-name","live-writing-wave");
  finished=true;
  const finalCard=page.locator(".bubble.agent.final-output-card").filter({hasText:"카드 광택 적용을 마쳤습니다."});
  await expect(finalCard).toBeVisible({timeout:20_000});
  await expect(finalCard.locator(".final-output-badge")).toHaveText("최종 답변");
  await expect(finalCard.locator(".live-writing-wave")).toHaveCount(0);
  await expect(finalCard).toHaveCSS("background-image",/linear-gradient/);
  const badge=finalCard.locator(".final-output-badge");
  await page.evaluate(()=>{const fixture=document.createElement("section");fixture.className="task-outcome outcome-theme-fixture";fixture.innerHTML='<header>결과 요약</header><button class="outcome-badge outcome-reopen">결과</button>';document.body.append(fixture);});
  for(const appearance of [{theme:"dark",palette:"violet"},{theme:"light",palette:"sunset"},{theme:"light",palette:"mono"}]){
    const colors=await page.evaluate(({theme,palette})=>{const root=document.documentElement;root.dataset.theme=theme;root.dataset.palette=palette;const probe=document.createElement("span");probe.style.color="var(--accent-strong)";document.body.append(probe);const accent=getComputedStyle(probe).color;probe.remove();return{accent,badge:getComputedStyle(document.querySelector(".final-output-badge")!).color,outcome:getComputedStyle(document.querySelector(".outcome-theme-fixture>header")!).color,outcomeBadge:getComputedStyle(document.querySelector(".outcome-theme-fixture .outcome-badge")!).color};},appearance);
    await expect(badge).toHaveCSS("color",colors.accent);
    expect(colors.badge).toBe(colors.accent);
    expect(colors.outcome).toBe(colors.accent);
    expect(colors.outcomeBadge).toBe(colors.accent);
  }
  await page.evaluate(()=>document.documentElement.dataset.skin="outline");
  await expect(finalCard).toHaveCSS("background-image","none");
  await page.evaluate(()=>document.documentElement.dataset.skin="flat");
  await expect(finalCard).toHaveCSS("background-color","rgba(0, 0, 0, 0)");
});

test("all providers decorate an unlabelled completed message and stop its writing wave",async({page})=>{
  await page.addInitScript(()=>{localStorage.setItem("claudex-ui-locale","ko");class SilentEventSource{onerror:null|(()=>void)=null;constructor(public url:string){}addEventListener(){}close(){}}Object.defineProperty(globalThis,"EventSource",{value:SilentEventSource,configurable:true});});
  const now=new Date().toISOString(),providers=["claude","deepseek","ollama","grok","antigravity"] as const;
  const tasks=providers.map(provider=>({id:`${provider}-final`,provider,nativeId:`${provider}-final`,threadId:`${provider}-thread`,projectId:"project",title:`${provider} 최종 출력`,prompt:`${provider} 응답`,status:"running",createdAt:now,updatedAt:now,result:null,error:null,log:"",owned:true,ownership:"claudex-workhouse",source:"claudex-workhouse",executionHostId:"local",workspaceId:"workspace",metadata:{}}));
  await page.route("**/api/**",async route=>{
    const pathname=new URL(route.request().url()).pathname,json=(value:unknown)=>route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(value)});
    if(pathname==="/api/tasks")return json({tasks,partial:false,warnings:[]});
    const task=tasks.find(candidate=>pathname===`/api/tasks/${candidate.provider}/${candidate.id}`||pathname===`/api/tasks/${candidate.provider}/${candidate.id}/events`);
    if(task&&pathname.endsWith("/events"))return json({taskId:task.id,status:"running",latestSequence:3,events:[
      {type:"message",content:task.prompt,provider:task.provider,threadId:task.threadId,itemId:"user",sequence:1,metadata:{role:"user"}},
      {type:"message_completed",content:`${task.provider} phase 없는 최종 답변`,provider:task.provider,threadId:task.threadId,itemId:"answer",sequence:2,metadata:task.provider==="claude"?{threadId:task.threadId}:{role:"agent",nativeType:"assistant"}},
      {type:"task_completed",content:`${task.provider} phase 없는 최종 답변`,provider:task.provider,threadId:task.threadId,sequence:3,metadata:{nativeType:"result",subtype:"success"}}
    ]});
    if(task)return json({task});
    if(pathname.includes("/message-queue"))return json({items:[],activeTask:null});
    if(pathname==="/api/projects")return json({projects:[{id:"project",name:"Project",enabled:true,error:null}]});
    if(pathname==="/api/hosts")return json({hosts:[{id:"local",displayName:"Local",status:"online"}]});
    if(pathname==="/api/workspaces")return json({workspaces:[{id:"workspace",projectId:"project",hostId:"local",displayName:"Workspace",canonicalPath:"/workspace"}]});
    if(pathname==="/api/collaborations")return json({collaborations:[]});
    if(pathname==="/api/providers/codex/models")return json({catalog:{models:[],permissions:[]}});
    if(pathname==="/api/providers/claude/permissions")return json({models:[],permissions:[],efforts:[],catalog:{models:[],stale:false}});
    if(pathname==="/api/provider-connections"||pathname==="/api/provider-connections/attempts")return json({accounts:[],attempts:[]});
    if(pathname==="/api/quota")return json({claude:{},codex:{},fetchedAt:now});
    if(pathname==="/api/emotion")return json({state:{},codexState:{},outfits:[],assets:[],mode:"catch"});
    if(pathname==="/api/push")return json({preferences:{},publicKey:""});
    if(pathname.startsWith("/api/system-settings/"))return json({settings:null,candidates:{claude:[],codex:[]}});
    return json({});
  });
  for(const task of tasks){
    await page.goto(`/?task=${task.id}`);
    const finalCard=page.locator(".bubble.agent.final-output-card").filter({hasText:`${task.provider} phase 없는 최종 답변`});
    await expect(finalCard,`${task.provider} final card`).toBeVisible();
    await expect(finalCard.locator(".final-output-badge")).toHaveText("최종 답변");
    await expect(finalCard.locator(".live-writing-wave")).toHaveCount(0);
  }
});
