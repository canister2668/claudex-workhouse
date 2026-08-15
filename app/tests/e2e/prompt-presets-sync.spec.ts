import{expect,test,type BrowserContext}from"@playwright/test";

test("legacy presets migrate once and appear on desktop, phone, and tablet",async({browser})=>{
  const now="2026-07-29T10:00:00.000Z",workspace={id:"workspace",projectId:"project",hostId:"local",displayName:"Workspace",canonicalPath:"/workspace"};
  let server:{version:1;presets:any[]}={version:1,presets:[]},updatedAt:string|null=null,puts=0,gets=0;
  const lostResponseKeys:string[]=[],serverErrorKeys:string[]=[];
  const contexts:BrowserContext[]=[];
  async function device(viewport:{width:number;height:number},mode:"empty"|"legacy"|"conflict"|"server-error"|"lost-response"="empty"){
    const previousGets=gets;
    const context=await browser.newContext({viewport});contexts.push(context);
    await context.addInitScript(({mode})=>{
      localStorage.setItem("claudex-ui-locale","ko");
      if(mode==="legacy")localStorage.setItem("deck-prompt-presets",JSON.stringify([{id:"legacy-one",label:"기존 프리셋",prompt:"기존 요청을 실행"}]));
      if(mode==="conflict"){
        localStorage.setItem("deck-prompt-presets",JSON.stringify([{id:"local-one",label:"이 기기 프리셋",prompt:"로컬 요청"}]));
        localStorage.setItem("deck-prompt-presets-server-snapshot-v1",JSON.stringify([{id:"old-base",label:"이전 값",prompt:"이전 요청"}]));
      }
      if(mode==="lost-response"){
        const base=[{id:"legacy-one",label:"기존 프리셋",prompt:"기존 요청을 실행"},{id:"local-one",label:"이 기기 프리셋",prompt:"로컬 요청"}];
        localStorage.setItem("deck-prompt-presets",JSON.stringify([...base,{id:"response-lost",label:"응답 유실 복구",prompt:"응답 유실 후 복구"}]));
        localStorage.setItem("deck-prompt-presets-server-snapshot-v1",JSON.stringify(base));
      }
      if(mode==="server-error"){
        const base=[{id:"legacy-one",label:"기존 프리셋",prompt:"기존 요청을 실행"},{id:"local-one",label:"이 기기 프리셋",prompt:"로컬 요청"}];
        localStorage.setItem("deck-prompt-presets",JSON.stringify([...base,{id:"server-error",label:"서버 오류 로컬",prompt:"서버 오류"}]));
        localStorage.setItem("deck-prompt-presets-server-snapshot-v1",JSON.stringify(base));
      }
      class QuietEventSource{constructor(_url:string){}addEventListener(){}close(){}}
      (globalThis as any).EventSource=QuietEventSource;
    },{mode});
    await context.route("**/api/**",async route=>{
      const url=new URL(route.request().url()),pathname=url.pathname,method=route.request().method(),json=(value:unknown,status=200)=>route.fulfill({status,contentType:"application/json",body:JSON.stringify(value)});
      if(pathname==="/api/system-settings/prompt-presets"){
        if(method==="GET"){gets++;return json({settings:server,updatedAt});}
        const body=route.request().postDataJSON() as any;
        if(mode==="server-error"){serverErrorKeys.push(route.request().headers()["idempotency-key"]??"");return json({error:"temporary failure"},500);}
        if(mode==="lost-response"){
          lostResponseKeys.push(route.request().headers()["idempotency-key"]??"");
          if(!server.presets.some(item=>item.id==="response-lost")){server=body.settings;updatedAt=new Date(Date.now()+puts++).toISOString();}
          return route.abort("failed");
        }
        if(body.baseUpdatedAt!==updatedAt)return json({code:"PROMPT_PRESETS_STALE",message:"stale"},409);
        server=body.settings;updatedAt=new Date(Date.now()+puts++).toISOString();return json({settings:server,updatedAt});
      }
      if(pathname==="/api/tasks")return json({tasks:[],partial:false,warnings:[]});
      if(pathname==="/api/projects")return json({projects:[{id:"project",name:"Project",enabled:true,error:null}]});
      if(pathname==="/api/workspaces"||pathname==="/api/location-options")return json({projects:[{id:"project",name:"Project",enabled:true,error:null}],workspaces:[workspace]});
      if(pathname==="/api/hosts")return json({hosts:[{id:"local",type:"local",displayName:"Local",platform:"linux",architecture:"x64",status:"online",capabilities:{}}]});
      if(pathname==="/api/providers/codex/models")return json({catalog:{models:[],permissions:[]}});
      if(pathname==="/api/providers/claude/permissions")return json({permissions:[{id:":read-only"}],models:[],efforts:[],catalog:{models:[]}});
      if(pathname==="/api/collaborations")return json({collaborations:[]});
      if(pathname==="/api/quota-reservations")return json({reservations:[]});
      if(pathname==="/api/provider-connections"||pathname==="/api/provider-connections/attempts")return json({singleUser:true,accounts:[],attempts:[]});
      if(pathname==="/api/quota")return json({claude:{},codex:{}});
      if(pathname==="/api/emotion")return json({state:null,codexState:null,outfits:[]});
      if(pathname==="/api/approvals")return json({approvals:[],capabilities:{codex:true,claude:false},checkedAt:now});
      if(pathname==="/api/user-input")return json({requests:[],capabilities:{codex:true,claude:false},checkedAt:now});
      if(pathname==="/api/bootstrap/owner-claim/status")return json({required:false});
      if(pathname.startsWith("/api/system-settings/"))return json({settings:null,candidates:{claude:[],codex:[]}});
      return json({});
    });
    const page=await context.newPage();await page.goto("/");
    await expect(page.getByRole("button",{name:"작업 생성"})).toBeVisible();
    await expect.poll(()=>gets,{timeout:15000}).toBeGreaterThan(previousGets);
    await expect.poll(()=>server.presets.length,{timeout:15000}).toBe(mode==="lost-response"?3:mode==="server-error"?2:1);
    await page.getByRole("button",{name:"작업 생성"}).click();
    await expect(page.getByText(mode==="conflict"?"이 기기 프리셋":mode==="lost-response"?"응답 유실 복구":mode==="server-error"?"서버 오류 로컬":"기존 프리셋")).toBeVisible();
    return page;
  }
  try{
    const desktop=await device({width:1280,height:900},"legacy");
    await device({width:360,height:800});
    await device({width:800,height:1280});
    expect(puts).toBe(1);
    const conflict=await device({width:412,height:915},"conflict");
    await expect(conflict.getByText("이 기기와 서버의 프리셋 값이 다릅니다.")).toBeVisible();
    await conflict.getByRole("button",{name:"병합 후 저장"}).click();
    await expect.poll(()=>server.presets.length).toBe(2);
    expect(server.presets.map(item=>item.id)).toEqual(["legacy-one","local-one"]);
    expect(puts).toBe(2);
    const beforeRefresh=gets;
    await desktop.bringToFront();
    expect(await desktop.evaluate(()=>document.visibilityState)).toBe("visible");
    await desktop.evaluate(()=>document.dispatchEvent(new Event("visibilitychange")));
    await expect.poll(()=>gets).toBeGreaterThan(beforeRefresh);
    await expect.poll(()=>desktop.evaluate(()=>localStorage.getItem("deck-prompt-presets"))).toContain("local-one");
    await expect(desktop.getByText("이 기기 프리셋")).toBeVisible();
    const failed=await device({width:393,height:852},"server-error");
    await expect(failed.getByText("이 기기와 서버의 프리셋 값이 다릅니다.")).toBeVisible();
    expect(serverErrorKeys).toHaveLength(1);
    await failed.getByRole("button",{name:"서버 값 사용"}).click();
    const recovered=await device({width:390,height:844},"lost-response");
    await expect(recovered.getByText("이 기기와 서버의 프리셋 값이 다릅니다.")).toHaveCount(0);
    expect(lostResponseKeys).toHaveLength(2);
    expect(new Set(lostResponseKeys).size).toBe(1);
    expect(lostResponseKeys[0]).toMatch(/^[0-9a-f-]{36}$/);
  }finally{await Promise.all(contexts.map(context=>context.close()));}
});
