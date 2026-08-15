import {expect,test} from "@playwright/test";

test("new task can be reserved without starting a provider and exposes reservation controls",async({page})=>{
  await page.addInitScript(()=>{
    localStorage.setItem("claudex-ui-locale","ko");
    class QuietEventSource{constructor(_url:string){}addEventListener(){}close(){}}
    (globalThis as any).EventSource=QuietEventSource;
  });
  const now=new Date().toISOString(),resetAt=new Date(Date.now()+60*60_000).toISOString(),workspace={id:"workspace",projectId:"project",hostId:"local",displayName:"Workspace",canonicalPath:"/workspace"};
  let reservation:any=null,startCalls=0;
  await page.route("**/api/**",async route=>{
    const url=new URL(route.request().url()),pathname=url.pathname,method=route.request().method(),json=(value:unknown)=>route.fulfill({contentType:"application/json",body:JSON.stringify(value)});
    if(pathname==="/api/tasks"){if(method==="POST")startCalls++;return json({tasks:[],partial:false,warnings:[]});}
    if(pathname==="/api/quota-reservations"&&method==="POST"){
      const request=route.request().postDataJSON() as any;
      reservation={id:"11111111-1111-4111-8111-111111111111",provider:request.provider,projectId:"project",executionHostId:"local",workspaceId:"workspace",title:request.prompt,status:"waiting-quota",createdAt:now,updatedAt:now,nextCheckAt:resetAt,lastQuotaCheckAt:now,lastQuotaStatus:"five-hour-exhausted",taskId:null,error:null};
      return json({reservation,quota:{fiveHour:{pct:100,resetsAt:resetAt,durationMins:300},sevenDay:{pct:20,resetsAt:null,durationMins:10080},status:"ok"}});
    }
    if(pathname.endsWith("/retry")&&method==="POST"){
      reservation={...reservation,status:"waiting-quota",error:null};
      return json({reservation});
    }
    if(pathname==="/api/quota-reservations")return json({reservations:reservation?[reservation]:[]});
    if(pathname==="/api/projects")return json({projects:[{id:"project",name:"Project",enabled:true,error:null}]});
    if(pathname==="/api/workspaces"||pathname==="/api/location-options")return json({projects:[{id:"project",name:"Project",enabled:true,error:null}],workspaces:[workspace]});
    if(pathname==="/api/hosts")return json({hosts:[{id:"local",type:"local",displayName:"Local",platform:"linux",architecture:"x64",status:"online",capabilities:{}}]});
    if(pathname==="/api/providers/codex/models")return json({catalog:{models:[{id:"gpt-5",displayName:"GPT-5",isDefault:true,supportedReasoningEfforts:[{reasoningEffort:"medium"}],defaultReasoningEffort:"medium",serviceTiers:[]}],permissions:[{id:":read-only"}]}});
    if(pathname==="/api/providers/claude/permissions")return json({permissions:[{id:":read-only"}],models:[{id:"default",displayName:"Default"}],efforts:[{id:"default",displayName:"Default"}],catalog:{models:[]}});
    if(pathname==="/api/collaborations")return json({collaborations:[]});
    if(pathname==="/api/provider-connections")return json({singleUser:true,accounts:[{provider:"codex",state:"connected",accountType:null,planType:null,emailMasked:null,errorCategory:null,checkedAt:now},{provider:"claude",state:"connected",accountType:null,planType:null,emailMasked:null,errorCategory:null,checkedAt:now}]});
    if(pathname==="/api/provider-connections/attempts")return json({attempts:[]});
    if(pathname==="/api/quota")return json({fetchedAt:now,claude:{fiveHour:null,sevenDay:null,status:"partial",error:"unavailable"},codex:{fiveHour:{pct:100,resetsAt:resetAt,durationMins:300},sevenDay:{pct:20,resetsAt:null,durationMins:10080},status:"ok",error:null}});
    if(pathname==="/api/emotion")return json({state:null,codexState:null,outfits:[]});
    if(pathname.startsWith("/api/system-settings/"))return json({settings:null,candidates:{claude:[],codex:[]}});
    return json({});
  });

  await page.goto("/");
  await page.getByRole("button",{name:"작업 생성"}).click();
  await page.getByPlaceholder("수행할 작업을 구체적으로 입력하세요.").fill("한도 회복 뒤 실행");
  await page.getByRole("button",{name:"한도 초기화 후 시작"}).click();
  await expect(page.locator(".quota-reservation-list")).toHaveAttribute("aria-label","한도 회복 대기 작업");
  await expect(page.getByText("한도 회복 뒤 실행")).toBeVisible();
  await expect(page.getByRole("button",{name:"지금 시작"})).toBeVisible();
  await expect(page.getByRole("button",{name:"예약 취소"})).toBeVisible();
  expect(startCalls).toBe(0);

  reservation={...reservation,status:"failed",error:"provider unavailable"};
  await page.goto(`/?reservation=${reservation.id}&view=reservation`);
  const focused=page.locator(`#quota-reservation-${reservation.id}`);
  await expect(focused).toHaveClass(/focused/);
  await focused.getByRole("button",{name:"다시 대기"}).click();
  await expect(focused.getByText("한도 대기")).toBeVisible();
});
