import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ArtifactRegistry } from "../../src/server/artifact-registry.js";
import { ensureTaskTempDirectory } from "../../src/server/workspace-temp.js";

const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});

describe("ArtifactRegistry",()=>{
  it("records only canonical Workhouse task temp directories and reconciles missing paths",async()=>{
    const root=fs.mkdtempSync(path.join(process.cwd(),".artifact-registry-test-"));roots.push(root);
    const rows:any[]=[];
    const db={
      listManagedArtifacts:async()=>rows.map(item=>({...item})),
      upsertManagedArtifact:async(item:any)=>{const index=rows.findIndex(row=>row.id===item.id);if(index<0)rows.push({...item});else rows[index]={...rows[index],...item};return item;},
      upsertManagedArtifacts:async(items:any[])=>{for(const item of items){const index=rows.findIndex(row=>row.id===item.id);if(index<0)rows.push({...item});else rows[index]={...rows[index],...item};}return items.length;}
    } as any;
    const task={id:"codex:deck:test",provider:"codex",projectId:"project",workspaceId:"workspace",executionHostId:"local",owned:true,ownership:"claudex-workhouse",createdAt:"2026-08-05T00:00:00.000Z",metadata:{tempDirectory:ensureTaskTempDirectory(root,"workspace","codex","codex:deck:test")}} as any;
    const workspace={id:"workspace",displayName:"RisuAI",hostId:"local"} as any;
    const registry=new ArtifactRegistry(db,root);
    const first=await registry.reconcile([task],[workspace]);
    expect(first.summary).toMatchObject({total:1,present:1,missing:0,changed:0});
    expect(first.entries[0]).toMatchObject({workspaceName:"RisuAI",kind:"task-temp",status:"present"});
    expect(first.entries[0]).not.toHaveProperty("path");
    fs.rmSync(task.metadata.tempDirectory,{recursive:true,force:true});
    const second=await registry.reconcile([task],[workspace]);
    expect(second.summary).toMatchObject({total:1,present:0,missing:1,changed:0});
  });

  it("ignores a task metadata path outside its issued temp directory",async()=>{
    const root=fs.mkdtempSync(path.join(process.cwd(),".artifact-registry-test-"));roots.push(root);
    const db={listManagedArtifacts:async()=>[],upsertManagedArtifact:async()=>{throw new Error("must not persist");},upsertManagedArtifacts:async()=>{throw new Error("must not persist");}} as any;
    const task={id:"claude:test",provider:"claude",projectId:"project",workspaceId:"workspace",executionHostId:"local",owned:true,ownership:"claudex-workhouse",createdAt:"2026-08-05T00:00:00.000Z",metadata:{tempDirectory:path.join(root,"untrusted")}} as any;
    const result=await new ArtifactRegistry(db,root).reconcile([task],[]);
    expect(result.entries).toEqual([]);
  });
});
