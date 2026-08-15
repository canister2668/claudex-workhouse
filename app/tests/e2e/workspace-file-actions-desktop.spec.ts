import {expect,test} from "@playwright/test";

test("the desktop file heading keeps mode switches together on one row",async({page},testInfo)=>{
  const width=testInfo.project.use.viewport?.width??0;
  test.skip(width<1181,"the flattened action row only exists above the overflow-menu breakpoint");
  await page.addInitScript(()=>{
    localStorage.setItem("claudex-ui-locale","ko");
    class SilentEventSource{constructor(public url:string){}addEventListener(){}close(){}}
    Object.defineProperty(globalThis,"EventSource",{value:SilentEventSource,configurable:true});
  });
  const now=new Date().toISOString(),entry={id:"file-app",name:"workspace-viewer-heading-extremely-long-file-name-for-overflow-check.review.html",type:"file",size:29,modifiedAt:now,sensitive:false,relativePath:"src/App.ts"};
  await page.route("**/api/**",async route=>{
    const pathname=new URL(route.request().url()).pathname,json=(value:unknown)=>route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(value)});
    if(pathname==="/api/bootstrap/owner-claim/status")return json({required:false});
    if(pathname==="/api/system-settings/locale")return json({locale:"ko",saved:true,existingInstallation:true});
    if(pathname==="/api/tasks")return json({tasks:[],partial:false,warnings:[]});
    if(pathname==="/api/projects")return json({projects:[{id:"project",name:"Project",enabled:true,error:null}]});
    if(pathname==="/api/hosts")return json({hosts:[{id:"local",displayName:"Local",status:"online"}]});
    if(pathname==="/api/workspaces")return json({workspaces:[{id:"workspace-local",projectId:"project",hostId:"local",rootId:"root",displayName:"Workspace",canonicalPath:"/workspace",workspaceType:"existing"}]});
    if(pathname==="/api/workspaces/workspace-local/files")return json({current:{id:"root",name:"Workspace",type:"directory",relativePath:"."},entries:[entry]});
    if(pathname==="/api/workspaces/workspace-local/files/resolve")return json({entry});
    if(pathname==="/api/workspaces/workspace-local/files/read")return json({relativePath:"src/App.ts",size:29,modifiedAt:now,sensitive:false,requiresConfirmation:false,binary:false,content:"export const tablet = true;\n",offset:0,nextOffset:null});
    if(pathname==="/api/collaborations")return json({collaborations:[]});
    if(pathname==="/api/provider-connections"||pathname==="/api/provider-connections/attempts")return json({accounts:[],attempts:[]});
    if(pathname==="/api/quota")return json({claude:{},codex:{},fetchedAt:now});
    if(pathname==="/api/emotion")return json({state:{},codexState:{},outfits:[],assets:[],mode:"catch"});
    if(pathname==="/api/push")return json({preferences:{},publicKey:""});
    return json({});
  });
  await page.goto("/?view=file&workspace=workspace-local&path=src%2FApp.ts");
  const viewer=page.locator(".viewer-dialog .viewer");
  await expect(viewer).toBeVisible();
  // The mode switches belong together. They were split by 자동 줄바꿈 and 경로 복사
  // because 뷰어 lived in the overflow sheet while 수정기 sat outside it, and the
  // sheet flattens into the same row on a desktop width.
  const labels=await viewer.locator(".file-heading button, .file-heading a.file-action").evaluateAll(els=>els.map(e=>(e.textContent||"").trim()));
  expect(labels.indexOf("뷰어")).toBe(labels.indexOf("수정기")+1);
  // A long name must be elided rather than pushing the last control onto its own row.
  const rows=await viewer.locator(".file-heading button, .file-heading a.file-action").evaluateAll(els=>new Set(els.map(e=>Math.round(e.getBoundingClientRect().top))).size);
  expect(rows).toBe(1);
  await expect(viewer.locator(".file-heading > strong")).toHaveCSS("text-overflow","ellipsis");
});
