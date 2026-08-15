import {expect,test} from "@playwright/test";

test("workspace editor cancel and save actions stay aligned",async({page})=>{
  await page.addInitScript(()=>{
    localStorage.setItem("claudex-ui-locale","ko");
    class SilentEventSource{constructor(public url:string){}addEventListener(){}close(){}}
    Object.defineProperty(globalThis,"EventSource",{value:SilentEventSource,configurable:true});
  });
  const now=new Date().toISOString(),entry={id:"file-app",name:"App.ts",type:"file",size:29,modifiedAt:now,sensitive:false,relativePath:"src/App.ts"};
  await page.route("**/api/**",async route=>{
    const url=new URL(route.request().url()),pathname=url.pathname,json=(value:unknown)=>route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(value)});
    if(pathname==="/api/bootstrap/owner-claim/status")return json({required:false});
    if(pathname==="/api/system-settings/locale")return json({locale:"ko",saved:true,existingInstallation:true});
    if(pathname==="/api/tasks")return json({tasks:[],partial:false,warnings:[]});
    if(pathname==="/api/projects")return json({projects:[{id:"project",name:"Project",enabled:true,error:null}]});
    if(pathname==="/api/hosts")return json({hosts:[{id:"local",displayName:"Local",status:"online"}]});
    if(pathname==="/api/workspaces")return json({workspaces:[{id:"workspace-local",projectId:"project",hostId:"local",rootId:"root",displayName:"Workspace",canonicalPath:"/workspace",workspaceType:"existing"}]});
    if(pathname==="/api/workspaces/workspace-local/files")return json({current:{id:"root",name:"Workspace",type:"directory",relativePath:"."},entries:[entry]});
    if(pathname==="/api/workspaces/workspace-local/files/resolve")return json({entry});
    if(pathname==="/api/workspaces/workspace-local/files/read")return json({relativePath:"src/App.ts",size:29,modifiedAt:now,sensitive:false,requiresConfirmation:false,binary:false,content:"export const mobile = false;\n",offset:0,nextOffset:null});
    if(pathname==="/api/workspaces/workspace-local/files/edit/read")return json({fileId:entry.id,relativePath:"src/App.ts",content:"export const mobile = false;\n",revision:"revision-1",lineEnding:"lf",hasUtf8Bom:false,endsWithNewline:true,modifiedAt:now,byteLength:29});
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
  await expect(viewer.locator(".file-more>summary")).toHaveCSS("align-items","center");
  const headingTitle=viewer.locator(".file-heading > strong"),headingActions=viewer.locator(".file-primary-actions");
  const [titleRect,actionsRect]=await Promise.all([headingTitle,headingActions].map(element=>element.evaluate(node=>{const rect=node.getBoundingClientRect();return{top:rect.top,bottom:rect.bottom,width:rect.width};})));
  expect(actionsRect.top).toBeGreaterThanOrEqual(titleRect.bottom);
  expect(actionsRect.width).toBeGreaterThanOrEqual(titleRect.width-1);
  const actionWidths=await headingActions.locator(":scope > button, :scope > details > summary").evaluateAll(elements=>elements.map(element=>element.getBoundingClientRect().width));
  expect(actionWidths).toHaveLength(3);
  expect(Math.max(...actionWidths)-Math.min(...actionWidths)).toBeLessThanOrEqual(1);
  await viewer.getByRole("button",{name:"수정기",exact:true}).click();
  const cancel=viewer.getByRole("button",{name:"취소",exact:true}),save=viewer.getByRole("button",{name:"저장",exact:true});
  await expect(cancel).toBeVisible();await expect(save).toBeVisible();
  const [cancelRect,saveRect]=await Promise.all([cancel,save].map(button=>button.evaluate(element=>{const rect=element.getBoundingClientRect();return{top:rect.top,height:rect.height};})));
  expect(cancelRect).toEqual(saveRect);
  expect(cancelRect.height).toBe(44);
});
