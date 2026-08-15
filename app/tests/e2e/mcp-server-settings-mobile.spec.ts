import {expect,test} from "@playwright/test";

test("external MCP settings fit mobile and save a read-only remote server",async({page})=>{
  test.setTimeout(60_000);
  await page.addInitScript(()=>{
    localStorage.setItem("claudex-ui-locale","ko");
    class SilentEventSource{onerror:null|(()=>void)=null;constructor(public url:string){}addEventListener(){}close(){}}
    Object.defineProperty(globalThis,"EventSource",{value:SilentEventSource,configurable:true});
  });
  let saved:any=null;
  await page.route("**/api/**",async route=>{
    const path=new URL(route.request().url()).pathname,json=(value:unknown)=>route.fulfill({contentType:"application/json",body:JSON.stringify(value)});
    if(path==="/api/system-settings/mcp-servers"){
      if(route.request().method()==="PUT")saved=route.request().postDataJSON();
      const servers=saved?.settings?.servers??[];
      return json({settings:{version:1,servers:servers.map((server:any)=>({...server,secret:undefined,secretConfigured:Boolean(server.secret)}))},providerSupport:{claude:true,codex:true,deepseek:true,ollama:true,antigravity:true,grok:false},updatedAt:"2026-08-11T12:00:00.000Z"});
    }
    if(path==="/api/tasks")return json({tasks:[],partial:false,warnings:[]});
    if(path==="/api/projects")return json({projects:[{id:"project",name:"Project",enabled:true}]});
    if(path==="/api/hosts")return json({hosts:[{id:"local",displayName:"Local",status:"online"}]});
    if(path==="/api/workspaces")return json({workspaces:[{id:"workspace",projectId:"project",hostId:"local",displayName:"Project",canonicalPath:"/workspace"}]});
    if(path==="/api/provider-connections")return json({singleUser:true,accounts:[],attempts:[]});
    if(path==="/api/provider-connections/attempts")return json({attempts:[]});
    if(path==="/api/emotion")return json({state:null,taskStates:{},assets:{},mode:"catch"});
    if(path==="/api/collaborations")return json({collaborations:[]});
    if(path==="/api/conversation-documents")return json({documents:[]});
    if(path==="/api/quota-reservations")return json({reservations:[]});
    if(path==="/api/quota")return json({claude:{},codex:{},fetchedAt:new Date().toISOString()});
    if(path==="/api/push")return json({preferences:{},publicKey:""});
    if(path==="/api/setup")return json({required:false});
    if(path==="/api/providers/codex/models")return json({catalog:{models:[],permissions:[]}});
    if(path==="/api/providers/claude/permissions"||path.includes("/models"))return json({permissions:[],models:[],efforts:[],catalog:{models:[]}});
    if(path.startsWith("/api/system-settings/"))return json(path.endsWith("locale")?{locale:"ko",saved:true}:{settings:null});
    return json({});
  });

  await page.goto("/",{waitUntil:"domcontentloaded"});
  const more=page.getByRole("button",{name:"추가 작업",exact:true});
  if(await more.isVisible())await more.click();
  await page.getByRole("button",{name:"설정 열기",exact:true}).click();
  const settings=page.getByRole("dialog",{name:"설정"});
  await settings.getByRole("button",{name:"외부 MCP",exact:true}).click();
  await expect(settings.getByRole("heading",{name:"외부 MCP 서버"})).toBeVisible();
  await expect(settings.getByText("Grok은 지원하지 않음",{exact:true})).toBeVisible();
  await settings.getByRole("button",{name:"서버 추가",exact:true}).click();
  await settings.getByLabel("이름").fill("Tavily 검색");
  await settings.getByLabel("MCP 주소").fill("https://mcp.example.com/mcp");
  await settings.getByLabel("이 서버가 읽기 전용 도구만 제공함을 확인합니다").check();
  await settings.getByLabel("Bearer 토큰").fill("test-secret");
  await settings.getByRole("button",{name:"저장",exact:true}).click();
  await expect(settings.getByText("외부 MCP 설정을 저장했습니다.",{exact:true})).toBeVisible();
  expect(saved.settings.servers[0]).toMatchObject({name:"Tavily 검색",url:"https://mcp.example.com/mcp",roles:["default-search"],readOnly:true,secret:"test-secret"});
  expect(await settings.evaluate(element=>element.scrollWidth-element.clientWidth)).toBeLessThanOrEqual(0);
});
