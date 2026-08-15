import {expect,test,type Page} from "@playwright/test";

// The transcript top exposes one control at a time: a running session starts collapsed behind
// the running-history banner, and the earlier-history loader appears only once that history is
// expanded — or immediately for a finished session whose transcript is still truncated.
const now=new Date().toISOString();
const threadId="dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const base={id:"claude-long",provider:"claude",nativeId:"claude-long",threadId,projectId:"project",title:"Claude long transcript",prompt:"현재 요청",status:"running",createdAt:"2026-07-25T10:00:00.000Z",updatedAt:now,result:null,error:null,log:"",owned:true,ownership:"claudex-workhouse",source:"claudex-workhouse",executionHostId:"local",workspaceId:"workspace",metadata:{}};

const transcript=[
  {type:"message",content:"이전 요청",metadata:{role:"user"}},
  {type:"message_completed",content:"이전 최종 출력",metadata:{role:"agent",phase:"final_answer"}},
  {type:"message",content:"현재 요청",metadata:{role:"user"}},
  {type:"message_completed",content:"현재 최종 출력",metadata:{role:"agent",phase:"final_answer"}},
];

async function mountSession(page:Page,status:"running"|"completed",options:{loadDelayMs?:number}={}){
  const task={...base,status,...(status==="completed"?{result:"done",updatedAt:"2026-07-25T10:30:00.000Z"}:{})};
  const expandedRequests:string[]=[];
  await page.addInitScript(()=>{
    localStorage.setItem("claudex-ui-locale","ko");
    localStorage.setItem("deck-theme","dark");
    localStorage.removeItem("deck-show-running-history");
  });
  await page.route("**/api/**",async route=>{
    const url=new URL(route.request().url()),pathname=url.pathname,json=(value:unknown)=>route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(value)});
    if(pathname.endsWith("/events/stream"))return route.fulfill({status:200,contentType:"text/event-stream",body:": ready\n\n"});
    if(pathname==="/api/tasks")return json({tasks:[task],partial:false,warnings:[]});
    if(pathname==="/api/tasks/claude/claude-long")return json({task});
    if(pathname==="/api/tasks/claude/claude-long/events"){
      const turns=url.searchParams.get("transcriptTurns");
      if(turns==="24"){
        expandedRequests.push(turns);
        if(options.loadDelayMs)await new Promise(resolve=>setTimeout(resolve,options.loadDelayMs));
        return json({latestSequence:0,events:transcript,truncated:{before:true,droppedTurns:9,droppedBytes:8192}});
      }
      return json({latestSequence:0,events:transcript,truncated:{before:true,droppedTurns:12,droppedBytes:16384}});
    }
    if(pathname==="/api/tasks/claude/claude-long/message-queue")return json({items:[],activeTask:null});
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
  await page.goto("/?task=claude-long");
  await expect(page.getByText("현재 최종 출력",{exact:true})).toBeVisible({timeout:10_000});
  return expandedRequests;
}

test("keeps a running session collapsed behind the running-history banner before exposing older history",async({page})=>{
  const expandedRequests=await mountSession(page,"running",{loadDelayMs:800});
  const banner=page.locator(".running-history-control");
  const anchor=page.locator(".transcript-history-anchor");
  await expect(banner).toHaveCount(1);
  await expect(banner).toContainText("현재 작업만 표시합니다.");
  await expect(anchor).toHaveCount(0);

  await banner.getByRole("button",{name:"이전 대화 표시"}).click();
  const loader=anchor.getByRole("button",{name:"이전 대화 12턴 불러오기"});
  await expect(anchor).toHaveCount(1);
  await expect(loader).toBeVisible();
  await expect(anchor).not.toContainText("완료된 긴 세션에서도 표시");

  // The boundary is drawn with theme rules, not a filled card.
  await expect.poll(()=>anchor.evaluate(element=>getComputedStyle(element).backgroundColor)).toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
  expect(await anchor.evaluate(element=>getComputedStyle(element,"::before").height)).toBe("1px");
  // The rule colour must resolve to the active theme's --line token, not a hard-coded value.
  const [ruleColor,lineToken]=await anchor.evaluate(element=>{
    const rule=getComputedStyle(element,"::before").backgroundColor;
    const probe=document.createElement("span");
    probe.style.color=getComputedStyle(element).getPropertyValue("--line").trim();
    document.body.append(probe);
    const resolved=getComputedStyle(probe).color;
    probe.remove();
    return [rule,resolved];
  });
  expect(ruleColor).toBe(lineToken);
  expect(await page.evaluate(()=>document.documentElement.dataset.theme)).toBe("dark");
  expect(await loader.evaluate(element=>Math.round(element.getBoundingClientRect().height))).toBeGreaterThanOrEqual(36);
  expect(await loader.evaluate(element=>{
    const box=element.getBoundingClientRect();
    return box.left>=0&&box.right<=window.innerWidth;
  })).toBe(true);

  await loader.click();
  await expect(anchor.getByRole("button")).toBeDisabled();
  await expect(anchor).toContainText("불러오는 중");
  await expect(anchor).toContainText("안전 상한에 도달했습니다.",{timeout:10_000});
  expect(expandedRequests.length).toBeGreaterThanOrEqual(1);
});

test("keeps the older-history loader available for a completed long session",async({page})=>{
  await mountSession(page,"completed");
  await expect(page.locator(".running-history-control")).toHaveCount(0);
  const anchor=page.locator(".transcript-history-anchor");
  await expect(anchor).toHaveCount(1);
  await expect(anchor.getByRole("button",{name:"이전 대화 12턴 불러오기"})).toBeVisible();
});
