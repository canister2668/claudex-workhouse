import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { createTar } from "../src/archive";
import { createInstallerBundle, validateDataPath, validateServerOrigin } from "../src/deployment";
import {
  fetchVerifiedWorkerAsset,
  verifyReleaseBytes
} from "../src/release";
import { createWindowsWorkerDownload } from "../src/worker-download";
import { createWindowsDockerDownload } from "../src/windows-docker-download";
import{createWindowsServerDownload}from"../src/windows-server-download";
import type { InstallerBuildConfig, ReleaseKey, VerifiedRelease } from "../src/types";

const pair = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicKeyPem = pair.publicKey.export({ type: "spki", format: "pem" }).toString();
const key: ReleaseKey = {
  keyId: "test-release-1",
  algorithm: "rsa-sha256",
  publicKeyPem,
  notBefore: "2026-01-01T00:00:00.000Z",
  expiresAt: "2027-01-01T00:00:00.000Z",
  revoked: false
};
const config: Pick<
  InstallerBuildConfig,
  | "manifestUrl"
  | "signatureUrl"
  | "keyRing"
  | "expectedChannel"
  | "allowedImageRepositories"
  | "allowedWorkerOrigins"
> = {
  manifestUrl: "https://releases.example.test/release-manifest.json",
  signatureUrl: "https://releases.example.test/release-manifest.json.sig",
  keyRing: [key],
  expectedChannel: "stable",
  allowedImageRepositories: ["ghcr.io/example/claudex-workhouse"],
  allowedWorkerOrigins: ["https://github.com"]
};

function worker(
  platform: "windows" | "linux",
  architecture: "x64" | "arm64",
  format: "zip" | "tar.gz"
) {
  const filename = `claudex-workhouse-worker-${platform}-${architecture}.${format}`;
  return {
    platform,
    architecture,
    format,
    filename,
    url: `https://github.com/example/claudex/releases/download/v1.0.0/${filename}`,
    size: 123456,
    sha256: "b".repeat(64),
    entrypoint: platform === "windows" ? "worker.exe" : "bin/worker",
    ...(platform === "windows" ? { launcher: "install.ps1" } : {})
  };
}

function manifest() {
  return {
    schemaVersion: 1,
    channel: "stable",
    version: "1.0.0",
    releaseSequence: 7,
    publishedAt: "2026-07-27T00:00:00.000Z",
    expiresAt: "2026-10-27T00:00:00.000Z",
    server: {
      image: "ghcr.io/example/claudex-workhouse",
      tag: "1.0.0",
      digest: `sha256:${"a".repeat(64)}`,
      platforms: ["linux/amd64", "linux/arm64"]
    },
    workers: {
      "windows-x64": worker("windows", "x64", "zip"),
      "linux-x64": worker("linux", "x64", "tar.gz"),
      "linux-arm64": worker("linux", "arm64", "tar.gz")
    },
    requirements: {
      docker: ">=24.0.0",
      compose: ">=2.20.0"
    },
    legal:{license:"AGPL-3.0-only",notice:"NOTICE.md",thirdPartyNotices:"THIRD_PARTY_NOTICES.md"},
    signing: { keyId: key.keyId, algorithm: "rsa-sha256" }
  };
}
function manifestV2(){
  const value=manifest(),filename="claudex-workhouse-server-windows-x64.exe";
  return{...value,schemaVersion:2,windowsServer:{platform:"windows",architecture:"x64",format:"exe",filename,url:`https://github.com/example/claudex/releases/download/v1.0.0/${filename}`,size:100_000_000,sha256:"c".repeat(64),authenticode:{status:"unsigned"}}};
}
function manifestV3(){
  const value=manifestV2(),filename="claudex-workhouse-server-windows-x64-portable.zip";
  return{...value,schemaVersion:3,server:{...value.server,minimumUpdaterProtocolVersion:1},windowsPortable:{platform:"windows",architecture:"x64",format:"zip",filename,url:`https://github.com/example/claudex/releases/download/v1.0.0/${filename}`,size:150_000_000,sha256:"d".repeat(64),minimumUpdaterProtocolVersion:1},workers:Object.fromEntries(Object.entries(value.workers).map(([name,worker])=>[name,{...worker,minimumUpdaterProtocolVersion:1}]))};
}

function signedManifest(value = manifest()) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const signature = crypto.sign("sha256", bytes, pair.privateKey);
  return { bytes, signature: new Uint8Array(signature) };
}

async function verifiedRelease(): Promise<VerifiedRelease> {
  const { bytes, signature } = signedManifest();
  return verifyReleaseBytes(bytes, signature, config, new Date("2026-07-28T00:00:00.000Z"));
}

test("WebCrypto verifies the exact detached RSA-SHA256 signature and trusted key", async () => {
  const release = await verifiedRelease();
  assert.equal(release.manifest.version, "1.0.0");
  assert.equal(release.verifiedKey.keyId, key.keyId);
  assert.equal(
    release.verifiedKey.publicKeySha256,
    crypto
      .createHash("sha256")
      .update(
        crypto
          .createPublicKey(publicKeyPem)
          .export({ type: "spki", format: "pem" })
          .toString()
      )
      .digest("hex")
  );
  assert.match(release.manifestSha256, /^[a-f0-9]{64}$/);
});

test("tampered, revoked, expired, and wrong-key manifests fail closed", async () => {
  const { bytes, signature } = signedManifest();
  const tampered = new TextEncoder().encode(
    JSON.stringify({
      ...manifest(),
      version: "1.0.1",
      server: { ...manifest().server, tag: "1.0.1" }
    })
  );
  await assert.rejects(
    verifyReleaseBytes(tampered, signature, config, new Date("2026-07-28T00:00:00.000Z")),
    /서명을 검증하지 못했습니다/
  );
  await assert.rejects(
    verifyReleaseBytes(
      bytes,
      signature,
      { ...config, keyRing: [{ ...key, revoked: true }] },
      new Date("2026-07-28T00:00:00.000Z")
    ),
    /폐기/
  );
  await assert.rejects(
    verifyReleaseBytes(bytes, signature, config, new Date("2027-01-01T00:00:00.000Z")),
    /만료/
  );
  const otherPair = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const otherPem = otherPair.publicKey.export({ type: "spki", format: "pem" }).toString();
  await assert.rejects(
    verifyReleaseBytes(
      bytes,
      signature,
      {
        ...config,
        keyRing: [
          {
            ...key,
            publicKeyPem: otherPem
          }
        ]
      },
      new Date("2026-07-28T00:00:00.000Z")
    ),
    /서명을 검증하지 못했습니다/
  );
});

test("strict manifest bindings and build-pinned release policy fail closed", async () => {
  const { bytes, signature } = signedManifest();
  await assert.rejects(
    verifyReleaseBytes(
      bytes,
      signature,
      { ...config, expectedChannel: "beta" },
      new Date("2026-07-28T00:00:00.000Z")
    ),
    /channel/
  );
  await assert.rejects(
    verifyReleaseBytes(
      bytes,
      signature,
      { ...config, allowedImageRepositories: ["ghcr.io/other/workhouse"] },
      new Date("2026-07-28T00:00:00.000Z")
    ),
    /저장소/
  );
  await assert.rejects(
    verifyReleaseBytes(
      bytes,
      signature,
      { ...config, allowedWorkerOrigins: ["https://downloads.example.test"] },
      new Date("2026-07-28T00:00:00.000Z")
    ),
    /Worker 다운로드 origin/
  );

  const incomplete = manifest();
  delete (incomplete.workers as Partial<typeof incomplete.workers>)["linux-arm64"];
  const signedIncomplete = signedManifest(incomplete);
  await assert.rejects(
    verifyReleaseBytes(
      signedIncomplete.bytes,
      signedIncomplete.signature,
      config,
      new Date("2026-07-28T00:00:00.000Z")
    ),
    /workers\.linux-arm64/
  );
});
test("schema v2 binds the Windows main server EXE while schema v1 remains compatible",async()=>{
  const signed=signedManifest(manifestV2());
  const release=await verifyReleaseBytes(signed.bytes,signed.signature,config,new Date("2026-07-28T00:00:00.000Z"));
  assert.equal(release.manifest.schemaVersion,2);
  assert.equal(release.manifest.windowsServer?.authenticode.status,"unsigned");
  const script=createWindowsServerDownload(release);
  assert.match(script.fileName,/^download-claudex-workhouse-server-1\.0\.0\.ps1$/);
  assert.match(script.content,/Get-AuthenticodeSignature/);
  assert.match(script.content,/SignatureStatus\]::NotSigned/);
  assert.match(script.content,/\{374DE290-123F-4565-9164-39C4925E467B\}/);
  assert.match(script.content,/RegistryValueOptions\]::DoNotExpandEnvironmentNames/);
  assert.match(script.content,/GetFolderPath\(\[Environment\+SpecialFolder\]::UserProfile\)/);
  assert.match(script.content,/\[char\]::IsLetter\(\$downloads\[0\]\)/);
  assert.match(script.content,/\$downloads\[2\] -notin @\('\?','\.'\)/);
  assert.ok(script.content.includes("$downloads.Substring(2).Contains('\\')"));
  for(const powershellSurface of [script.content,script.launchScript]){
    assert.doesNotMatch(powershellSurface,/IsPathFullyQualified|Path\]::Join|File\]::Move\([^)]*,[^)]*,/);
  }
  assert.match(script.content,new RegExp("c".repeat(64)));
  assert.doesNotMatch(script.content,/Set-ExecutionPolicy/i);
  assert.match(script.launchCommand,/-EncodedCommand [A-Za-z0-9+/]+=*$/);
  assert.doesNotMatch(script.launchCommand,/-Command\b/);
  const encoded=script.launchCommand.split(" ").at(-1)??"";
  const launchScript=new TextDecoder("utf-16le").decode(Buffer.from(encoded,"base64"));
  assert.equal(launchScript,script.launchScript);
  assert.match(launchScript,/GetValue\('\{374DE290-123F-4565-9164-39C4925E467B\}'/);
  assert.match(launchScript,/GetFolderPath\(\[Environment\+SpecialFolder\]::UserProfile\)/);
  assert.match(launchScript,/download-claudex-workhouse-server-1\.0\.0\.ps1/);
  const v1=await verifiedRelease();
  assert.throws(()=>createWindowsServerDownload(v1),/Windows 메인 서버 EXE/);
  const missing=manifestV2();delete(missing as Partial<typeof missing>).windowsServer;
  const invalid=signedManifest(missing);
  await assert.rejects(verifyReleaseBytes(invalid.bytes,invalid.signature,config,new Date("2026-07-28T00:00:00.000Z")),/windowsServer/);
});
test("schema v3 binds the Windows portable ZIP and updater protocol requirements",async()=>{
  const signed=signedManifest(manifestV3());
  const release=await verifyReleaseBytes(signed.bytes,signed.signature,config,new Date("2026-07-28T00:00:00.000Z"));
  assert.equal(release.manifest.schemaVersion,3);
  assert.equal(release.manifest.windowsPortable?.sha256,"d".repeat(64));
  assert.equal(release.manifest.server.minimumUpdaterProtocolVersion,1);
  const missing=manifestV3();delete(missing as Partial<typeof missing>).windowsPortable;
  const invalid=signedManifest(missing);
  await assert.rejects(verifyReleaseBytes(invalid.bytes,invalid.signature,config,new Date("2026-07-28T00:00:00.000Z")),/windowsPortable/);
});

test("Windows Worker bytes are downloaded only after exact size and SHA-256 verification", async () => {
  const bytes = new TextEncoder().encode("verified worker zip fixture");
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  const asset = {
    ...manifest().workers["windows-x64"],
    size: bytes.byteLength,
    sha256
  };
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response(bytes, {
        status: 200,
        headers: { "content-length": String(bytes.byteLength) }
      });
    assert.deepEqual(await fetchVerifiedWorkerAsset(asset), bytes);

    globalThis.fetch = async () =>
      new Response(bytes, {
        status: 200,
        headers: { "content-length": String(bytes.byteLength + 1) }
      });
    await assert.rejects(fetchVerifiedWorkerAsset(asset), /Content-Length/);

    const changed = Uint8Array.from(bytes);
    changed[0] ^= 1;
    globalThis.fetch = async () =>
      new Response(changed, {
        status: 200,
        headers: { "content-length": String(changed.byteLength) }
      });
    await assert.rejects(fetchVerifiedWorkerAsset(asset), /SHA-256/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Windows Worker target-side downloader binds the signed manifest and package", async () => {
  const release = await verifiedRelease();
  const script = createWindowsWorkerDownload(release);
  assert.match(script.fileName, /^download-claudex-workhouse-worker-1\.0\.0\.ps1$/);
  assert.equal(
    script.launchCommand,
    'powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\\Downloads\\download-claudex-workhouse-worker-1.0.0.ps1"'
  );
  assert.doesNotMatch(script.launchCommand, /Set-ExecutionPolicy/i);
  assert.match(script.content, /VerifyData\(/);
  assert.match(script.content, /RSASignaturePadding\]::Pkcs1/);
  assert.match(script.content, /AllowAutoRedirect = \$false/);
  assert.match(script.content, /HTTPS redirect downgrade is not allowed/);
  assert.match(script.content, /Worker package SHA-256 does not match/);
  assert.match(script.content, new RegExp(manifest().workers["windows-x64"].sha256));
  assert.doesNotMatch(script.content, /claimToken|Authorization:|ABCD-EFGH/i);
  const v2=manifestV2(),signed=signedManifest(v2),verified=await verifyReleaseBytes(signed.bytes,signed.signature,config,new Date("2026-07-28T00:00:00.000Z"));
  const v2Script=createWindowsWorkerDownload(verified);assert.match(v2Script.content,/-notin @\(1, 2, 3\)/);
});

test("Windows Docker Desktop bootstrap pins the signed image and keeps credentials in the Worker", async () => {
  const signed = signedManifest(manifestV3());
  const release = await verifyReleaseBytes(
    signed.bytes,
    signed.signature,
    config,
    new Date("2026-07-28T00:00:00.000Z")
  );
  const script = createWindowsDockerDownload(release);
  assert.equal(
    script.fileName,
    "install-claudex-workhouse-docker-1.0.0.ps1"
  );
  assert.equal(
    script.launchCommand,
    'powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\\Downloads\\install-claudex-workhouse-docker-1.0.0.ps1"'
  );
  assert.match(script.content, /VerifyData\(/);
  assert.match(script.content, /RSASignaturePadding\]::Pkcs1/);
  assert.match(
    script.content,
    new RegExp(`ghcr\\.io/example/claudex-workhouse:1\\.0\\.0@sha256:${"a".repeat(64)}`)
  );
  assert.match(script.content, /CLAUDEX_WORKHOUSE_HOST_ROLES: main-server/);
  assert.match(script.content, /CLAUDEX_WORKHOUSE_INSTALL_METHOD: docker-desktop/);
  assert.match(script.content, /127\.0\.0\.1:3410:3410/);
  assert.match(script.content, /docker\.exe/);
  assert.match(script.content, /compose -f \$workhouseComposeFile pull/);
  assert.match(script.content, /\.installer-owned-compose\.sha256/);
  assert.match(script.content, /customized deployment already exists/);
  assert.match(script.content, /api\/health\/ready/);
  assert.doesNotMatch(script.content, /:latest\b/);
  assert.doesNotMatch(script.content, /claude auth|codex login|docker\.sock|privileged:/i);
  assert.doesNotMatch(script.content, /Set-ExecutionPolicy/i);
  const output = process.env.CLAUDEX_WINDOWS_DOCKER_SCRIPT_OUTPUT;
  if (output) fs.writeFileSync(output, script.content, { encoding: "utf8", flag: "wx" });
});

test("server bundle preserves the four-file contract and safe installer boundary", async () => {
  const release = await verifiedRelease();
  const bundle = await createInstallerBundle(
    {
      id: "11111111-1111-4111-8111-111111111111",
      platform: "synology",
      dataPath: "/volume1/docker/claudex-workhouse",
      port: 3410,
      accessMode: "local-only",
      serverOrigin: "http://192.168.1.20:3410"
    },
    release
  );
  assert.deepEqual(
    bundle.artifacts.map((artifact) => artifact.path),
    ["compose.yaml", ".env", "install.sh", "README-FIRST.txt"]
  );
  const compose = bundle.artifacts.find((artifact) => artifact.path === "compose.yaml")!.content;
  assert.match(compose, /image: ghcr\.io\/example\/claudex-workhouse:1\.0\.0@sha256:/);
  assert.match(compose, /cap_drop:\n      - ALL/);
  assert.match(compose, /HOME: \/opt\/claudex-workhouse\/runtime\/home/);
  assert.match(compose, /\/snapshots:\/opt\/claudex-workhouse\/snapshots/);
  assert.match(
    compose,
    /CLAUDEX_WORKHOUSE_RELEASE_KEY_RING_FILE: \/opt\/claudex-workhouse\/deploy\/release-key-ring\.json/
  );
  assert.match(compose, /CLAUDEX_WORKHOUSE_RELEASE_IMAGE_REPOSITORIES:/);
  assert.match(compose, /CLAUDEX_WORKHOUSE_RELEASE_WORKER_ORIGINS:/);
  assert.doesNotMatch(compose, /docker\.sock|privileged:/);
  const script = bundle.artifacts.find((artifact) => artifact.path === "install.sh")!.content;
  const environment = bundle.artifacts.find((artifact) => artifact.path === ".env")!.content;
  assert.match(
    environment,
    /CLAUDEX_WORKHOUSE_RELEASE_MANIFEST_URL=https:\/\/releases\.example\.test\/release-manifest\.json/
  );
  assert.match(
    script,
    /MANIFEST_URL='https:\/\/github\.com\/example\/claudex\/releases\/download\/v1\.0\.0\/release-manifest\.json'/
  );
  assert.match(script, /Docker Compose 2\.20 or newer/);
  assert.match(script, /host_port_in_use/);
  assert.match(script, /\/api\/health\/ready/);
  assert.match(script, /Owner claim URL/);
  assert.match(script, /Expires at:/);
  assert.match(script, /Server fingerprint:/);
  assert.match(script, /docker-host-updater\.mjs/);
  assert.match(script, /release-key-ring\.json/);
  assert.match(script, /apply-update\.sh/);
  assert.doesNotMatch(script, /process\.stdout\.write\(await response\.text\(\)\)/);
  assert.doesNotMatch(script, /claimToken\s*=/);
  const syntax = spawnSync("sh", ["-n"], { input: script, encoding: "utf8" });
  assert.equal(syntax.status, 0, syntax.stderr);
});

test("path and origin validation reject dangerous public installer input", () => {
  for (const value of ["/", "/etc/claudex/workhouse", "/data/../etc", "relative/path"]) {
    assert.throws(() => validateDataPath(value));
  }
  assert.throws(() => validateServerOrigin("http://127.0.0.1:3410", "local-only"));
  assert.throws(() =>
    validateServerOrigin("http://claudex.example.com", "cloudflare-existing")
  );
  assert.equal(
    validateServerOrigin("https://claudex.example.com", "cloudflare-existing"),
    "https://claudex.example.com"
  );
  assert.equal(
    validateDataPath("/volume1/공유 폴더/Claudex 작업장"),
    "/volume1/공유 폴더/Claudex 작업장"
  );
});

test("browser tar writer emits only the plan-specific four safe paths", async () => {
  const bundle = await createInstallerBundle(
    {
      id: "11111111-1111-4111-8111-111111111111",
      platform: "linux",
      dataPath: "/opt/claudex-workhouse",
      port: 3410,
      accessMode: "tailscale-existing",
      serverOrigin: "https://workhouse.example-tailnet.ts.net"
    },
    await verifiedRelease()
  );
  const tar = createTar(bundle);
  const names: string[] = [];
  for (let offset = 0; offset + 512 <= tar.length; ) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = new TextDecoder()
      .decode(header.subarray(0, 100))
      .replace(/\0.*$/, "");
    const sizeText = new TextDecoder()
      .decode(header.subarray(124, 136))
      .replace(/\0.*$/, "")
      .trim();
    const size = Number.parseInt(sizeText, 8);
    names.push(name);
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  assert.deepEqual(
    names,
    bundle.artifacts.map((artifact) => `${bundle.directoryName}/${artifact.path}`)
  );
  assert.equal(tar.length % 512, 0);
});
