import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApplicationUpdateCoordinator,
  applicationUpdateBlockers,
  compareApplicationVersions,
  evaluateApplicationUpdate,
  normalizeApplicationInstallMetadata,
  writeApplicationUpdateRequest,
  type ApplicationUpdateAttempt,
  type ApplicationUpdateStore
} from "../../src/server/application-updates.js";
import type { VerifiedRelease } from "../../src/server/deployment/release-manifest.js";
import { reconcileApplicationUpdateResults } from "../../src/server/application-update-results.js";

const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});

function installed(overrides:Record<string,unknown>={}){
  return normalizeApplicationInstallMetadata({version:"1.0.0",installMethod:"docker-compose",platform:"linux",architecture:"x64",imageDigest:`sha256:${"a".repeat(64)}`,updaterProtocolVersion:1,...overrides});
}
function release(version="1.1.0"):VerifiedRelease{
  const portable="claudex-workhouse-server-windows-x64-portable.zip";
  return{manifest:{schemaVersion:3,channel:"stable",version,releaseSequence:2,publishedAt:"2026-08-01T00:00:00.000Z",expiresAt:"2026-11-01T00:00:00.000Z",server:{image:"ghcr.io/example/workhouse",tag:version,digest:`sha256:${"b".repeat(64)}`,platforms:["linux/amd64","linux/arm64"],minimumUpdaterProtocolVersion:1},windowsServer:{platform:"windows",architecture:"x64",format:"exe",filename:"server.exe",url:"https://example.test/server.exe",size:1,sha256:"c".repeat(64),authenticode:{status:"unsigned"}},windowsPortable:{platform:"windows",architecture:"x64",format:"zip",filename:portable,url:`https://example.test/${portable}`,size:10,sha256:"d".repeat(64),minimumUpdaterProtocolVersion:1},workers:{"windows-x64":{platform:"windows",architecture:"x64",format:"zip",filename:"worker.zip",url:"https://example.test/worker.zip",size:1,sha256:"e".repeat(64),entrypoint:"worker",launcher:"start",minimumUpdaterProtocolVersion:1},"linux-x64":{platform:"linux",architecture:"x64",format:"tar.gz",filename:"worker-x64.tar.gz",url:"https://example.test/worker-x64.tar.gz",size:1,sha256:"f".repeat(64),entrypoint:"worker",minimumUpdaterProtocolVersion:1},"linux-arm64":{platform:"linux",architecture:"arm64",format:"tar.gz",filename:"worker-arm64.tar.gz",url:"https://example.test/worker-arm64.tar.gz",size:1,sha256:"1".repeat(64),entrypoint:"worker",minimumUpdaterProtocolVersion:1}},requirements:{docker:">=24.0.0",compose:">=2.20.0"},signing:{keyId:"test",algorithm:"rsa-sha256"}},manifestUrl:"https://example.test/stable/release-manifest.json",signatureUrl:"https://example.test/stable/release-manifest.json.sig",manifestSha256:"2".repeat(64),keyId:"test",signingPublicKeyPem:"pem",signingPublicKeySha256:"3".repeat(64),verifiedAt:"2026-08-01T00:01:00.000Z"};
}
class Store implements ApplicationUpdateStore{
  items:ApplicationUpdateAttempt[]=[];
  async createApplicationUpdateAttempt(value:ApplicationUpdateAttempt){this.items.push(value);return value;}
  async updateApplicationUpdateAttempt(value:ApplicationUpdateAttempt){this.items=this.items.map(item=>item.id===value.id?value:item);return value;}
  async getActiveApplicationUpdateAttempt(){return this.items.find(item=>["staging","applying","verifying","rollback-running"].includes(item.state))??null;}
  async getApplicationUpdateAttempt(id:string){return this.items.find(item=>item.id===id)??null;}
  async listApplicationUpdateAttempts(limit=10){return this.items.slice(-limit).reverse();}
}

describe("application update contract",()=>{
  it("does not block a restart for a durably paused collaboration",()=>{
    expect(applicationUpdateBlockers({tasks:[],sessions:[{id:"paused",status:"waiting-user"}]})).toEqual([]);
    expect(applicationUpdateBlockers({tasks:[{id:"provider",status:"waiting"}],sessions:[{id:"paused",status:"waiting-user"}]})).toEqual([{kind:"provider-task",id:"provider",status:"waiting"}]);
    expect(applicationUpdateBlockers({tasks:[],sessions:[{id:"controller",status:"running"}]})).toEqual([{kind:"collaboration",id:"controller",status:"running"}]);
  });
  it("compares stable and prerelease versions without treating build metadata as precedence",()=>{
    expect(compareApplicationVersions("1.0.0","1.0.1")).toBe(-1);
    expect(compareApplicationVersions("1.0.0-rc.2","1.0.0-rc.10")).toBe(-1);
    expect(compareApplicationVersions("1.0.0","1.0.0-rc.2")).toBe(1);
    expect(compareApplicationVersions("1.0.0+build.1","1.0.0+build.2")).toBe(0);
  });
  it("requires version and immutable artifact identity to agree",()=>{
    expect(evaluateApplicationUpdate(installed(),release()).state).toBe("available");
    expect(evaluateApplicationUpdate(installed({version:"1.1.0",imageDigest:`sha256:${"b".repeat(64)}`}),release()).state).toBe("up-to-date");
    expect(evaluateApplicationUpdate(installed({version:"1.1.0"}),release())).toMatchObject({state:"failed",reason:"installed-artifact-mismatch"});
    expect(evaluateApplicationUpdate(installed({installMethod:"source-checkout"}),release())).toMatchObject({state:"unconfigured",reason:"source-checkout-not-updatable"});
  });
  it("binds an npm installation to the signed node package", ()=>{
    const node=(overrides:Record<string,unknown>={})=>installed({installMethod:"node-package",imageDigest:null,packageSha256:"d".repeat(64),...overrides});
    const withPackage=(record:Record<string,unknown>|undefined)=>{
      const value=release();
      return{...value,manifest:{...value.manifest,...(record?{nodePackage:record}:{})}} as ReturnType<typeof release>;
    };
    const record={registry:"https://registry.npmjs.org",name:"claudex-workhouse",format:"tgz",filename:"claudex-workhouse-1.1.0.tgz",url:"https://example.test/claudex-workhouse-1.1.0.tgz",size:10,sha256:"e".repeat(64),minimumUpdaterProtocolVersion:1};
    // A newer stable is offered whatever the platform, because one tarball
    // serves every platform and architecture.
    expect(evaluateApplicationUpdate(node(),withPackage(record)).state).toBe("available");
    expect(evaluateApplicationUpdate(node({platform:"win32",architecture:"arm64"}),withPackage(record)).state).toBe("available");
    // At the same version the tarball digest decides, exactly as the image
    // digest does for a container.
    expect(evaluateApplicationUpdate(node({version:"1.1.0",packageSha256:"e".repeat(64)}),withPackage(record)).state).toBe("up-to-date");
    expect(evaluateApplicationUpdate(node({version:"1.1.0"}),withPackage(record))).toMatchObject({state:"failed",reason:"installed-artifact-mismatch"});
    // A release published before the record carried its protocol floor, or one
    // without the record at all, states no contract and is refused.
    const {minimumUpdaterProtocolVersion:_omitted,...legacy}=record;
    expect(evaluateApplicationUpdate(node(),withPackage(legacy))).toMatchObject({state:"unconfigured",reason:"manifest-updater-contract-missing"});
    expect(evaluateApplicationUpdate(node(),withPackage(undefined))).toMatchObject({state:"unconfigured",reason:"manifest-updater-contract-missing"});
  });
  it("coalesces checks and reports active work as a blocker",async()=>{
    const store=new Store(),fetchRelease=vi.fn(async()=>release()),coordinator=new ApplicationUpdateCoordinator({current:installed(),release:fetchRelease,store,blockers:async()=>[{kind:"provider-task",id:"task",status:"running"}],snapshot:async()=>({id:"snapshot",directory:"/snapshot"}),writeRequest:async()=>"/request"});
    const [left,right]=await Promise.all([coordinator.check(),coordinator.check()]);
    expect(fetchRelease).toHaveBeenCalledTimes(1);expect(left).toBe(right);expect(left.state).toBe("blocked-active-tasks");
  });
  it("creates a snapshot before publishing one exact atomic updater request",async()=>{
    const store=new Store(),root=fs.mkdtempSync(path.join(os.tmpdir(),"application-update-"));roots.push(root);const order:string[]=[];
    const coordinator=new ApplicationUpdateCoordinator({current:installed(),release:async()=>release(),store,blockers:async()=>[],snapshot:async()=>{order.push("snapshot");return{id:"snapshot",directory:"/snapshot"};},writeRequest:request=>{order.push("request");return writeApplicationUpdateRequest(root,request);}});
    const result=await coordinator.apply({targetVersion:"1.1.0",manifestSha256:"2".repeat(64),confirm:true});
    expect(order).toEqual(["snapshot","request"]);expect(result).toMatchObject({state:"applying",snapshotId:"snapshot"});
    const request=JSON.parse(fs.readFileSync(result.requestPath!,"utf8"));expect(request).toMatchObject({schemaVersion:1,attemptId:result.id,manifestSha256:"2".repeat(64),artifact:{digest:`sha256:${"b".repeat(64)}`}});
    expect(fs.statSync(root).mode&0o777).toBe(0o700);expect(fs.statSync(result.requestPath!).mode&0o777).toBe(0o600);
  });
  it("does not publish a request when snapshot creation fails or confirmation becomes stale",async()=>{
    const store=new Store(),writeRequest=vi.fn(async()=>"/request"),coordinator=new ApplicationUpdateCoordinator({current:installed(),release:async()=>release(),store,blockers:async()=>[],snapshot:async()=>{throw new Error("snapshot failed");},writeRequest});
    await expect(coordinator.apply({targetVersion:"1.1.0",manifestSha256:"2".repeat(64),confirm:true})).rejects.toThrow("snapshot failed");expect(writeRequest).not.toHaveBeenCalled();expect(store.items[0]).toMatchObject({state:"failed",snapshotId:null});
    await expect(new ApplicationUpdateCoordinator({current:installed(),release:async()=>release(),store:new Store(),blockers:async()=>[],snapshot:async()=>({id:"x",directory:"x"}),writeRequest}).apply({targetVersion:"1.1.1",manifestSha256:"2".repeat(64),confirm:true})).rejects.toMatchObject({code:"APPLICATION_UPDATE_TARGET_CHANGED"});
  });
  it("accepts only a result bound to the exact persisted attempt",async()=>{
    const store=new Store(),item={id:crypto.randomUUID(),state:"applying"as const,sourceVersion:"1.0.0",targetVersion:"1.1.0",manifestSha256:"a".repeat(64),installMethod:"docker-compose"as const,platform:"linux",architecture:"x64",snapshotId:"snapshot",requestPath:"request",rollbackPerformed:false,error:null,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),completedAt:null};store.items.push(item);
    const root=fs.mkdtempSync(path.join(os.tmpdir(),"application-update-results-"));roots.push(root);fs.writeFileSync(path.join(root,`${item.id}.json`),JSON.stringify({schemaVersion:1,attemptId:item.id,state:"rolled-back",sourceVersion:item.sourceVersion,targetVersion:item.targetVersion,manifestSha256:item.manifestSha256,rollbackPerformed:true,completedAt:new Date().toISOString(),error:"readiness timeout"}));
    expect(await reconcileApplicationUpdateResults(root,store)).toEqual({processed:1,rejected:0});expect(store.items[0]).toMatchObject({state:"rolled-back",rollbackPerformed:true,error:"readiness timeout"});
  });
});
