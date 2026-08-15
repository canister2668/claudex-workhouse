import { expect,test } from "@playwright/test";

test.skip(process.env.CLAUDEX_WORKHOUSE_LIVE_CONVERSATION!=="1","live provider regression only");

test("automatic 5+5 conversation keeps one live stream and reoffers continuation controls",async({page,context})=>{
  test.setTimeout(12*60_000);
  await page.addInitScript(()=>{
    const NativeEventSource=globalThis.EventSource;
    const audit={taskStreamUrls:[] as string[],deltaUrls:[] as string[],completedUrls:[] as string[],lifecycle:[] as Array<{url:string;delta:1|-1}>,activeTaskStreams:0,maxActiveTaskStreams:0};
    (globalThis as any).__collaborationLiveAudit=audit;
    class AuditedEventSource{
      static CONNECTING=NativeEventSource.CONNECTING;static OPEN=NativeEventSource.OPEN;static CLOSED=NativeEventSource.CLOSED;
      private source:EventSource;private task=false;private closed=false;private wrapped=new Map<any,any>();
      constructor(url:string|URL,options?:EventSourceInit){const value=String(url);this.task=value.includes("/events/stream");if(this.task){audit.taskStreamUrls.push(value);audit.lifecycle.push({url:value,delta:1});audit.activeTaskStreams++;audit.maxActiveTaskStreams=Math.max(audit.maxActiveTaskStreams,audit.activeTaskStreams);}this.source=new NativeEventSource(url,options);}
      addEventListener(type:string,listener:any,options?:any){const wrapped=(event:any)=>{if(this.task&&type==="agent-event")try{const value=JSON.parse(event.data);if(value.type==="message_delta")audit.deltaUrls.push(String(this.source.url));if(value.type==="message_completed")audit.completedUrls.push(String(this.source.url));}catch{}return typeof listener==="function"?listener.call(this.source,event):listener?.handleEvent?.(event);};this.wrapped.set(listener,wrapped);this.source.addEventListener(type,wrapped,options);}
      removeEventListener(type:string,listener:any,options?:any){this.source.removeEventListener(type,this.wrapped.get(listener)??listener,options);this.wrapped.delete(listener);}
      close(){if(this.task&&!this.closed){this.closed=true;audit.lifecycle.push({url:String(this.source.url),delta:-1});audit.activeTaskStreams--;}this.source.close();}
      get url(){return this.source.url;}get withCredentials(){return this.source.withCredentials;}get readyState(){return this.source.readyState;}
      get onopen(){return this.source.onopen;}set onopen(value){this.source.onopen=value;}
      get onmessage(){return this.source.onmessage;}set onmessage(value){this.source.onmessage=value;}
      get onerror(){return this.source.onerror;}set onerror(value){this.source.onerror=value;}
      dispatchEvent(event:Event){return this.source.dispatchEvent(event);}
    }
    (globalThis as any).EventSource=AuditedEventSource;
  });
  const guarded={"Origin":"http://127.0.0.1:3410","X-Claudex-Workhouse-Request":"1","Idempotency-Key":crypto.randomUUID()};
  const workspaces=await (await page.request.get("/api/workspaces?projectId=risuai")).json(),workspace=workspaces.workspaces.find((item:any)=>item.hostId==="local");expect(workspace).toBeTruthy();
  const title=`실시간 5+5 회귀 ${Date.now()}`,createdResponse=await page.request.post("/api/collaborations",{headers:guarded,data:{projectId:"risuai",title,mode:"conversation",prompt:"실시간 스트림 회귀 검증 대화입니다. 매 발언은 한국어 한두 문장으로 짧게 이어가세요.",primaryProvider:"codex",participants:[{provider:"codex",executionHostId:"local",workspaceId:workspace.id,permissionMode:"read"},{provider:"claude",executionHostId:"local",workspaceId:workspace.id,permissionMode:"read"}],maxRounds:5,conversationFlow:"automatic",conversationKind:"casual",participantOrder:["codex","claude"],conversationTone:"concise",userNickname:"검증 사용자",timeoutMs:30*60_000}});expect(createdResponse.ok(),await createdResponse.text()).toBe(true);const created=await createdResponse.json(),collaborationId=created.session.id;
  await page.goto("/");await page.getByRole("navigation",{name:"주요 화면"}).getByRole("button",{name:"대화",exact:true}).click();const conversationCard=page.locator("button.collaboration-card").filter({hasText:title});await conversationCard.click();
  const timeline=page.getByRole("region",{name:"Claude와 Codex 협업 타임라인"});await expect(timeline).toBeVisible();const awaitContinuation=async(timeout:number)=>{let retries=0;for(;;){const addRounds=timeline.getByRole("button",{name:"5턴 추가",exact:true}),retry=timeline.getByRole("button",{name:"실패한 턴 다시 시도",exact:true});await expect(addRounds.or(retry).first()).toBeVisible({timeout});if(await addRounds.isVisible()){await expect(timeline.getByRole("button",{name:"사용자 입력",exact:true})).toBeVisible();return;}if(retries++>=2)throw new Error("conversation did not recover after two failed-turn retries");await retry.click();await expect(retry).toHaveCount(0);}};await expect(timeline.locator(".current-speaker .provider-output").first()).toBeVisible({timeout:120_000});
  await awaitContinuation(6*60_000);const firstDetail=await (await page.request.get(`/api/collaborations/${collaborationId}`)).json(),firstTaskIds=firstDetail.runs.map((run:any)=>run.providerTaskId);
  await expect(timeline.getByRole("button",{name:"사용자 입력",exact:true})).toBeVisible();await expect(timeline.getByRole("button",{name:"5턴 추가",exact:true})).toBeVisible();await expect(timeline.locator("textarea#conversation-next")).toHaveCount(0);await expect(timeline.locator(".automatic-continuation-actions")).toHaveCount(1);
  await timeline.getByRole("button",{name:"사용자 입력",exact:true}).click();const textarea=timeline.locator("textarea#conversation-next");await expect(textarea).toBeVisible();await expect(textarea).toBeFocused();
  // The conversation input grows with what is typed, like the session composer.
  // Without that it stayed one line tall and scrolled internally, hiding every
  // line but the last while composing.
  const inputHeight=async()=>(await textarea.boundingBox())!.height;
  const oneLine=await inputHeight();
  await textarea.fill(Array.from({length:6},(_,index)=>`${index+1}번째 줄`).join("\n"));
  await expect.poll(inputHeight).toBeGreaterThan(oneLine+20);
  // It stops growing before it swallows the viewport and scrolls past that.
  await textarea.fill(Array.from({length:60},(_,index)=>`${index+1}번째 줄`).join("\n"));
  const tall=await inputHeight();
  expect(tall).toBeLessThanOrEqual(140);
  expect(await textarea.evaluate(node=>node.scrollHeight>node.clientHeight)).toBe(true);
  await textarea.fill("");
  await expect.poll(inputHeight).toBeLessThan(oneLine+20);
  const targetStreamCount=async(taskIds:string[])=>page.evaluate(ids=>(globalThis as any).__collaborationLiveAudit.taskStreamUrls.filter((url:string)=>ids.some(id=>url.includes(`/${encodeURIComponent(id)}/events/stream`))).length,taskIds),streamsBeforeReentry=await targetStreamCount(firstTaskIds);await page.getByRole("button",{name:"목록으로"}).click();await conversationCard.click();await expect(timeline.getByRole("button",{name:"5턴 추가",exact:true})).toBeVisible();await page.waitForTimeout(1000);expect(await targetStreamCount(firstTaskIds)).toBe(streamsBeforeReentry);
  let addRequests=0;page.on("request",request=>{if(request.method()==="POST"&&request.url().includes(`/api/collaborations/${collaborationId}/add-rounds`))addRequests++;});await timeline.getByRole("button",{name:"5턴 추가",exact:true}).click();await expect.poll(()=>addRequests).toBe(1);await expect(timeline.getByRole("button",{name:"5턴 추가",exact:true})).toHaveCount(0);
  await expect(timeline.locator(".current-speaker").first()).toBeVisible({timeout:120_000});await page.evaluate(()=>{Object.defineProperty(document,"visibilityState",{configurable:true,value:"hidden"});document.dispatchEvent(new Event("visibilitychange"));});await page.waitForTimeout(300);await page.evaluate(()=>{Object.defineProperty(document,"visibilityState",{configurable:true,value:"visible"});document.dispatchEvent(new Event("visibilitychange"));});await context.setOffline(true);await page.waitForTimeout(500);await context.setOffline(false);
  await awaitContinuation(8*60_000);const finalDetail=await (await page.request.get(`/api/collaborations/${collaborationId}`)).json();expect(`${finalDetail.session.status}:${finalDetail.runs.length}:${finalDetail.continuation?.canAddRounds}:${finalDetail.continuation?.canSubmitUserInput}`).toBe("completed:20:true:true");
  await expect(timeline.getByRole("button",{name:"사용자 입력",exact:true})).toBeVisible();await expect(timeline.getByRole("button",{name:"5턴 추가",exact:true})).toBeVisible();await expect(timeline.locator(".provider-output")).toHaveCount(20);expect(addRequests).toBe(1);
  const audit=await page.evaluate(()=>(globalThis as any).__collaborationLiveAudit),allTaskIds=finalDetail.runs.map((run:any)=>run.providerTaskId),secondTaskIds=allTaskIds.slice(10),matches=(url:string,ids:string[])=>ids.some(id=>url.includes(`/${encodeURIComponent(id)}/events/stream`)),streamPath=(url:string)=>new URL(url,"http://claudex-workhouse.test").pathname;let active=0,maxActive=0;for(const event of audit.lifecycle)if(matches(event.url,allTaskIds)){active+=event.delta;maxActive=Math.max(maxActive,active);}expect(maxActive).toBeLessThanOrEqual(1);const secondHalfUrls=[...new Set(audit.taskStreamUrls.filter((url:string)=>matches(url,secondTaskIds)))];expect(secondHalfUrls).toHaveLength(10);for(const url of secondHalfUrls)expect(audit.deltaUrls.some((deltaUrl:string)=>streamPath(deltaUrl)===streamPath(url))).toBe(true);
});
