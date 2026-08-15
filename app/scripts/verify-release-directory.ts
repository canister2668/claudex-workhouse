#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  verifyReleaseManifest,
  type ReleaseWorkerKey
} from "../src/server/deployment/release-manifest.js";

const workerKeys: readonly ReleaseWorkerKey[] = [
  "windows-x64",
  "linux-x64",
  "linux-arm64"
];

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function boundedRegularFile(file: string, maximum: number): Buffer {
  const status = fs.lstatSync(file);
  if (!status.isFile() || status.size <= 0 || status.size > maximum) {
    throw new Error(`${path.basename(file)} must be a non-empty bounded regular file.`);
  }
  return fs.readFileSync(file);
}

function fileSha256(file: string): string {
  const hash = crypto.createHash("sha256");
  const descriptor = fs.openSync(file, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    for (;;) {
      const count = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (count === 0) break;
      hash.update(buffer.subarray(0, count));
    }
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest("hex");
}

function expectedUrl(base: string, fileName: string): string {
  const url = new URL(base);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error("CLAUDEX_WORKHOUSE_EXPECTED_ASSET_BASE_URL must be a trusted HTTPS URL.");
  }
  return `${url.href.replace(/\/+$/, "")}/${fileName}`;
}

function verifySha256Sidecar(directory: string, fileName: string, sha256: string): void {
  const sidecar = path.join(directory, `${fileName}.sha256`);
  const expected = `${sha256}  ${fileName}`;
  if (boundedRegularFile(sidecar, 1024).toString("ascii") !== expected) {
    throw new Error(`${fileName}.sha256 does not exactly bind the release artifact.`);
  }
}

function verifyUnifiedChecksums(directory: string): void {
  const checksumFile = path.join(directory, "SHA256SUMS");
  const names = fs.readdirSync(directory)
    .filter((name) => name !== "SHA256SUMS")
    .sort();
  const expected = `${names.map((name) => `${fileSha256(path.join(directory, name))}  ${name}`).join("\n")}\n`;
  if (boundedRegularFile(checksumFile, 1024 * 1024).toString("ascii") !== expected) {
    throw new Error("SHA256SUMS does not exactly bind the complete release asset inventory.");
  }
}

const directory = path.resolve(required("CLAUDEX_WORKHOUSE_RELEASE_VERIFY_DIRECTORY"));
const keyRingFile = path.resolve(required("CLAUDEX_WORKHOUSE_RELEASE_KEY_RING_FILE"));
const expectedImageDigest = required("CLAUDEX_WORKHOUSE_EXPECTED_IMAGE_DIGEST");
const expectedImageRepository = required("CLAUDEX_WORKHOUSE_EXPECTED_IMAGE_REPOSITORY");
const expectedVersion = required("CLAUDEX_WORKHOUSE_EXPECTED_VERSION");
const assetBaseUrl = required("CLAUDEX_WORKHOUSE_EXPECTED_ASSET_BASE_URL");
const manifestFile = path.join(directory, "release-manifest.json");
const signatureFile = path.join(directory, "release-manifest.json.sig");
const manifestBytes = boundedRegularFile(manifestFile, 1024 * 1024);
const signatureBytes = boundedRegularFile(signatureFile, 64 * 1024);
const keyRing = JSON.parse(boundedRegularFile(keyRingFile, 1024 * 1024).toString("utf8"));
const origin = new URL(assetBaseUrl).origin;

const verified = verifyReleaseManifest({
  manifestBytes,
  signatureBytes,
  manifestUrl: expectedUrl(assetBaseUrl, "release-manifest.json"),
  signatureUrl: expectedUrl(assetBaseUrl, "release-manifest.json.sig"),
  keyRing,
  policy: {
    allowedManifestOrigins: [origin],
    allowedWorkerOrigins: [origin],
    allowedImageRepositories: [expectedImageRepository]
  }
});

if (verified.manifest.version !== expectedVersion) {
  throw new Error("Signed manifest version does not match the release tag.");
}
if (verified.manifest.server.digest !== expectedImageDigest) {
  throw new Error("Signed manifest image digest does not match the built multi-architecture image.");
}

// A release that ships no Windows Worker carries no record for it, so the
// absent ones are skipped rather than demanded.
const presentWorkerKeys = workerKeys.filter(key => verified.manifest.workers[key]);
for (const key of presentWorkerKeys) {
  const artifact = verified.manifest.workers[key]!;
  if (artifact.url !== expectedUrl(assetBaseUrl, artifact.filename)) {
    throw new Error(`Signed ${key} artifact URL does not match the immutable release location.`);
  }
  const artifactFile = path.join(directory, artifact.filename);
  const status = fs.lstatSync(artifactFile);
  if (!status.isFile() || status.size !== artifact.size) {
    throw new Error(`${artifact.filename} size does not match the signed manifest.`);
  }
  if (fileSha256(artifactFile) !== artifact.sha256) {
    throw new Error(`${artifact.filename} SHA-256 does not match the signed manifest.`);
  }
}
const windowsServer=verified.manifest.windowsServer;
// Windows targets are in development and a release ships none of them, so the
// records are optional. When one is present it is checked exactly as before.
if(windowsServer){
  if(windowsServer.url!==expectedUrl(assetBaseUrl,windowsServer.filename))throw new Error("Signed Windows server artifact URL does not match the immutable release location.");
  const windowsServerFile=path.join(directory,windowsServer.filename),windowsServerStatus=fs.lstatSync(windowsServerFile);
  if(!windowsServerStatus.isFile()||windowsServerStatus.size!==windowsServer.size)throw new Error("Windows server EXE size does not match the signed manifest.");
  if(fileSha256(windowsServerFile)!==windowsServer.sha256)throw new Error("Windows server EXE SHA-256 does not match the signed manifest.");
  verifySha256Sidecar(directory,windowsServer.filename,windowsServer.sha256);
  const portable=verified.manifest.windowsPortable;
  const portableName=portable?.filename??"claudex-workhouse-server-windows-x64-portable.zip",portableFile=path.join(directory,portableName);
  const portableStatus=fs.lstatSync(portableFile);
  if(!portableStatus.isFile()||portableStatus.size<4||portableStatus.size>2*1024*1024*1024)throw new Error("Windows portable ZIP must be a non-empty bounded regular file.");
  const portableDescriptor=fs.openSync(portableFile,"r"),portableHeader=Buffer.allocUnsafe(4);
  try{if(fs.readSync(portableDescriptor,portableHeader,0,4,0)!==4||portableHeader.readUInt32LE(0)!==0x04034b50)throw new Error("Windows portable ZIP header is invalid.");}finally{fs.closeSync(portableDescriptor);}
  const portableSha256=fileSha256(portableFile);
  if(verified.manifest.schemaVersion===3){
    if(!portable)throw new Error("Signed schema v3 release manifest does not contain the Windows portable ZIP.");
    if(portable.url!==expectedUrl(assetBaseUrl,portable.filename))throw new Error("Signed Windows portable URL does not match the immutable release location.");
    if(portableStatus.size!==portable.size)throw new Error("Windows portable ZIP size does not match the signed manifest.");
    if(portableSha256!==portable.sha256)throw new Error("Windows portable ZIP SHA-256 does not match the signed manifest.");
  }
  verifySha256Sidecar(directory,portableName,portableSha256);
}
// The npm tarball is published as an asset, so the bytes the registry will
// serve are checked against the signature here like every other artifact.
const nodePackage=verified.manifest.nodePackage;
if(nodePackage){
  if(nodePackage.url!==expectedUrl(assetBaseUrl,nodePackage.filename))throw new Error("Signed Node package URL does not match the immutable release location.");
  const nodeFile=path.join(directory,nodePackage.filename),nodeStatus=fs.lstatSync(nodeFile);
  if(!nodeStatus.isFile()||nodeStatus.size!==nodePackage.size)throw new Error("Node package size does not match the signed manifest.");
  if(fileSha256(nodeFile)!==nodePackage.sha256)throw new Error("Node package SHA-256 does not match the signed manifest.");
}
verifyUnifiedChecksums(directory);

process.stdout.write(`${JSON.stringify({
  verified: true,
  version: verified.manifest.version,
  releaseSequence: verified.manifest.releaseSequence,
  manifestSha256: verified.manifestSha256,
  imageDigest: verified.manifest.server.digest,
  workers: presentWorkerKeys,
  windowsServer:windowsServer?.filename??null,
  windowsPortable:verified.manifest.windowsPortable?.filename??(windowsServer?"claudex-workhouse-server-windows-x64-portable.zip":null),
  nodePackage:nodePackage?.filename??null
})}\n`);
