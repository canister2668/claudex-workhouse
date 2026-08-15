import fs from "node:fs";
import path from "node:path";
import { afterEach,describe,expect,it } from "vitest";
import { discoverRuntimeTempRoots } from "../../src/server/runtime-temp-storage.js";
import { workspaceTempRoot } from "../../src/server/workspace-temp.js";

const roots:string[]=[];
const temporary=()=>{
  const value=fs.mkdtempSync(path.join(process.cwd(),".runtime-temp-test-"));
  roots.push(value);
  return value;
};

afterEach(()=>{for(const value of roots.splice(0))fs.rmSync(value,{recursive:true,force:true});});

describe("runtime temporary storage discovery",()=>{
  it("discovers dedicated TMP roots declared by runtimes linked to registered workspaces",()=>{
    const primary=temporary(),external=temporary(),workspace=temporary();
    const roots=discoverRuntimeTempRoots(primary,[{id:"risu",displayName:"RisuAI",canonicalPath:workspace,hostId:"local"}],{
      serviceUid:process.getuid?.()??-1,
      candidates:[{pid:123,tempRoot:external,locations:[workspace],command:"node app-server-broker --cwd "+workspace}]
    });
    expect(roots).toHaveLength(2);
    expect(roots.find(item=>item.root===external)).toMatchObject({
      source:"workspace-runtime",
      managedRoot:true,
      workspaces:[{id:"risu",displayName:"RisuAI",canonicalPath:workspace}]
    });
  });

  it("ignores unrelated processes and runtime paths not linked to a registered workspace",()=>{
    const primary=temporary(),external=temporary(),workspace=temporary(),other=temporary();
    const roots=discoverRuntimeTempRoots(primary,[{id:"workspace",displayName:"Workspace",canonicalPath:workspace,hostId:"local"}],{
      serviceUid:process.getuid?.()??-1,
      candidates:[
        {pid:1,tempRoot:external,locations:[other],command:"node app-server-broker"},
        {pid:2,tempRoot:external,locations:[workspace],command:"postgres"}
      ]
    });
    expect(roots.map(item=>item.root)).toEqual([primary]);
  });

  it("deduplicates one runtime root shared by multiple workspace processes",()=>{
    const primary=temporary(),external=temporary(),first=temporary(),second=temporary();
    const workspaces=[
      {id:"first",displayName:"First",canonicalPath:first,hostId:"local"},
      {id:"second",displayName:"Second",canonicalPath:second,hostId:"local"}
    ];
    const roots=discoverRuntimeTempRoots(primary,workspaces,{
      serviceUid:process.getuid?.()??-1,
      candidates:[
        {pid:1,tempRoot:external,locations:[first],command:"codex app-server"},
        {pid:2,tempRoot:external,locations:[second],command:"claude"}
      ]
    });
    expect(roots.find(item=>item.root===external)?.workspaces.map(item=>item.id).sort()).toEqual(["first","second"]);
  });

  it("does not register task directories nested below the Workhouse root as separate runtimes",()=>{
    const primary=temporary(),workspace=temporary(),nested=path.join(primary,"task-current");
    fs.mkdirSync(nested);
    const roots=discoverRuntimeTempRoots(primary,[{id:"workspace",displayName:"Workspace",canonicalPath:workspace,hostId:"local"}],{
      serviceUid:process.getuid?.()??-1,
      candidates:[{pid:1,tempRoot:nested,locations:[workspace],command:"codex app-server"}]
    });
    expect(roots.map(item=>item.root)).toEqual([primary]);
  });

  it("keeps a previously discovered dedicated root after its runtime exits",()=>{
    const primary=temporary(),external=temporary(),workspace=temporary();
    const roots=discoverRuntimeTempRoots(primary,[{id:"workspace",displayName:"Workspace",canonicalPath:workspace,hostId:"local"}],{
      serviceUid:process.getuid?.()??-1,
      candidates:[],
      knownRoots:[{root:external,workspaceIds:["workspace"]}]
    });
    expect(roots.find(item=>item.root===external)).toMatchObject({source:"workspace-runtime",workspaces:[{id:"workspace"}]});
  });

  it("registers an existing Workhouse-managed workspace namespace",()=>{
    const primary=temporary(),workspace=temporary(),managed=workspaceTempRoot(primary,"workspace");
    fs.mkdirSync(managed,{recursive:true});
    const roots=discoverRuntimeTempRoots(primary,[{id:"workspace",displayName:"Workspace",canonicalPath:workspace,hostId:"local"}],{serviceUid:process.getuid?.()??-1,candidates:[]});
    expect(roots.find(item=>item.root===managed)).toMatchObject({source:"workspace-managed",managedRoot:true,workspaces:[{id:"workspace"}]});
  });
});
