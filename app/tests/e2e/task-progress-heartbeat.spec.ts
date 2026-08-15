import { expect, test } from "@playwright/test";

// A turn that has only produced provider-common lifecycle rows: no assistant
// sentence exists yet, which is exactly the window that used to read as a
// frozen session once the work detail was folded.
const lifecycleEvents=(startedAt:string)=>[
  {type:"message",content:"오래 걸리는 작업을 해줘",provider:"claude",turnId:"turn-1",itemId:"user-1",sequence:1,eventId:"stream:1",timestamp:startedAt,metadata:{role:"user"}},
  {type:"turn_started",content:"",provider:"claude",turnId:"turn-1",itemId:"turn-1",sequence:2,eventId:"stream:2",timestamp:startedAt},
  {type:"tool_started",content:"Read",provider:"claude",turnId:"turn-1",itemId:"tool-1",sequence:3,eventId:"stream:3",timestamp:startedAt},
  {type:"tool_completed",content:"Read",provider:"claude",turnId:"turn-1",itemId:"tool-1",sequence:4,eventId:"stream:4",timestamp:startedAt},
  {type:"command_started",content:"pnpm test",provider:"claude",turnId:"turn-1",itemId:"cmd-1",sequence:5,eventId:"stream:5",timestamp:startedAt,metadata:{description:"단위 테스트"}},
  {type:"command_output",content:"running…",provider:"claude",turnId:"turn-1",itemId:"cmd-1",sequence:6,eventId:"stream:6",timestamp:startedAt}
];

const finalAnswer={type:"message_completed",content:"작업을 마쳤습니다.",provider:"claude",turnId:"turn-1",itemId:"answer-1",sequence:7,eventId:"stream:7",metadata:{role:"agent",phase:"final_answer"}};

test.describe("long-turn progress heartbeat",()=>{
  test("keeps a running turn legible before its first assistant message",async({page})=>{
    await page.addInitScript(()=>localStorage.setItem("claudex-ui-locale","ko"));
    const startedAt=new Date(Date.now()-95_000).toISOString(),now=new Date().toISOString();
    let finished=false;
    const task={id:"heartbeat-task",provider:"claude",nativeId:"heartbeat-task",threadId:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",projectId:"project",title:"진행 하트비트",prompt:"오래 걸리는 작업을 해줘",status:"running",createdAt:startedAt,updatedAt:now,result:null,error:null,log:"",owned:true,ownership:"claudex-workhouse",source:"claudex-workhouse",executionHostId:"local",workspaceId:"workspace",permissionProfile:":workspace",metadata:{}};

    await page.route("**/api/**",async route=>{
      const pathname=new URL(route.request().url()).pathname,json=(value:unknown)=>route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(value)});
      if(pathname.endsWith("/events/stream")){
        const rows=finished?[...lifecycleEvents(startedAt),finalAnswer]:lifecycleEvents(startedAt);
        const body=rows.map(event=>`id: ${event.eventId}\nevent: agent-event\ndata: ${JSON.stringify(event)}\n\n`).join("");
        return route.fulfill({status:200,contentType:"text/event-stream",headers:{"Cache-Control":"no-cache"},body:`retry: 3600000\n${body}`});
      }
      if(pathname==="/api/tasks")return json({tasks:[{...task,status:finished?"completed":"running"}],partial:false,warnings:[]});
      if(pathname==="/api/tasks/claude/heartbeat-task")return json({task:{...task,status:finished?"completed":"running"}});
      if(pathname==="/api/tasks/claude/heartbeat-task/events")
        return json({taskId:task.id,status:finished?"completed":"running",latestSequence:finished?7:6,events:finished?[...lifecycleEvents(startedAt),finalAnswer]:lifecycleEvents(startedAt)});
      if(pathname==="/api/tasks/claude/heartbeat-task/message-queue")return json({items:[],activeTask:null});
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

    // 1. The running task card names the stage and the elapsed time.
    await page.goto("/");
    await page.getByRole("button",{name:"세션",exact:true}).click();
    const cardProgress=page.locator(".task-card .session-progress-heartbeat").first();
    await expect(cardProgress).toBeVisible({timeout:15_000});
    await expect(cardProgress.locator("strong")).toHaveText("명령 실행 중");
    await expect(cardProgress.locator("b")).toContainText("경과");
    await expect(cardProgress).toHaveAttribute("aria-label",/작업 진행 중/);

    // 2. The conversation shows the same information while the work detail is
    //    folded, and it stays inside the badge rather than the scrolling log.
    await page.goto("/?task=heartbeat-task");
    const badge=page.locator(".work-status-badge"),heartbeat=badge.locator(".work-progress-heartbeat");
    await expect(badge).toBeVisible({timeout:15_000});
    if((await badge.getAttribute("aria-expanded"))==="true")await badge.click();
    await expect(badge).toHaveAttribute("aria-expanded","false");
    await expect(page.locator(".work-status-panel")).toHaveCount(0);
    await expect(heartbeat).toBeVisible();
    await expect(heartbeat).toHaveCount(1);
    await expect(page.locator(".conversation .work-progress-heartbeat")).toHaveCount(0);
    await expect(heartbeat).toHaveAttribute("aria-label",/명령 실행 중/);
    await expect(heartbeat).toHaveAttribute("aria-label",/경과/);
    // A folded badge shows no invented percentage.
    await expect(heartbeat).not.toContainText("%");

    // 3. The clock advances even though the stubbed stream sends nothing more.
    const readElapsed=()=>heartbeat.locator("b").innerText();
    const first=await readElapsed();
    await expect.poll(readElapsed,{timeout:8_000}).not.toBe(first);

    // 4. Expanding the drawer reveals a real-width freshness gauge. A broad
    //    parent `> span` selector once turned HeartbeatBar's grid root into a
    //    flex row, collapsing this empty track to zero pixels on mobile.
    await badge.click();
    await expect(badge).toHaveAttribute("aria-expanded","true");
    const freshnessTrack=page.locator(".work-status-panel .heartbeat-track");
    await expect(freshnessTrack).toBeVisible();
    const trackBox=await freshnessTrack.boundingBox();
    expect(trackBox?.width??0).toBeGreaterThan(100);
    expect(trackBox?.height??0).toBeGreaterThanOrEqual(6);

    // 5. Completion removes the heartbeat and leaves exactly one final answer.
    finished=true;
    const finalOutput=page.locator('.bubble.agent[data-event-type="message_completed"]').filter({hasText:"작업을 마쳤습니다."});
    await expect(finalOutput).toHaveCount(1,{timeout:20_000});
    await expect(finalOutput).toHaveClass(/final-output-reveal/);
    // The terminal status reaches the browser on the next reconciliation poll,
    // so allow a full poll interval before the heartbeat has to be gone.
    await expect(heartbeat).toHaveCount(0,{timeout:20_000});
    await expect(badge).toBeVisible();
    await expect(badge).toContainText("작업을 마쳤어요");

    // A final output loaded as history on a fresh mount must stay still.
    await page.goto("/?task=heartbeat-task");
    await expect(page.locator('.bubble.agent[data-event-type="message_completed"]').filter({hasText:"작업을 마쳤습니다."})).not.toHaveClass(/final-output-reveal/);
  });
});
