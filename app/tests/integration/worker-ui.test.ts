import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach,describe,expect,it } from "vitest";
import { startWorkerUi } from "../../src/server/desktop-worker/ui.js";

let closeUi:(()=>Promise<void>)|null=null,temporary:string|null=null;
const previousHome=process.env.CLAUDEX_WORKHOUSE_WORKER_HOME;
afterEach(async()=>{await closeUi?.();closeUi=null;if(temporary)fs.rmSync(temporary,{recursive:true,force:true});temporary=null;if(previousHome===undefined)delete process.env.CLAUDEX_WORKHOUSE_WORKER_HOME;else process.env.CLAUDEX_WORKHOUSE_WORKER_HOME=previousHome;});

describe("Desktop Worker local UI",()=>{
  it("binds to loopback, requires its token, and manages a local root",async()=>{
    temporary=fs.mkdtempSync(path.join(os.tmpdir(),"claudex-workhouse-worker-ui-"));process.env.CLAUDEX_WORKHOUSE_WORKER_HOME=path.join(temporary,"home");const root=path.join(temporary,"projects");fs.mkdirSync(root);
    const ui=await startWorkerUi(false,false);closeUi=ui.close;const pageUrl=new URL(ui.url),token=pageUrl.searchParams.get("token")!;
    expect(pageUrl.hostname).toBe("127.0.0.1");
    const page=await fetch(ui.url);expect(page.status).toBe(200);expect(await page.text()).toContain("Claudex Workhouse Desktop Worker");expect(page.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    const stateUrl=new URL("/api/state",ui.url);expect((await fetch(stateUrl)).status).toBe(403);
    const headers={"content-type":"application/json","x-claudex-workhouse-ui-token":token};
    const added=await fetch(new URL("/api/roots",ui.url),{method:"POST",headers,body:JSON.stringify({path:root,displayName:"Projects"})});expect(added.status).toBe(200);
    const state=await (await fetch(stateUrl,{headers})).json() as any;expect(state.roots).toHaveLength(1);expect(state.roots[0]).toMatchObject({displayName:"Projects",canonicalPath:root});expect(state.config).not.toHaveProperty("credential");
  });
});
