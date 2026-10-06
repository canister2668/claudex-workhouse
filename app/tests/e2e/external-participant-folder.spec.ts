import {expect,test} from "@playwright/test";

test("collaboration folder setup suggests three documentation mounts and one outbox on mobile",async({page})=>{
  test.setTimeout(60_000);
  await page.addInitScript(()=>localStorage.setItem("claudex-ui-locale","ko"));
  const token=`whp_${"a".repeat(43)}`;
  let grantBody:any=null,storedToken="";
  const json=(route:any,value:unknown)=>route.fulfill({contentType:"application/json",body:JSON.stringify(value)});
  await page.route("**/api/**",async route=>{
    const pathname=new URL(route.request().url()).pathname,method=route.request().method();
    if(pathname==="/api/external-participants/grants"){
      if(method==="POST"){grantBody=route.request().postDataJSON();return json(route,{grant:{id:"70e9b5b6-d65f-40f1-8f5e-94a0cc9ad27c",...grantBody,revokedAt:null},token});}
      return json(route,{grants:[],updatedAt:null});
    }
    if(pathname==="/api/external-participants/tunnel-token"&&method==="PUT"){
      storedToken=route.request().postDataJSON().participantToken;return json(route,{participantTokenConfigured:true});
    }
    if(pathname==="/api/external-participants/tunnel-status")return json(route,{runtimeKeyConfigured:false,participantTokenConfigured:Boolean(storedToken)});
    if(pathname==="/api/workspaces")return json(route,{workspaces:[
      {id:"wh",projectId:"claudex-workhouse",hostId:"local",displayName:"Workhouse",canonicalPath:"/workhouse"},
      {id:"risu",projectId:"risuai",hostId:"local",displayName:"RisuAI",canonicalPath:"/risu"},
      {id:"nai",projectId:"nai-studio",hostId:"local",displayName:"NAI Studio",canonicalPath:"/nai"}
    ]});
    if(pathname==="/api/infrastructure/overview")return json(route,{server:{id:"local",displayName:"NAS",roles:["main-server"],platform:"linux",architecture:"x64",appVersion:"1.0.3",connectionStatus:"online",healthStatus:"healthy"},executionHosts:[]});
    if(pathname==="/api/tasks")return json(route,{tasks:[],partial:false,warnings:[]});
    if(pathname==="/api/projects")return json(route,{projects:[{id:"claudex-workhouse",name:"Workhouse",enabled:true}]});
    if(pathname==="/api/hosts")return json(route,{hosts:[]});
    if(pathname==="/api/provider-connections")return json(route,{singleUser:true,accounts:[],attempts:[]});
    if(pathname==="/api/provider-connections/attempts")return json(route,{attempts:[]});
    if(pathname==="/api/emotion")return json(route,{state:null,taskStates:{},assets:{},mode:"catch"});
    if(pathname==="/api/collaborations")return json(route,{collaborations:[]});
    if(pathname==="/api/conversation-documents")return json(route,{documents:[]});
    if(pathname==="/api/quota-reservations")return json(route,{reservations:[]});
    if(pathname==="/api/quota")return json(route,{claude:{},codex:{},fetchedAt:new Date().toISOString()});
    if(pathname==="/api/push")return json(route,{preferences:{},publicKey:""});
    if(pathname==="/api/setup")return json(route,{required:false});
    if(pathname==="/api/providers/codex/models")return json(route,{catalog:{models:[],permissions:[]}});
    if(pathname==="/api/providers/claude/permissions"||pathname.includes("/models"))return json(route,{permissions:[],models:[],efforts:[],catalog:{models:[]}});
    if(pathname.startsWith("/api/system-settings/"))return json(route,pathname.endsWith("locale")?{locale:"ko",saved:true}:{settings:null});
    return json(route,{});
  });
  await page.goto("/",{waitUntil:"domcontentloaded"});
  const more=page.getByRole("button",{name:"추가 작업",exact:true});if(await more.isVisible())await more.click();
  await page.getByRole("button",{name:"설정 열기",exact:true}).click();
  const settings=page.getByRole("region",{name:"설정"});
  await settings.getByRole("button",{name:"외부 참여자",exact:true}).click();
  const folder=settings.getByRole("region",{name:"외부 모델 협업 폴더"});
  await expect(folder).toBeVisible();
  await expect(folder.locator("fieldset")).toHaveCount(4);
  await folder.getByRole("button",{name:"협업 권한 만들기"}).click();
  await expect.poll(()=>storedToken).toBe(token);
  expect(grantBody.workspaceId).toBe("wh");
  expect(grantBody.execution).toBeUndefined();
  expect(grantBody.mounts.map((mount:any)=>[mount.alias,mount.workspaceId,mount.rootPath,mount.writePaths])).toEqual([
    ["workhouse","wh","docs",[]],["risu","risu","docs",[]],["nai","nai","docs",[]],["shared","wh","data/collaboration",["outbox"]]
  ]);
  expect(await folder.evaluate(element=>element.scrollWidth-element.clientWidth)).toBeLessThanOrEqual(0);
  await folder.getByRole("checkbox",{name:"dot 등 외부 모델의 실행 작업 제출 허용"}).check();
  await folder.getByRole("combobox",{name:"실행 제공자",exact:true}).selectOption("claude");
  await folder.getByRole("button",{name:"협업 권한 만들기"}).click();
  await expect.poll(()=>grantBody?.execution).toEqual({provider:"claude",automationLevel:"auto",maxActiveTasks:1});
  expect(await folder.evaluate(element=>element.scrollWidth-element.clientWidth)).toBeLessThanOrEqual(0);
});
