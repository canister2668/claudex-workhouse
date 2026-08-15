import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { createReleaseManifest } from "../../scripts/create-release-manifest.mjs";
import {
  verifyReleaseManifest,
  type ReleaseVerificationPolicy
} from "../../src/server/deployment/release-manifest.js";

const created:string[]=[];
afterEach(()=>{for(const directory of created.splice(0))fs.rmSync(directory,{recursive:true,force:true});});

function sha256(value:Buffer|string){
  return crypto.createHash("sha256").update(value).digest("hex");
}

function createWorkerArchive(
  directory:string,
  platform:"windows"|"linux",
  architecture:"x64"|"arm64"
){
  const rootName=`claudex-workhouse-worker-${platform}-${architecture}`;
  const root=path.join(directory,rootName);
  const files:Record<string,string>={
    "app/desktop-worker/cli.js":"console.log('worker');\n",
    "app/desktop-worker/updater.js":"console.log('updater');\n",
    "LICENSE.txt":"test license\n",
    "licenses/LICENSE":"test license\n",
    "licenses/LICENSE.ko.md":"test Korean license translation\n",
    "licenses/LICENSE.ja.md":"test Japanese license translation\n",
    "licenses/NOTICE.md":"test notice\n",
    "licenses/NOTICE.ko.md":"test Korean notice\n",
    "licenses/NOTICE.ja.md":"test Japanese notice\n",
    "licenses/THIRD_PARTY_NOTICES.md":"test third-party notices\n",
    "licenses/THIRD_PARTY_NOTICES.ko.md":"test Korean third-party notices\n",
    "licenses/THIRD_PARTY_NOTICES.ja.md":"test Japanese third-party notices\n",
    "README-FIRST.txt":"test package\n",
    "VERSION":"1.0.0\n"
  };
  if(platform==="windows"){
    files["Worker CLI.cmd"]="@echo off\r\n";
    files["Start Claudex Workhouse Worker.cmd"]="@echo off\r\n";
    files["node.exe"]="synthetic-node-runtime";
  }else{
    files["bin/claudex-workhouse-worker"]="#!/bin/sh\nexit 0\n";
    files["runtime/node"]="#!/bin/sh\nexit 0\n";
  }
  for(const [relative,content] of Object.entries(files)){
    const file=path.join(root,...relative.split("/"));
    fs.mkdirSync(path.dirname(file),{recursive:true});
    fs.writeFileSync(file,content,{mode:relative.startsWith("bin/")||relative==="runtime/node"?0o755:0o600});
  }
  fs.writeFileSync(path.join(root,"package-manifest.json"),JSON.stringify({
    schemaVersion:1,
    product:"claudex-workhouse-worker",
    version:"1.0.0",
    platform,
    architecture,
    nodeVersion:"v22.0.0",
    files:Object.entries(files).sort(([left],[right])=>left.localeCompare(right)).map(([relative,content])=>({
      path:relative,
      size:Buffer.byteLength(content),
      sha256:sha256(content)
    }))
  },null,2));
  const archive=path.join(
    directory,
    `${rootName}.${platform==="windows"?"zip":"tar.gz"}`
  );
  const result=platform==="windows"
    ?spawnSync("zip",["-qr",archive,rootName],{cwd:directory,encoding:"utf8"})
    :spawnSync("tar",["-czf",archive,rootName],{cwd:directory,encoding:"utf8"});
  if(result.status!==0)throw new Error(result.stderr||`could not create ${archive}`);
  return archive;
}

function createWindowsPortable(directory:string){
  const rootName="claudex-workhouse-server-windows-x64-portable",root=path.join(directory,rootName);
  fs.mkdirSync(root,{recursive:true});
  fs.writeFileSync(path.join(root,"Claudex Workhouse.exe"),"synthetic launcher");
  fs.writeFileSync(path.join(root,"current.json"),JSON.stringify({schemaVersion:1,version:"1.0.0",payloadDirectory:"payload/1.0.0",previousVersion:null}));
  fs.writeFileSync(path.join(root,"payload-manifest.json"),JSON.stringify({schemaVersion:1,product:"claudex-workhouse-windows-server",version:"1.0.0",architecture:"x64",files:[]}));
  const archive=path.join(directory,"claudex-workhouse-server-windows-x64-portable.zip");
  const result=spawnSync("zip",["-qr",archive,rootName],{cwd:directory,encoding:"utf8"});
  if(result.status!==0)throw new Error(result.stderr||`could not create ${archive}`);
  return archive;
}

function fixture(){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),"claudex-release-script-"));created.push(directory);
  const{privateKey,publicKey}=crypto.generateKeyPairSync("rsa",{
    modulusLength:2048,
    privateKeyEncoding:{type:"pkcs8",format:"pem"},
    publicKeyEncoding:{type:"spki",format:"pem"}
  });
  const privateFile=path.join(directory,"release-private.pem");
  const ringFile=path.join(directory,"release-key-ring.json");
  fs.writeFileSync(privateFile,privateKey,{mode:0o600});
  fs.writeFileSync(ringFile,JSON.stringify({
    schemaVersion:1,
    keys:[{
      keyId:"release-test-1",
      algorithm:"rsa-sha256",
      publicKeyPem:publicKey,
      notBefore:"2026-01-01T00:00:00.000Z",
      expiresAt:"2027-01-01T00:00:00.000Z",
      revoked:false
    }]
  }));
  const files={
    windows:createWorkerArchive(directory,"windows","x64"),
    linuxX64:createWorkerArchive(directory,"linux","x64"),
    linuxArm64:createWorkerArchive(directory,"linux","arm64")
  };
  const windowsServer=path.join(directory,"claudex-workhouse-server-windows-x64.exe"),pe=Buffer.alloc(256);pe.write("MZ");pe.writeUInt32LE(64,0x3c);Buffer.from([0x50,0x45,0,0]).copy(pe,64);fs.writeFileSync(windowsServer,pe);
  const windowsPortable=createWindowsPortable(directory);
  const environment={
    CLAUDEX_WORKHOUSE_RELEASE_VERSION:"1.0.0",
    CLAUDEX_WORKHOUSE_RELEASE_SEQUENCE:"7",
    CLAUDEX_WORKHOUSE_RELEASE_PUBLISHED_AT:"2026-07-27T12:00:00.000Z",
    CLAUDEX_WORKHOUSE_RELEASE_EXPIRY_DAYS:"90",
    CLAUDEX_WORKHOUSE_RELEASE_ASSET_BASE_URL:"https://github.com/canister2668/claudex-workhouse/releases/download/v1.0.0",
    CLAUDEX_WORKHOUSE_RELEASE_KEY_ID:"release-test-1",
    CLAUDEX_WORKHOUSE_RELEASE_PRIVATE_KEY_FILE:privateFile,
    CLAUDEX_WORKHOUSE_RELEASE_KEY_RING_FILE:ringFile,
    CLAUDEX_WORKHOUSE_RELEASE_OUTPUT_DIR:path.join(directory,"output"),
    CLAUDEX_WORKHOUSE_IMAGE_DIGEST:`sha256:${"a".repeat(64)}`,
    CLAUDEX_WORKHOUSE_WINDOWS_X64_PACKAGE:files.windows,
    CLAUDEX_WORKHOUSE_LINUX_X64_PACKAGE:files.linuxX64,
    CLAUDEX_WORKHOUSE_LINUX_ARM64_PACKAGE:files.linuxArm64
    ,CLAUDEX_WORKHOUSE_WINDOWS_SERVER_EXE:windowsServer
    ,CLAUDEX_WORKHOUSE_WINDOWS_SERVER_PORTABLE:windowsPortable
  };
  return{directory,environment,publicKey,ringFile};
}

describe("release manifest publishing script",()=>{
  it("binds the exact official artifacts and produces a verifiable detached signature",()=>{
    const value=fixture(),result=createReleaseManifest(value.environment);
    expect(result.manifest.workers["windows-x64"]).toMatchObject({
      filename:"claudex-workhouse-worker-windows-x64.zip",
      platform:"windows",
      architecture:"x64"
    });
    expect(result.manifest.workers["windows-x64"].size).toBeGreaterThan(0);
    expect(result.manifest).toMatchObject({schemaVersion:3,server:{minimumUpdaterProtocolVersion:1},legal:{license:"AGPL-3.0-only",notice:"NOTICE.md",thirdPartyNotices:"THIRD_PARTY_NOTICES.md"},windowsServer:{filename:"claudex-workhouse-server-windows-x64.exe",sha256:sha256(fs.readFileSync(value.environment.CLAUDEX_WORKHOUSE_WINDOWS_SERVER_EXE)),authenticode:{status:"unsigned"}},windowsPortable:{filename:"claudex-workhouse-server-windows-x64-portable.zip",sha256:sha256(fs.readFileSync(value.environment.CLAUDEX_WORKHOUSE_WINDOWS_SERVER_PORTABLE)),minimumUpdaterProtocolVersion:1}});
    const policy:ReleaseVerificationPolicy={
      allowedManifestOrigins:["https://github.com/"],
      allowedWorkerOrigins:["https://github.com/"],
      allowedImageRepositories:["ghcr.io/canister2668/claudex-workhouse"]
    };
    const verified=verifyReleaseManifest({
      manifestBytes:fs.readFileSync(result.manifestFile),
      signatureBytes:fs.readFileSync(result.signatureFile),
      manifestUrl:"https://github.com/canister2668/claudex-workhouse/releases/download/v1.0.0/release-manifest.json",
      signatureUrl:"https://github.com/canister2668/claudex-workhouse/releases/download/v1.0.0/release-manifest.json.sig",
      keyRing:JSON.parse(fs.readFileSync(value.ringFile,"utf8")),
      policy,
      now:new Date("2026-07-27T12:01:00.000Z")
    });
    expect(verified.manifestSha256).toBe(result.manifestSha256);
  });

  it("omits every Windows record when a release supplies no Windows artifact",()=>{
    // The shipping release path: Windows targets are in development, so the
    // workflow sets none of their variables and the manifest carries none of
    // their records rather than failing on a missing required artifact.
    const value=fixture();
    const {
      CLAUDEX_WORKHOUSE_WINDOWS_X64_PACKAGE:_worker,
      CLAUDEX_WORKHOUSE_WINDOWS_SERVER_EXE:_exe,
      CLAUDEX_WORKHOUSE_WINDOWS_SERVER_PORTABLE:_portable,
      ...environment
    }=value.environment;
    const result=createReleaseManifest(environment);
    expect(result.manifest.workers["windows-x64"]).toBeUndefined();
    expect(Object.keys(result.manifest.workers).sort()).toEqual(["linux-arm64","linux-x64"]);
    expect(result.manifest.windowsServer).toBeUndefined();
    expect(result.manifest.windowsPortable).toBeUndefined();
    expect(JSON.stringify(result.manifest).toLowerCase()).not.toContain("windows");
    const verified=verifyReleaseManifest({
      manifestBytes:fs.readFileSync(result.manifestFile),
      signatureBytes:fs.readFileSync(result.signatureFile),
      manifestUrl:"https://github.com/canister2668/claudex-workhouse/releases/download/v1.0.0/release-manifest.json",
      signatureUrl:"https://github.com/canister2668/claudex-workhouse/releases/download/v1.0.0/release-manifest.json.sig",
      keyRing:JSON.parse(fs.readFileSync(value.ringFile,"utf8")),
      policy:{
        allowedManifestOrigins:["https://github.com/"],
        allowedWorkerOrigins:["https://github.com/"],
        allowedImageRepositories:["ghcr.io/canister2668/claudex-workhouse"]
      },
      now:new Date("2026-07-27T12:01:00.000Z")
    });
    expect(verified.manifestSha256).toBe(result.manifestSha256);
  });

  it("refuses a private key that does not match the pinned key ring",()=>{
    const value=fixture();
    const replacement=crypto.generateKeyPairSync("rsa",{
      modulusLength:2048,
      privateKeyEncoding:{type:"pkcs8",format:"pem"},
      publicKeyEncoding:{type:"spki",format:"pem"}
    }).privateKey;
    fs.writeFileSync(value.environment.CLAUDEX_WORKHOUSE_RELEASE_PRIVATE_KEY_FILE,replacement);
    expect(()=>createReleaseManifest(value.environment)).toThrow(/does not match release key/);
  });

  it("refuses non-official artifact file names",()=>{
    const value=fixture(),renamed=path.join(value.directory,"worker.zip");
    fs.renameSync(value.environment.CLAUDEX_WORKHOUSE_WINDOWS_X64_PACKAGE,renamed);
    expect(()=>createReleaseManifest({
      ...value.environment,
      CLAUDEX_WORKHOUSE_WINDOWS_X64_PACKAGE:renamed
    })).toThrow(/official filename/);
  });
  it("refuses a release version that differs from the application package",()=>{
    const value=fixture();
    expect(()=>createReleaseManifest({
      ...value.environment,
      CLAUDEX_WORKHOUSE_RELEASE_VERSION:"1.0.1"
    })).toThrow(/does not match app\/package.json version/);
  });
  it("refuses an official archive whose signed entrypoint contract is incomplete",()=>{
    const value=fixture();
    const root=path.join(value.directory,"claudex-workhouse-worker-linux-x64");
    fs.rmSync(path.join(root,"runtime","node"));
    fs.rmSync(value.environment.CLAUDEX_WORKHOUSE_LINUX_X64_PACKAGE);
    const result=spawnSync("tar",[
      "-czf",
      value.environment.CLAUDEX_WORKHOUSE_LINUX_X64_PACKAGE,
      path.basename(root)
    ],{cwd:value.directory,encoding:"utf8"});
    expect(result.status,result.stderr).toBe(0);
    expect(()=>createReleaseManifest(value.environment)).toThrow(/missing required package entry/);
  });

  it("refuses Windows ZIP links before signing the release manifest",()=>{
    const value=fixture();
    const root=path.join(value.directory,"claudex-workhouse-worker-windows-x64");
    const link=path.join(root,"runtime-link");
    fs.symlinkSync("VERSION",link);
    const result=spawnSync("zip",[
      "-qy",
      value.environment.CLAUDEX_WORKHOUSE_WINDOWS_X64_PACKAGE,
      `${path.basename(root)}/runtime-link`
    ],{cwd:value.directory,encoding:"utf8"});
    expect(result.status,result.stderr).toBe(0);
    expect(()=>createReleaseManifest(value.environment)).toThrow(/link, reparse point, or special/);
  });

  it("refuses case-colliding Windows ZIP paths before signing",()=>{
    const value=fixture();
    const root=path.join(value.directory,"claudex-workhouse-worker-windows-x64");
    fs.writeFileSync(path.join(root,"Case.txt"),"upper");
    fs.writeFileSync(path.join(root,"case.txt"),"lower");
    const result=spawnSync("zip",[
      "-q",
      value.environment.CLAUDEX_WORKHOUSE_WINDOWS_X64_PACKAGE,
      `${path.basename(root)}/Case.txt`,
      `${path.basename(root)}/case.txt`
    ],{cwd:value.directory,encoding:"utf8"});
    expect(result.status,result.stderr).toBe(0);
    expect(()=>createReleaseManifest(value.environment)).toThrow(/duplicate archive path/);
  });
});
