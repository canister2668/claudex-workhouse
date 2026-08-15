#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// This file is part of Claudex Workhouse.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SEMVER=/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const IMAGE_DIGEST=/^sha256:[a-f0-9]{64}$/;
const SHA256=/^[a-f0-9]{64}$/;
const KEY_ID=/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const EXPECTED_WORKERS={
  "windows-x64":{
    platform:"windows",
    architecture:"x64",
    format:"zip",
    filename:"claudex-workhouse-worker-windows-x64.zip",
    entrypoint:"claudex-workhouse-worker-windows-x64/Worker CLI.cmd",
    launcher:"claudex-workhouse-worker-windows-x64/Start Claudex Workhouse Worker.cmd"
  },
  "linux-x64":{
    platform:"linux",
    architecture:"x64",
    format:"tar.gz",
    filename:"claudex-workhouse-worker-linux-x64.tar.gz",
    entrypoint:"claudex-workhouse-worker-linux-x64/bin/claudex-workhouse-worker"
  },
  "linux-arm64":{
    platform:"linux",
    architecture:"arm64",
    format:"tar.gz",
    filename:"claudex-workhouse-worker-linux-arm64.tar.gz",
    entrypoint:"claudex-workhouse-worker-linux-arm64/bin/claudex-workhouse-worker"
  }
};
const WINDOWS_SERVER_FILENAME="claudex-workhouse-server-windows-x64.exe";
const WINDOWS_PORTABLE_FILENAME="claudex-workhouse-server-windows-x64-portable.zip";
const UPDATER_PROTOCOL_VERSION=1;

function required(environment,name){
  const value=environment[name]?.trim();
  if(!value)throw new Error(`${name} is required.`);
  return value;
}

function integer(value,name){
  if(!/^[1-9][0-9]*$/.test(value))throw new Error(`${name} must be a positive integer.`);
  const parsed=Number(value);
  if(!Number.isSafeInteger(parsed))throw new Error(`${name} exceeds the safe integer range.`);
  return parsed;
}

function canonicalTimestamp(value,name){
  const parsed=Date.parse(value);
  if(!Number.isFinite(parsed)||new Date(parsed).toISOString()!==value){
    throw new Error(`${name} must be a canonical ISO-8601 timestamp.`);
  }
  return value;
}

function httpsBase(value){
  let url;
  try{url=new URL(value);}catch{throw new Error("CLAUDEX_WORKHOUSE_RELEASE_ASSET_BASE_URL must be an absolute HTTPS URL.");}
  if(url.protocol!=="https:"||url.username||url.password||url.search||url.hash){
    throw new Error("CLAUDEX_WORKHOUSE_RELEASE_ASSET_BASE_URL must be HTTPS without credentials, query, or hash.");
  }
  return url.href.replace(/\/+$/,"");
}

function regularFile(file,name,maxBytes=2*1024*1024*1024){
  const resolved=path.resolve(file),stat=fs.statSync(resolved);
  if(!stat.isFile()||stat.size<=0||stat.size>maxBytes)throw new Error(`${name} must be a non-empty bounded regular file.`);
  return{path:resolved,size:stat.size};
}

function sha256File(file){
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}
function verifyPortableExecutable(file){
  const fd=fs.openSync(file,"r");
  try{
    const header=Buffer.alloc(64);if(fs.readSync(fd,header,0,header.length,0)!==header.length||header.toString("ascii",0,2)!=="MZ")throw new Error("Windows server artifact is not a PE executable.");
    const peOffset=header.readUInt32LE(0x3c),signature=Buffer.alloc(4);
    if(peOffset<64||peOffset>16*1024*1024||fs.readSync(fd,signature,0,4,peOffset)!==4||!signature.equals(Buffer.from([0x50,0x45,0,0])))throw new Error("Windows server artifact has an invalid PE signature.");
  }finally{fs.closeSync(fd);}
}
// Windows targets are built but not released while their acceptance run is
// outstanding, so a release simply omits them. Supplying the variable puts
// the record back with every check it already had.
function windowsServerRecord(environment,baseUrl){
  if(!environment.CLAUDEX_WORKHOUSE_WINDOWS_SERVER_EXE?.trim())return null;
  const artifact=regularFile(required(environment,"CLAUDEX_WORKHOUSE_WINDOWS_SERVER_EXE"),"CLAUDEX_WORKHOUSE_WINDOWS_SERVER_EXE");
  if(path.basename(artifact.path)!==WINDOWS_SERVER_FILENAME)throw new Error(`CLAUDEX_WORKHOUSE_WINDOWS_SERVER_EXE must use the official filename ${WINDOWS_SERVER_FILENAME}.`);
  verifyPortableExecutable(artifact.path);
  return{platform:"windows",architecture:"x64",format:"exe",filename:WINDOWS_SERVER_FILENAME,url:`${baseUrl}/${WINDOWS_SERVER_FILENAME}`,size:artifact.size,sha256:sha256File(artifact.path),authenticode:{status:"unsigned"}};
}

function windowsPortableRecord(environment,baseUrl,version){
  if(!environment.CLAUDEX_WORKHOUSE_WINDOWS_SERVER_PORTABLE?.trim())return null;
  const artifact=regularFile(required(environment,"CLAUDEX_WORKHOUSE_WINDOWS_SERVER_PORTABLE"),"CLAUDEX_WORKHOUSE_WINDOWS_SERVER_PORTABLE");
  if(path.basename(artifact.path)!==WINDOWS_PORTABLE_FILENAME)throw new Error(`CLAUDEX_WORKHOUSE_WINDOWS_SERVER_PORTABLE must use the official filename ${WINDOWS_PORTABLE_FILENAME}.`);
  const expected={format:"zip",filename:WINDOWS_PORTABLE_FILENAME};
  const root="claudex-workhouse-server-windows-x64-portable";
  const entries=archiveEntries(artifact.path,expected);
  if(entries.some(entry=>entry.replace(/\/$/,"").split("/")[0]!==root))throw new Error(`${WINDOWS_PORTABLE_FILENAME} must contain exactly the official top-level package root.`);
  for(const relative of["Claudex Workhouse.exe","current.json","payload-manifest.json"]){
    if(!entries.includes(`${root}/${relative}`))throw new Error(`${WINDOWS_PORTABLE_FILENAME} is missing required package entry ${root}/${relative}.`);
  }
  let current,payload;
  try{
    current=JSON.parse(zipEntry(artifact.path,`${root}/current.json`,1024*1024).toString("utf8"));
    payload=JSON.parse(zipEntry(artifact.path,`${root}/payload-manifest.json`,16*1024*1024).toString("utf8"));
  }catch(error){throw new Error(`${WINDOWS_PORTABLE_FILENAME} package metadata is invalid: ${error instanceof Error?error.message:String(error)}`);}
  if(current?.schemaVersion!==1||current.version!==version||current.payloadDirectory!==`payload/${version}`)throw new Error(`${WINDOWS_PORTABLE_FILENAME} current.json does not match the release version.`);
  if(payload?.schemaVersion!==1||payload.product!=="claudex-workhouse-windows-server"||payload.version!==version||payload.architecture!=="x64"||!Array.isArray(payload.files))throw new Error(`${WINDOWS_PORTABLE_FILENAME} payload manifest does not match the release binding.`);
  return{platform:"windows",architecture:"x64",format:"zip",filename:WINDOWS_PORTABLE_FILENAME,url:`${baseUrl}/${WINDOWS_PORTABLE_FILENAME}`,size:artifact.size,sha256:sha256File(artifact.path),minimumUpdaterProtocolVersion:UPDATER_PROTOCOL_VERSION};
}

function archiveCommand(command,args,label,maxBuffer=8*1024*1024){
  const result=spawnSync(command,args,{encoding:null,stdio:["ignore","pipe","pipe"],shell:false,maxBuffer});
  if(result.error||result.status!==0){
    const detail=Buffer.isBuffer(result.stderr)?result.stderr.toString("utf8").trim().slice(0,300):"";
    throw new Error(`${label} could not be inspected${detail?`: ${detail}`:"."}`);
  }
  return Buffer.from(result.stdout);
}

function zipEntries(artifact){
  const descriptor=fs.openSync(artifact,"r");
  try{
    const size=fs.fstatSync(descriptor).size;
    const tailSize=Math.min(size,65_557);
    const tail=Buffer.allocUnsafe(tailSize);
    fs.readSync(descriptor,tail,0,tailSize,size-tailSize);
    let end=-1;
    for(let offset=tail.length-22;offset>=0;offset--){
      if(tail.readUInt32LE(offset)===0x06054b50){
        const commentLength=tail.readUInt16LE(offset+20);
        if(offset+22+commentLength===tail.length){end=offset;break;}
      }
    }
    if(end<0)throw new Error("ZIP end record is invalid.");
    const disk=tail.readUInt16LE(end+4);
    const directoryDisk=tail.readUInt16LE(end+6);
    const entriesOnDisk=tail.readUInt16LE(end+8);
    const entryCount=tail.readUInt16LE(end+10);
    const directorySize=tail.readUInt32LE(end+12);
    const directoryOffset=tail.readUInt32LE(end+16);
    if(
      disk!==0||directoryDisk!==0||entriesOnDisk!==entryCount||
      entryCount===0xffff||directorySize===0xffffffff||directoryOffset===0xffffffff||
      entryCount<1||entryCount>50_000||directorySize<1||directorySize>16*1024*1024||
      directoryOffset+directorySize>size-tailSize+end
    )throw new Error("ZIP uses an unsupported split or ZIP64 layout.");
    const directory=Buffer.allocUnsafe(directorySize);
    fs.readSync(descriptor,directory,0,directorySize,directoryOffset);
    const entries=[];
    let totalUncompressed=0;
    let offset=0;
    while(offset<directory.length){
      if(offset+46>directory.length||directory.readUInt32LE(offset)!==0x02014b50){
        throw new Error("ZIP central directory is invalid.");
      }
      const madeBy=directory.readUInt16LE(offset+4);
      const flags=directory.readUInt16LE(offset+8);
      const nameLength=directory.readUInt16LE(offset+28);
      const extraLength=directory.readUInt16LE(offset+30);
      const commentLength=directory.readUInt16LE(offset+32);
      const externalAttributes=directory.readUInt32LE(offset+38);
      const localOffset=directory.readUInt32LE(offset+42);
      const compressedSize=directory.readUInt32LE(offset+20);
      const uncompressedSize=directory.readUInt32LE(offset+24);
      const next=offset+46+nameLength+extraLength+commentLength;
      if(
        flags&1||nameLength<1||next>directory.length||
        localOffset>=directoryOffset||
        compressedSize===0xffffffff||uncompressedSize===0xffffffff||
        uncompressedSize>512*1024*1024
      )throw new Error("ZIP contains an invalid, encrypted, ZIP64, or oversized entry.");
      totalUncompressed+=uncompressedSize;
      if(totalUncompressed>2*1024*1024*1024)throw new Error("ZIP uncompressed size exceeds the release safety limit.");
      const nameBytes=directory.subarray(offset+46,offset+46+nameLength);
      if(nameBytes.some(byte=>byte>0x7f)){
        throw new Error("ZIP entry names must use portable ASCII.");
      }
      const name=nameBytes.toString("ascii");
      const host=(madeBy>>>8)&0xff;
      const unixType=(externalAttributes>>>16)&0xf000;
      const dosAttributes=externalAttributes&0xffff;
      const directoryEntry=name.endsWith("/");
      if(
        (host===3&&unixType!==0&&unixType!==0x8000&&unixType!==0x4000)||
        (host===3&&unixType===0x4000&&!directoryEntry)||
        (host===3&&unixType===0x8000&&directoryEntry)||
        (dosAttributes&0x0400)!==0
      )throw new Error("ZIP contains a link, reparse point, or special entry.");
      entries.push(name);
      offset=next;
    }
    if(offset!==directory.length||entries.length!==entryCount){
      throw new Error("ZIP entry count does not match its directory.");
    }
    return entries;
  }finally{
    fs.closeSync(descriptor);
  }
}

function zipEntry(artifact,entry,maximum){
  const unzip=spawnSync("unzip",["-p",artifact,entry],{
    encoding:null,
    stdio:["ignore","pipe","pipe"],
    shell:false,
    maxBuffer:maximum
  });
  if(!unzip.error){
    if(unzip.status!==0)throw new Error(`${path.basename(artifact)}:${entry} could not be inspected.`);
    return Buffer.from(unzip.stdout);
  }
  if(unzip.error.code!=="ENOENT")throw unzip.error;
  return archiveCommand(
    "7z",
    ["x","-so","-bd","-y","-spd","--",artifact,entry],
    `${path.basename(artifact)}:${entry}`,
    maximum
  );
}

function archiveEntries(artifact,expected){
  const entries=expected.format==="zip"
    ?zipEntries(artifact)
    :archiveCommand("tar",["-tzf",artifact],"Linux Worker archive").toString("utf8").split(/\r?\n/).filter(Boolean);
  if(entries.length<1||entries.length>50_000)throw new Error(`${expected.filename} has an invalid entry count.`);
  const seen=new Set();
  for(const entry of entries){
    const trimmed=entry.endsWith("/")?entry.slice(0,-1):entry;
    if(
      !trimmed||
      trimmed.startsWith("/")||
      trimmed.includes("\\")||
      trimmed.includes(":")||
      trimmed.includes("//")||
      trimmed.split("/").some(part=>!part||part==="."||part==="..")
    )throw new Error(`${expected.filename} contains an unsafe archive path.`);
    const identity=expected.format==="zip"?entry.replace(/\/$/,"").toLowerCase():entry;
    if(seen.has(identity))throw new Error(`${expected.filename} contains a duplicate archive path.`);
    seen.add(identity);
  }
  if(expected.format==="tar.gz"){
    const verbose=archiveCommand("tar",["-tvzf",artifact],"Linux Worker archive types");
    for(const line of verbose.toString("utf8").split(/\r?\n/).filter(Boolean)){
      if(line[0]!=="-"&&line[0]!=="d"){
        throw new Error(`${expected.filename} contains a link or special file.`);
      }
    }
  }
  return entries;
}

function archiveEntry(artifact,expected,entry,maximum=256*1024*1024){
  return expected.format==="zip"
    ?zipEntry(artifact,entry,maximum)
    :archiveCommand("tar",["-xOzf",artifact,"--",entry],`${expected.filename}:${entry}`,maximum);
}

function verifyWorkerArchive(artifact,expected,version){
  const root=expected.filename.replace(/\.zip$|\.tar\.gz$/,"");
  const entries=archiveEntries(artifact,expected);
  if(entries.some(entry=>entry.replace(/\/$/,"").split("/")[0]!==root)){
    throw new Error(`${expected.filename} must contain exactly the official top-level package root.`);
  }
  const required=[
    expected.entrypoint,
    `${root}/${expected.platform==="windows"?"node.exe":"runtime/node"}`,
    `${root}/app/desktop-worker/cli.js`,
    `${root}/app/desktop-worker/updater.js`,
    `${root}/VERSION`,
    `${root}/LICENSE.txt`,
    `${root}/licenses/LICENSE`,
    `${root}/licenses/LICENSE.ko.md`,
    `${root}/licenses/LICENSE.ja.md`,
    `${root}/licenses/NOTICE.md`,
    `${root}/licenses/NOTICE.ko.md`,
    `${root}/licenses/NOTICE.ja.md`,
    `${root}/licenses/THIRD_PARTY_NOTICES.md`,
    `${root}/licenses/THIRD_PARTY_NOTICES.ko.md`,
    `${root}/licenses/THIRD_PARTY_NOTICES.ja.md`,
    `${root}/package-manifest.json`,
    ...("launcher" in expected?[expected.launcher]:[])
  ];
  const entrySet=new Set(entries);
  for(const entry of required){
    if(!entrySet.has(entry))throw new Error(`${expected.filename} is missing required package entry ${entry}.`);
  }
  const packagedVersion=archiveEntry(artifact,expected,`${root}/VERSION`,1024).toString("utf8").trim();
  if(packagedVersion!==version)throw new Error(`${expected.filename} VERSION does not match the release version.`);
  let packageManifest;
  try{
    packageManifest=JSON.parse(
      archiveEntry(artifact,expected,`${root}/package-manifest.json`,1024*1024).toString("utf8")
    );
  }catch(error){
    throw new Error(`${expected.filename} package-manifest.json is invalid: ${error instanceof Error?error.message:String(error)}`);
  }
  if(
    packageManifest?.schemaVersion!==1||
    packageManifest.product!=="claudex-workhouse-worker"||
    packageManifest.version!==version||
    packageManifest.platform!==expected.platform||
    packageManifest.architecture!==expected.architecture||
    !Array.isArray(packageManifest.files)
  )throw new Error(`${expected.filename} package manifest does not match its release binding.`);
  const declared=new Map();
  for(const item of packageManifest.files){
    if(
      !item||typeof item.path!=="string"||
      item.path.startsWith("/")||item.path.includes("\\")||
      item.path.split("/").some(part=>!part||part==="."||part==="..")||
      !Number.isSafeInteger(item.size)||item.size<0||item.size>256*1024*1024||
      typeof item.sha256!=="string"||!SHA256.test(item.sha256)||
      declared.has(item.path)
    )throw new Error(`${expected.filename} contains an invalid package file declaration.`);
    declared.set(item.path,item);
  }
  const archivedFiles=entries
    .filter(entry=>!entry.endsWith("/")&&entry!==`${root}/package-manifest.json`)
    .map(entry=>entry.slice(root.length+1))
    .sort();
  const declaredFiles=[...declared.keys()].sort();
  if(JSON.stringify(archivedFiles)!==JSON.stringify(declaredFiles)){
    throw new Error(`${expected.filename} archive files do not match package-manifest.json.`);
  }
  for(const [relative,item] of declared){
    const content=archiveEntry(artifact,expected,`${root}/${relative}`,item.size+1);
    if(content.length!==item.size||crypto.createHash("sha256").update(content).digest("hex")!==item.sha256){
      throw new Error(`${expected.filename}:${relative} does not match package-manifest.json.`);
    }
  }
}

function workerRecord(environment,key,baseUrl,version){
  const expected=EXPECTED_WORKERS[key];
  const variable=`CLAUDEX_WORKHOUSE_${key.replaceAll("-","_").toUpperCase()}_PACKAGE`;
  if(!environment[variable]?.trim())return null;
  const artifact=regularFile(required(environment,variable),variable);
  if(path.basename(artifact.path)!==expected.filename){
    throw new Error(`${variable} must use the official filename ${expected.filename}.`);
  }
  verifyWorkerArchive(artifact.path,expected,version);
  return{
    platform:expected.platform,
    architecture:expected.architecture,
    format:expected.format,
    filename:expected.filename,
    url:`${baseUrl}/${expected.filename}`,
    size:artifact.size,
    sha256:sha256File(artifact.path),
    entrypoint:expected.entrypoint,
    ...("launcher" in expected?{launcher:expected.launcher}:{})
  };
}

function normalizedPem(value){
  return value.replace(/\r\n/g,"\n").trimEnd()+"\n";
}

function signingKey(environment,keyId){
  const privateFile=regularFile(
    required(environment,"CLAUDEX_WORKHOUSE_RELEASE_PRIVATE_KEY_FILE"),
    "CLAUDEX_WORKHOUSE_RELEASE_PRIVATE_KEY_FILE",
    128*1024
  ).path;
  const ringFile=regularFile(
    required(environment,"CLAUDEX_WORKHOUSE_RELEASE_KEY_RING_FILE"),
    "CLAUDEX_WORKHOUSE_RELEASE_KEY_RING_FILE",
    1024*1024
  ).path;
  const privatePem=fs.readFileSync(privateFile,"utf8");
  const privateKey=crypto.createPrivateKey(privatePem);
  if(privateKey.asymmetricKeyType!=="rsa")throw new Error("The release private key must be RSA.");
  const ring=JSON.parse(fs.readFileSync(ringFile,"utf8"));
  if(ring?.schemaVersion!==1||!Array.isArray(ring.keys))throw new Error("The release key ring is invalid.");
  const trusted=ring.keys.find(key=>key?.keyId===keyId);
  if(!trusted||trusted.algorithm!=="rsa-sha256"||trusted.revoked!==false||typeof trusted.publicKeyPem!=="string"){
    throw new Error(`Release key ${keyId} is unavailable or revoked in the configured key ring.`);
  }
  const derived=normalizedPem(crypto.createPublicKey(privateKey).export({type:"spki",format:"pem"}));
  if(derived!==normalizedPem(trusted.publicKeyPem)){
    throw new Error(`The private key does not match release key ${keyId}.`);
  }
  return privateKey;
}

function atomicWrite(file,value,mode){
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const temporary=`${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary,value,{mode});
  fs.renameSync(temporary,file);
}

export function createReleaseManifest(environment=process.env){
  const version=required(environment,"CLAUDEX_WORKHOUSE_RELEASE_VERSION");
  if(!SEMVER.test(version))throw new Error("CLAUDEX_WORKHOUSE_RELEASE_VERSION must be semantic version text without a v prefix.");
  const packageFile=path.join(path.dirname(fileURLToPath(import.meta.url)),"..","package.json");
  const packageVersion=JSON.parse(fs.readFileSync(packageFile,"utf8"))?.version;
  if(packageVersion!==version)throw new Error(`Release version ${version} does not match app/package.json version ${String(packageVersion)}.`);
  const channel=environment.CLAUDEX_WORKHOUSE_RELEASE_CHANNEL?.trim()||"stable";
  if(!/^[a-z][a-z0-9-]{0,31}$/.test(channel))throw new Error("CLAUDEX_WORKHOUSE_RELEASE_CHANNEL is invalid.");
  const releaseSequence=integer(required(environment,"CLAUDEX_WORKHOUSE_RELEASE_SEQUENCE"),"CLAUDEX_WORKHOUSE_RELEASE_SEQUENCE");
  const image=environment.CLAUDEX_WORKHOUSE_IMAGE_REPOSITORY?.trim()||"ghcr.io/canister2668/claudex-workhouse";
  if(!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::[0-9]{2,5})?(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)+$/.test(image)){
    throw new Error("CLAUDEX_WORKHOUSE_IMAGE_REPOSITORY must be a tag-free OCI repository.");
  }
  const digest=required(environment,"CLAUDEX_WORKHOUSE_IMAGE_DIGEST").toLowerCase();
  if(!IMAGE_DIGEST.test(digest))throw new Error("CLAUDEX_WORKHOUSE_IMAGE_DIGEST must be sha256:<64 lowercase hex>.");
  const keyId=required(environment,"CLAUDEX_WORKHOUSE_RELEASE_KEY_ID");
  if(!KEY_ID.test(keyId))throw new Error("CLAUDEX_WORKHOUSE_RELEASE_KEY_ID is invalid.");
  const publishedAt=canonicalTimestamp(
    environment.CLAUDEX_WORKHOUSE_RELEASE_PUBLISHED_AT?.trim()||new Date().toISOString(),
    "CLAUDEX_WORKHOUSE_RELEASE_PUBLISHED_AT"
  );
  const expiryDays=integer(environment.CLAUDEX_WORKHOUSE_RELEASE_EXPIRY_DAYS?.trim()||"90","CLAUDEX_WORKHOUSE_RELEASE_EXPIRY_DAYS");
  if(expiryDays>366)throw new Error("CLAUDEX_WORKHOUSE_RELEASE_EXPIRY_DAYS must not exceed 366.");
  const expiresAt=new Date(Date.parse(publishedAt)+expiryDays*24*60*60*1000).toISOString();
  const assetBaseUrl=httpsBase(required(environment,"CLAUDEX_WORKHOUSE_RELEASE_ASSET_BASE_URL"));
  const manifest={
    schemaVersion:3,
    channel,
    version,
    releaseSequence,
    publishedAt,
    expiresAt,
    server:{
      image,
      tag:version,
      digest,
      platforms:["linux/amd64","linux/arm64"],
      minimumUpdaterProtocolVersion:UPDATER_PROTOCOL_VERSION
    },
    ...(windowsServerRecord(environment,assetBaseUrl)?{windowsServer:windowsServerRecord(environment,assetBaseUrl)}:{}),
    ...(windowsPortableRecord(environment,assetBaseUrl,version)?{windowsPortable:windowsPortableRecord(environment,assetBaseUrl,version)}:{}),
    workers:Object.fromEntries(
      Object.keys(EXPECTED_WORKERS).map(key=>[key,workerRecord(environment,key,assetBaseUrl,version)])
        .filter(([,record])=>record)
        .map(([key,record])=>[key,{...record,minimumUpdaterProtocolVersion:UPDATER_PROTOCOL_VERSION}])
    ),
    requirements:{
      docker:environment.CLAUDEX_WORKHOUSE_MIN_DOCKER?.trim()||">=24.0.0",
      compose:environment.CLAUDEX_WORKHOUSE_MIN_COMPOSE?.trim()||">=2.20.0"
    },
    legal:{
      license:"AGPL-3.0-only",
      notice:"NOTICE.md",
      thirdPartyNotices:"THIRD_PARTY_NOTICES.md"
    },
    signing:{keyId,algorithm:"rsa-sha256"}
  };
  for(const [name,value] of Object.entries(manifest.requirements)){
    if(!/^>=[0-9]+\.[0-9]+\.[0-9]+$/.test(value))throw new Error(`The ${name} requirement must use >=MAJOR.MINOR.PATCH.`);
  }
  const bytes=Buffer.from(`${JSON.stringify(manifest,null,2)}\n`,"utf8");
  const privateKey=signingKey(environment,keyId);
  const signature=crypto.sign("RSA-SHA256",bytes,{
    key:privateKey,
    padding:crypto.constants.RSA_PKCS1_PADDING
  });
  const output=path.resolve(environment.CLAUDEX_WORKHOUSE_RELEASE_OUTPUT_DIR?.trim()||path.join(path.dirname(fileURLToPath(import.meta.url)),"..","..","release-output"));
  const manifestFile=path.join(output,"release-manifest.json");
  const signatureFile=path.join(output,"release-manifest.json.sig");
  atomicWrite(manifestFile,bytes,0o644);
  atomicWrite(signatureFile,signature,0o644);
  return{
    manifest,
    manifestFile,
    signatureFile,
    manifestSha256:crypto.createHash("sha256").update(bytes).digest("hex"),
    signatureSha256:crypto.createHash("sha256").update(signature).digest("hex")
  };
}

const invoked=process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(invoked){
  try{
    const result=createReleaseManifest();
    process.stdout.write(`${JSON.stringify({
      manifestFile:result.manifestFile,
      signatureFile:result.signatureFile,
      manifestSha256:result.manifestSha256,
      signatureSha256:result.signatureSha256,
      version:result.manifest.version,
      releaseSequence:result.manifest.releaseSequence
    },null,2)}\n`);
  }catch(error){
    process.stderr.write(`${error instanceof Error?error.message:String(error)}\n`);
    process.exitCode=1;
  }
}
