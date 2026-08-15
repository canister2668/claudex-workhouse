import{expect,test,type Page}from"@playwright/test";

const now="2026-07-29T12:00:00.000Z",workspace={id:"workspace",projectId:"project",hostId:"local",displayName:"Workspace",canonicalPath:"/workspace"};
const task:any={id:"claude:pr-fixture",provider:"claude",nativeId:"pr-fixture",threadId:"thread-pr",projectId:"project",title:"Fix mobile sharing",prompt:"implement sharing",status:"completed",createdAt:now,updatedAt:now,result:"Implemented secure mobile sharing.",error:null,log:"",owned:true,ownership:"claudex-workhouse",source:"claudex-workhouse",executionHostId:"local",workspaceId:"workspace",metadata:{}};

async function fixture(page:Page,options:{share?:boolean;pr?:boolean}={}){
  await page.addInitScript(()=>{localStorage.setItem("claudex-ui-locale","ko");class QuietEventSource{constructor(_url:string){}addEventListener(){}close(){}};(globalThis as any).EventSource=QuietEventSource;});
  let taskPosts=0,prBody:any=null;
  await page.route("**/api/**",async route=>{
    const url=new URL(route.request().url()),pathname=decodeURIComponent(url.pathname),method=route.request().method(),json=(value:unknown,status=200)=>route.fulfill({status,contentType:"application/json",body:JSON.stringify(value)});
    if(pathname==="/api/share-target/11111111-1111-4111-8111-111111111111")return json({title:"공유 제목",text:"공유한 짧은 설명",url:"https://example.test/article",files:[{path:"/data/uploads/shared.png",name:"shared.png",size:1234}]});
    if(pathname==="/api/tasks/claude/claude:pr-fixture/pull-request/preview")return json({preview:{repository:"owner/repo",remote:"origin",branch:"feature/share",base:"main",upstream:"origin/feature/share",pushed:true,ahead:0,behind:0,dirty:true,changedFiles:["src/share.ts"],existingUrl:null,eligible:true},pullRequestUrl:null});
    if(pathname==="/api/tasks/claude/claude:pr-fixture/pull-request"&&method==="POST"){prBody=route.request().postDataJSON();return json({url:"https://github.com/owner/repo/pull/7",reused:false,task:{...task,metadata:{pullRequestUrl:"https://github.com/owner/repo/pull/7"}}});}
    if(pathname==="/api/tasks"&&method==="POST"){taskPosts++;return json({});}
    if(pathname==="/api/tasks")return json({tasks:options.pr?[task]:[],partial:false,warnings:[]});
    if(pathname==="/api/tasks/claude/claude:pr-fixture/events")return json({events:[{type:"file_change_completed",status:"completed",content:"src/share.ts",timestamp:now,sequence:1,metadata:{path:"src/share.ts",changes:[]}},{type:"command_completed",status:"completed",timestamp:now,sequence:2,content:"pnpm test",metadata:{command:"pnpm test",exitCode:0,changes:[]}}],latestSequence:2,status:"completed"});
    if(pathname==="/api/projects")return json({projects:[{id:"project",name:"Project",enabled:true,error:null}]});
    if(pathname==="/api/workspaces"||pathname==="/api/location-options")return json({projects:[{id:"project",name:"Project",enabled:true,error:null}],workspaces:[workspace]});
    if(pathname==="/api/hosts")return json({hosts:[{id:"local",type:"local",displayName:"Local",platform:"linux",architecture:"x64",status:"online",capabilities:{}}]});
    if(pathname==="/api/providers/codex/models")return json({catalog:{models:[],permissions:[]}});
    if(pathname==="/api/providers/claude/permissions")return json({permissions:[{id:":read-only"}],models:[],efforts:[],catalog:{models:[]}});
    if(pathname==="/api/collaborations")return json({collaborations:[]});
    if(pathname==="/api/quota-reservations")return json({reservations:[]});
    if(pathname==="/api/provider-connections"||pathname==="/api/provider-connections/attempts")return json({singleUser:true,accounts:[{provider:"codex",state:"connected",accountType:"chatgpt",planType:null,emailMasked:null,errorCategory:null,checkedAt:new Date().toISOString()},{provider:"claude",state:"connected",accountType:"claude.ai",planType:null,emailMasked:null,errorCategory:null,checkedAt:new Date().toISOString()}],attempts:[]});
    if(pathname==="/api/quota")return json({claude:{},codex:{}});
    if(pathname==="/api/emotion")return json({state:null,codexState:null,outfits:[]});
    if(pathname==="/api/approvals")return json({approvals:[],capabilities:{codex:true,claude:false},checkedAt:now});
    if(pathname==="/api/user-input")return json({requests:[],capabilities:{codex:true,claude:false},checkedAt:now});
    if(pathname==="/api/bootstrap/owner-claim/status")return json({required:false});
    if(pathname.startsWith("/api/system-settings/"))return json({settings:null,candidates:{claude:[],codex:[]}});
    return json({});
  });
  return{taskPosts:()=>taskPosts,prBody:()=>prBody};
}

test("native share target prefills text and existing attachments without auto-running",async({page})=>{
  const state=await fixture(page,{share:true});
  await page.goto("/?share=11111111-1111-4111-8111-111111111111");
  const dialog=page.getByRole("dialog",{name:"새 작업"});
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("요청")).toHaveValue("공유 제목\n\n공유한 짧은 설명\n\nhttps://example.test/article");
  await expect(dialog.getByText("shared.png")).toBeVisible();
  expect(state.taskPosts()).toBe(0);
  expect(new URL(page.url()).search).toBe("");
});

test("new task dialog survives a drag from inside the modal onto its backdrop",async({page})=>{
  await fixture(page);
  await page.setViewportSize({width:412,height:915});
  await page.goto("/");
  await page.getByRole("button",{name:"작업 생성"}).click();
  const dialog=page.getByRole("dialog",{name:"새 작업"}),backdrop=dialog.locator("..");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("요청").fill("드래그 중 입력 보존");
  const [dialogBox,backdropBox]=await Promise.all([dialog.boundingBox(),backdrop.boundingBox()]);
  await page.mouse.move(dialogBox!.x+dialogBox!.width/2,dialogBox!.y+20);
  await page.mouse.down();
  await page.mouse.move(backdropBox!.x+8,backdropBox!.y+8,{steps:5});
  await page.mouse.up();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("요청")).toHaveValue("드래그 중 입력 보존");
  await backdrop.click({position:{x:8,y:8}});
  await expect(dialog).toBeHidden();
});

test("PR draft shows preflight and requires an explicit final confirmation",async({page})=>{
  const state=await fixture(page,{pr:true});
  await page.goto("/");
  await page.getByText("Fix mobile sharing").click();
  await page.getByRole("button",{name:"PR 만들기"}).click();
  const dialog=page.getByRole("dialog",{name:"Pull Request 만들기"});
  await expect(dialog).toContainText("feature/share");
  await expect(dialog).toContainText("origin/feature/share");
  await expect(dialog.getByLabel("본문")).toHaveValue(/Implemented secure mobile sharing/);
  const create=dialog.getByRole("button",{name:"PR 생성"});
  await expect(create).toBeDisabled();
  await dialog.getByLabel("지금 GitHub에 PR을 실제로 생성합니다.").check();
  await create.click();
  await expect(dialog.getByRole("button",{name:"PR 열기"})).toBeVisible();
  expect(state.prBody()).toMatchObject({title:"Fix mobile sharing",base:"main",confirm:true,draft:false});
});
