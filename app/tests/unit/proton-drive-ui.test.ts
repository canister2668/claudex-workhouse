import{readFileSync}from"node:fs";
import{join}from"node:path";
import{describe,expect,it}from"vitest";

describe("Proton Drive UI wiring",()=>{
  it("adds a third account tab and keeps uploads behind explicit review",()=>{
    const root=join(process.cwd(),"src/web"),app=readFileSync(join(root,"App.svelte"),"utf8"),dialog=readFileSync(join(root,"ProtonUploadDialog.svelte"),"utf8"),outcome=readFileSync(join(root,"TaskOutcomeSummary.svelte"),"utf8"),server=readFileSync(join(process.cwd(),"src/server/index.ts"),"utf8");
    expect(app).toContain('type StorageTab="artifacts"|"snapshots"|"proton"');expect(readFileSync(join(root,"settings/StoragePage.svelte"),"utf8")).toContain('<ProtonDriveSettings {api}/>');
    expect(dialog).toContain("confirmExternalUpload:true");expect(dialog).toContain("confirmUpload:true");expect(outcome).toContain('task.status==="completed"');expect(server).toContain("!protonDriveResponse");
  });
});
