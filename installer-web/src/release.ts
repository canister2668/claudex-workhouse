import type {
  InstallerBuildConfig,
  ReleaseKey,
  ReleaseManifest,
  VerifiedRelease,
  VerifiedReleaseKey,
  WorkerAsset
  ,WindowsServerAsset
  ,WindowsPortableAsset
} from "./types";

const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_SIGNATURE_BYTES = 16 * 1024;
const MAX_WORKER_BYTES = 2 * 1024 * 1024 * 1024;
const SHA256 = /^[a-f0-9]{64}$/;
const IMAGE_DIGEST = /^sha256:[a-f0-9]{64}$/;
const VERSION = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const REQUIREMENT = /^>=[0-9]+\.[0-9]+\.[0-9]+$/;
const KEY_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const SAFE_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SAFE_RELATIVE_PATH = /^[A-Za-z0-9][A-Za-z0-9._ /-]{0,255}$/;
const IMAGE_REPOSITORY =
  /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::[0-9]{2,5})?(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)+$/;

function objectValue(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} 형식이 올바르지 않습니다.`);
  }
  return value as Record<string, unknown>;
}

function strictObject(
  value: unknown,
  field: string,
  allowedKeys: readonly string[]
): Record<string, unknown> {
  const output = objectValue(value, field);
  const allowed = new Set(allowedKeys);
  const unexpected = Object.keys(output).find((key) => !allowed.has(key));
  if (unexpected) throw new Error(`${field}.${unexpected}은 지원하지 않는 필드입니다.`);
  return output;
}

function stringValue(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${field} 값이 없습니다.`);
  }
  return value;
}

function canonicalDate(value: unknown, field: string): string {
  const text = stringValue(value, field);
  const timestamp = Date.parse(text);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== text) {
    throw new Error(`${field}는 canonical UTC ISO-8601 형식이어야 합니다.`);
  }
  return text;
}

function httpsUrl(value: unknown, field: string): string {
  const text = stringValue(value, field);
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new Error(`${field} URL이 올바르지 않습니다.`);
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    url.pathname.includes("..") ||
    url.href !== text
  ) {
    throw new Error(
      `${field}는 자격증명·query·fragment·상위 경로가 없는 canonical HTTPS URL이어야 합니다.`
    );
  }
  return text;
}

function safeRelativePath(value: unknown, field: string): string {
  const text = stringValue(value, field);
  if (
    !SAFE_RELATIVE_PATH.test(text) ||
    text.startsWith("/") ||
    text.startsWith("\\") ||
    text.includes("\\") ||
    text.includes("//") ||
    text.split("/").some((part) => part === "." || part === "..")
  ) {
    throw new Error(`${field}는 정규화된 안전한 POSIX 상대 경로여야 합니다.`);
  }
  return text;
}

interface WorkerBinding {
  readonly platform: "windows" | "linux";
  readonly architecture: "x64" | "arm64";
  readonly format: "zip" | "tar.gz";
  readonly suffix: ".zip" | ".tar.gz";
  readonly launcher: boolean;
}

function workerAsset(value: unknown, field: string, binding: WorkerBinding): WorkerAsset {
  const item = strictObject(value, field, [
    "platform",
    "architecture",
    "format",
    "filename",
    "url",
    "size",
    "sha256",
    "minimumUpdaterProtocolVersion",
    "entrypoint",
    "launcher"
  ]);
  if (
    item.platform !== binding.platform ||
    item.architecture !== binding.architecture ||
    item.format !== binding.format
  ) {
    throw new Error(
      `${field}는 ${binding.platform}/${binding.architecture}/${binding.format} 자산이어야 합니다.`
    );
  }
  const filename = stringValue(item.filename, `${field}.filename`);
  if (!SAFE_FILE.test(filename) || !filename.endsWith(binding.suffix)) {
    throw new Error(`${field}.filename이 플랫폼 형식과 일치하지 않습니다.`);
  }
  const url = httpsUrl(item.url, `${field}.url`);
  if (!new URL(url).pathname.endsWith(`/${filename}`)) {
    throw new Error(`${field}.url과 filename이 일치하지 않습니다.`);
  }
  const size = item.size;
  if (
    typeof size !== "number" ||
    !Number.isSafeInteger(size) ||
    size < 1 ||
    size > MAX_WORKER_BYTES
  ) {
    throw new Error(`${field}.size가 허용 범위를 벗어났습니다.`);
  }
  const sha256 = stringValue(item.sha256, `${field}.sha256`);
  if (!SHA256.test(sha256)) throw new Error(`${field}.sha256이 올바르지 않습니다.`);
  const minimumUpdaterProtocolVersion=item.minimumUpdaterProtocolVersion;
  if(minimumUpdaterProtocolVersion!==undefined&&(!Number.isSafeInteger(minimumUpdaterProtocolVersion)||Number(minimumUpdaterProtocolVersion)<1||Number(minimumUpdaterProtocolVersion)>1_000_000))throw new Error(`${field}.minimumUpdaterProtocolVersion이 올바르지 않습니다.`);
  const entrypoint = safeRelativePath(item.entrypoint, `${field}.entrypoint`);
  const launcher =
    item.launcher === undefined
      ? undefined
      : safeRelativePath(item.launcher, `${field}.launcher`);
  if (binding.launcher !== Boolean(launcher)) {
    throw new Error(
      binding.launcher
        ? `${field}.launcher가 필요합니다.`
        : `${field}.launcher는 Windows 자산에만 허용됩니다.`
    );
  }
  return Object.freeze({
    platform: binding.platform,
    architecture: binding.architecture,
    format: binding.format,
    filename,
    url,
    size,
    sha256,
    ...(minimumUpdaterProtocolVersion!==undefined?{minimumUpdaterProtocolVersion:Number(minimumUpdaterProtocolVersion)}:{}),
    entrypoint,
    ...(launcher ? { launcher } : {})
  });
}
function windowsPortableAsset(value:unknown):WindowsPortableAsset{
  const field="windowsPortable",item=strictObject(value,field,["platform","architecture","format","filename","url","size","sha256","minimumUpdaterProtocolVersion"]);
  if(item.platform!=="windows"||item.architecture!=="x64"||item.format!=="zip"||item.filename!=="claudex-workhouse-server-windows-x64-portable.zip")throw new Error("windowsPortable은 공식 windows/x64/zip 자산이어야 합니다.");
  const filename="claudex-workhouse-server-windows-x64-portable.zip",url=httpsUrl(item.url,`${field}.url`);
  if(!new URL(url).pathname.endsWith(`/${filename}`))throw new Error("windowsPortable.url과 filename이 일치하지 않습니다.");
  const size=item.size;if(typeof size!=="number"||!Number.isSafeInteger(size)||size<1||size>MAX_WORKER_BYTES)throw new Error("windowsPortable.size가 허용 범위를 벗어났습니다.");
  const sha256=stringValue(item.sha256,`${field}.sha256`);if(!SHA256.test(sha256))throw new Error("windowsPortable.sha256이 올바르지 않습니다.");
  const protocol=item.minimumUpdaterProtocolVersion;if(typeof protocol!=="number"||!Number.isSafeInteger(protocol)||protocol<1||protocol>1_000_000)throw new Error("windowsPortable.minimumUpdaterProtocolVersion이 올바르지 않습니다.");
  return Object.freeze({platform:"windows",architecture:"x64",format:"zip",filename,url,size,sha256,minimumUpdaterProtocolVersion:protocol});
}
function windowsServerAsset(value:unknown):WindowsServerAsset{
  const field="windowsServer",item=strictObject(value,field,["platform","architecture","format","filename","url","size","sha256","authenticode"]);
  if(item.platform!=="windows"||item.architecture!=="x64"||item.format!=="exe")throw new Error("windowsServer는 windows/x64/exe 자산이어야 합니다.");
  const filename=stringValue(item.filename,`${field}.filename`);
  if(!SAFE_FILE.test(filename)||!filename.endsWith(".exe"))throw new Error("windowsServer.filename이 EXE 형식과 일치하지 않습니다.");
  const url=httpsUrl(item.url,`${field}.url`);
  if(!new URL(url).pathname.endsWith(`/${filename}`))throw new Error("windowsServer.url과 filename이 일치하지 않습니다.");
  const size=item.size;if(typeof size!=="number"||!Number.isSafeInteger(size)||size<1||size>MAX_WORKER_BYTES)throw new Error("windowsServer.size가 허용 범위를 벗어났습니다.");
  const sha256=stringValue(item.sha256,`${field}.sha256`);if(!SHA256.test(sha256))throw new Error("windowsServer.sha256이 올바르지 않습니다.");
  const rawSignature=objectValue(item.authenticode,`${field}.authenticode`);
  if(rawSignature.status==="unsigned"){
    const signature=strictObject(rawSignature,`${field}.authenticode`,["status"]);
    return Object.freeze({platform:"windows",architecture:"x64",format:"exe",filename,url,size,sha256,authenticode:Object.freeze({status:signature.status as "unsigned"})});
  }
  const signature=strictObject(rawSignature,`${field}.authenticode`,["status","certificateSha256","subject","timestamped"]);
  const certificateSha256=stringValue(signature.certificateSha256,`${field}.authenticode.certificateSha256`),subject=stringValue(signature.subject,`${field}.authenticode.subject`);
  if(signature.status!=="valid"||!SHA256.test(certificateSha256)||subject.length>512||signature.timestamped!==true)throw new Error("windowsServer Authenticode 정보가 올바르지 않습니다.");
  return Object.freeze({platform:"windows",architecture:"x64",format:"exe",filename,url,size,sha256,authenticode:Object.freeze({status:"valid",certificateSha256,subject,timestamped:true})});
}

export function validateReleaseManifest(
  input: unknown,
  now = new Date()
): ReleaseManifest {
  const value = strictObject(input, "manifest", [
    "schemaVersion",
    "channel",
    "version",
    "releaseSequence",
    "publishedAt",
    "expiresAt",
    "server",
    "windowsServer",
    "windowsPortable",
    "workers",
    "requirements",
    "legal",
    "signing"
  ]);
  if (value.schemaVersion !== 1&&value.schemaVersion!==2&&value.schemaVersion!==3) throw new Error("지원하지 않는 manifest schemaVersion입니다.");
  const schemaVersion=value.schemaVersion;
  const channel = stringValue(value.channel, "channel");
  if (!/^[a-z][a-z0-9-]{0,31}$/.test(channel)) {
    throw new Error("release channel이 올바르지 않습니다.");
  }
  const version = stringValue(value.version, "version");
  if (!VERSION.test(version)) throw new Error("release version이 올바르지 않습니다.");
  const releaseSequence = value.releaseSequence;
  if (
    typeof releaseSequence !== "number" ||
    !Number.isSafeInteger(releaseSequence) ||
    releaseSequence < 1
  ) {
    throw new Error("releaseSequence는 1 이상의 정수여야 합니다.");
  }
  const windowsServer=schemaVersion>=2?windowsServerAsset(value.windowsServer):undefined;
  if(schemaVersion===1&&value.windowsServer!==undefined)throw new Error("windowsServer는 manifest schemaVersion 2 이상에서만 허용됩니다.");
  const windowsPortable=schemaVersion===3?windowsPortableAsset(value.windowsPortable):undefined;
  if(schemaVersion!==3&&value.windowsPortable!==undefined)throw new Error("windowsPortable은 manifest schemaVersion 3에서만 허용됩니다.");
  const publishedAt = canonicalDate(value.publishedAt, "publishedAt");
  const expiresAt = canonicalDate(value.expiresAt, "expiresAt");
  const publishedTimestamp = Date.parse(publishedAt);
  const expiresTimestamp = Date.parse(expiresAt);
  if (publishedTimestamp > now.getTime() + 5 * 60_000) {
    throw new Error("manifest 게시 시각이 현재보다 지나치게 미래입니다.");
  }
  if (expiresTimestamp <= now.getTime() || expiresTimestamp <= publishedTimestamp) {
    throw new Error("manifest가 만료되었거나 만료 시각이 올바르지 않습니다.");
  }

  const serverInput = strictObject(value.server, "server", [
    "image",
    "tag",
    "digest",
    "platforms"
    ,"minimumUpdaterProtocolVersion"
  ]);
  const image = stringValue(serverInput.image, "server.image");
  if (!IMAGE_REPOSITORY.test(image) || image.includes("@")) {
    throw new Error("server.image가 올바른 registry 경로가 아닙니다.");
  }
  const tag = stringValue(serverInput.tag, "server.tag");
  if (!VERSION.test(tag) || tag !== version) {
    throw new Error("서버 이미지 tag와 release version이 일치하지 않습니다.");
  }
  const digest = stringValue(serverInput.digest, "server.digest");
  if (!IMAGE_DIGEST.test(digest)) throw new Error("서버 이미지 digest가 올바르지 않습니다.");
  const serverProtocol=serverInput.minimumUpdaterProtocolVersion;
  if(schemaVersion===3){if(typeof serverProtocol!=="number"||!Number.isSafeInteger(serverProtocol)||serverProtocol<1||serverProtocol>1_000_000)throw new Error("server.minimumUpdaterProtocolVersion이 올바르지 않습니다.");}
  else if(serverProtocol!==undefined)throw new Error("server.minimumUpdaterProtocolVersion은 schemaVersion 3에서만 허용됩니다.");
  if (!Array.isArray(serverInput.platforms) || serverInput.platforms.length !== 2) {
    throw new Error("서버 플랫폼은 linux/amd64와 linux/arm64를 정확히 포함해야 합니다.");
  }
  const platforms = serverInput.platforms.map((platform) => {
    if (platform !== "linux/amd64" && platform !== "linux/arm64") {
      throw new Error(`지원하지 않는 서버 플랫폼입니다: ${String(platform)}`);
    }
    return platform;
  });
  const platformSet = new Set(platforms);
  if (
    platformSet.size !== 2 ||
    !platformSet.has("linux/amd64") ||
    !platformSet.has("linux/arm64")
  ) {
    throw new Error("서버 플랫폼은 linux/amd64와 linux/arm64를 정확히 포함해야 합니다.");
  }

  const workersInput = strictObject(value.workers, "workers", [
    "windows-x64",
    "linux-x64",
    "linux-arm64"
  ]);
  const windowsWorker = workerAsset(workersInput["windows-x64"], "workers.windows-x64", {
    platform: "windows",
    architecture: "x64",
    format: "zip",
    suffix: ".zip",
    launcher: true
  });
  const linuxX64 = workerAsset(workersInput["linux-x64"], "workers.linux-x64", {
    platform: "linux",
    architecture: "x64",
    format: "tar.gz",
    suffix: ".tar.gz",
    launcher: false
  });
  const linuxArm64 = workerAsset(workersInput["linux-arm64"], "workers.linux-arm64", {
    platform: "linux",
    architecture: "arm64",
    format: "tar.gz",
    suffix: ".tar.gz",
    launcher: false
  });
  const workerDirectories = new Set(
    [windowsWorker, linuxX64, linuxArm64].map((worker) => new URL(".", worker.url).href)
  );
  if (workerDirectories.size !== 1) {
    throw new Error("Worker 자산은 하나의 불변 릴리스 디렉터리를 사용해야 합니다.");
  }
  if(windowsServer&&new URL(".",windowsServer.url).href!==[...workerDirectories][0])throw new Error("Windows server와 Worker 자산은 하나의 불변 릴리스 디렉터리를 사용해야 합니다.");
  if(windowsPortable&&new URL(".",windowsPortable.url).href!==[...workerDirectories][0])throw new Error("Windows portable과 Worker 자산은 하나의 불변 릴리스 디렉터리를 사용해야 합니다.");
  for(const worker of[windowsWorker,linuxX64,linuxArm64]){
    if(schemaVersion===3&&worker.minimumUpdaterProtocolVersion===undefined)throw new Error("schemaVersion 3 Worker에는 minimumUpdaterProtocolVersion이 필요합니다.");
    if(schemaVersion!==3&&worker.minimumUpdaterProtocolVersion!==undefined)throw new Error("Worker minimumUpdaterProtocolVersion은 schemaVersion 3에서만 허용됩니다.");
  }

  const requirementsInput = strictObject(value.requirements, "requirements", [
    "docker",
    "compose"
  ]);
  const docker = stringValue(requirementsInput.docker, "requirements.docker");
  const compose = stringValue(requirementsInput.compose, "requirements.compose");
  if (!REQUIREMENT.test(docker) || !REQUIREMENT.test(compose)) {
    throw new Error("Docker와 Compose 요구 버전은 >=x.y.z 형식이어야 합니다.");
  }
  let legal:ReleaseManifest["legal"];
  if(value.legal!==undefined){
    const input=strictObject(value.legal,"legal",["license","notice","thirdPartyNotices"]);
    if(input.license!=="AGPL-3.0-only"||input.notice!=="NOTICE.md"||input.thirdPartyNotices!=="THIRD_PARTY_NOTICES.md")throw new Error("manifest legal 고지가 올바르지 않습니다.");
    legal=Object.freeze({license:"AGPL-3.0-only",notice:"NOTICE.md",thirdPartyNotices:"THIRD_PARTY_NOTICES.md"});
  }
  const signingInput = strictObject(value.signing, "signing", ["keyId", "algorithm"]);
  const keyId = stringValue(signingInput.keyId, "signing.keyId");
  if (!KEY_ID.test(keyId) || signingInput.algorithm !== "rsa-sha256") {
    throw new Error("manifest signing 정보가 올바르지 않습니다.");
  }

  return Object.freeze({
    schemaVersion,
    channel,
    version,
    releaseSequence,
    publishedAt,
    expiresAt,
    server: Object.freeze({
      image,
      tag,
      digest,
      platforms: Object.freeze(platforms)
      ,...(serverProtocol!==undefined?{minimumUpdaterProtocolVersion:Number(serverProtocol)}:{})
    }),
    ...(windowsServer?{windowsServer}:{}),
    ...(windowsPortable?{windowsPortable}:{}),
    workers: Object.freeze({
      "windows-x64": windowsWorker,
      "linux-x64": linuxX64,
      "linux-arm64": linuxArm64
    }),
    requirements: Object.freeze({ docker, compose }),
    ...(legal?{legal}:{}),
    signing: Object.freeze({ keyId, algorithm: "rsa-sha256" })
  });
}

function pemBytes(pem: string): Uint8Array {
  const normalized = pem.replace(/\r\n/g, "\n");
  const match =
    /^-----BEGIN PUBLIC KEY-----\n([A-Za-z0-9+/=\n]+)-----END PUBLIC KEY-----\n?$/.exec(
      normalized
    );
  if (!match) throw new Error("내장 공개 키 PEM 형식이 올바르지 않습니다.");
  const binary = atob(match[1].replace(/\n/g, ""));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function arrayBuffer(bytes: Uint8Array | ArrayBuffer): ArrayBuffer {
  return bytes instanceof Uint8Array ? bytes.slice().buffer : bytes;
}

function base64UrlToBase64(value: string): string {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  return base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
}

export async function sha256Hex(bytes: Uint8Array | ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", arrayBuffer(bytes));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function canonicalPem(spki: ArrayBuffer): string {
  const binary = String.fromCharCode(...new Uint8Array(spki));
  const base64 = btoa(binary);
  const lines = base64.match(/.{1,64}/g);
  if (!lines) throw new Error("공개 키를 canonical PEM으로 변환하지 못했습니다.");
  return `-----BEGIN PUBLIC KEY-----\n${lines.join("\n")}\n-----END PUBLIC KEY-----\n`;
}

async function importActiveKey(
  key: ReleaseKey,
  now: Date
): Promise<{ key: VerifiedReleaseKey; cryptoKey: CryptoKey }> {
  if (
    key.algorithm !== "rsa-sha256" ||
    !KEY_ID.test(key.keyId) ||
    typeof key.revoked !== "boolean" ||
    typeof key.publicKeyPem !== "string"
  ) {
    throw new Error("릴리스 공개 키 정보가 올바르지 않습니다.");
  }
  if (key.revoked) throw new Error("릴리스 서명 키가 폐기되었습니다.");
  const notBefore = Date.parse(canonicalDate(key.notBefore, "key.notBefore"));
  const expiresAt = Date.parse(canonicalDate(key.expiresAt, "key.expiresAt"));
  if (notBefore >= expiresAt) throw new Error("릴리스 공개 키 유효 기간이 올바르지 않습니다.");
  if (now.getTime() < notBefore) throw new Error("릴리스 서명 키가 아직 유효하지 않습니다.");
  if (now.getTime() >= expiresAt) throw new Error("릴리스 서명 키가 만료되었습니다.");

  let cryptoKey: CryptoKey;
  try {
    cryptoKey = await crypto.subtle.importKey(
      "spki",
      arrayBuffer(pemBytes(key.publicKeyPem)),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      true,
      ["verify"]
    );
  } catch {
    throw new Error("릴리스 공개 키가 유효한 RSA SPKI 키가 아닙니다.");
  }
  const publicKeyPem = canonicalPem(await crypto.subtle.exportKey("spki", cryptoKey));
  const jwk = await crypto.subtle.exportKey("jwk", cryptoKey);
  if (jwk.kty !== "RSA" || !jwk.n || !jwk.e) {
    throw new Error("릴리스 공개 키에서 RSA 검증 파라미터를 만들 수 없습니다.");
  }
  return {
    cryptoKey,
    key: Object.freeze({
      keyId: key.keyId,
      algorithm: "rsa-sha256",
      publicKeyPem,
      notBefore: key.notBefore,
      expiresAt: key.expiresAt,
      revoked: false,
      publicKeySha256: await sha256Hex(new TextEncoder().encode(publicKeyPem)),
      modulusBase64: base64UrlToBase64(jwk.n),
      exponentBase64: base64UrlToBase64(jwk.e)
    })
  };
}

function allowedOrigins(values: readonly string[], field: string): Set<string> {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error(`${field} 신뢰 목록이 비어 있습니다.`);
  }
  const output = new Set<string>();
  for (const value of values) {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error(`${field}에 잘못된 URL이 있습니다.`);
    }
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      throw new Error(`${field}에는 경로 없는 HTTPS origin만 허용됩니다.`);
    }
    output.add(url.origin);
  }
  return output;
}

function assertReleasePolicy(
  manifest: ReleaseManifest,
  config: Pick<
    InstallerBuildConfig,
    | "manifestUrl"
    | "signatureUrl"
    | "expectedChannel"
    | "allowedImageRepositories"
    | "allowedWorkerOrigins"
  >
): void {
  const manifestOrigin = new URL(config.manifestUrl).origin;
  if (manifestOrigin !== new URL(config.signatureUrl).origin) {
    throw new Error("manifest와 signature origin이 일치하지 않습니다.");
  }
  if (manifest.channel !== config.expectedChannel) {
    throw new Error("manifest release channel이 설치 페이지의 신뢰 정책과 일치하지 않습니다.");
  }
  if (
    !Array.isArray(config.allowedImageRepositories) ||
    !config.allowedImageRepositories.includes(manifest.server.image)
  ) {
    throw new Error("서버 이미지 저장소가 설치 페이지의 신뢰 목록에 없습니다.");
  }
  const workerOrigins = allowedOrigins(config.allowedWorkerOrigins, "Worker origin");
  for (const key of ["windows-x64", "linux-x64", "linux-arm64"] as const) {
    if (!workerOrigins.has(new URL(manifest.workers[key].url).origin)) {
      throw new Error(`${key} Worker 다운로드 origin이 신뢰 목록에 없습니다.`);
    }
  }
  if(manifest.windowsServer&&!workerOrigins.has(new URL(manifest.windowsServer.url).origin))throw new Error("Windows server 다운로드 origin이 신뢰 목록에 없습니다.");
  if(manifest.windowsPortable&&!workerOrigins.has(new URL(manifest.windowsPortable.url).origin))throw new Error("Windows portable 다운로드 origin이 신뢰 목록에 없습니다.");
}

export async function verifyReleaseBytes(
  manifestBytes: Uint8Array,
  signatureBytes: Uint8Array,
  config: Pick<
    InstallerBuildConfig,
    | "manifestUrl"
    | "signatureUrl"
    | "keyRing"
    | "expectedChannel"
    | "allowedImageRepositories"
    | "allowedWorkerOrigins"
  >,
  now = new Date()
): Promise<VerifiedRelease> {
  if (manifestBytes.length < 2 || manifestBytes.length > MAX_MANIFEST_BYTES) {
    throw new Error("manifest 크기가 허용 범위를 벗어났습니다.");
  }
  if (signatureBytes.length < 64 || signatureBytes.length > MAX_SIGNATURE_BYTES) {
    throw new Error("manifest signature 크기가 허용 범위를 벗어났습니다.");
  }
  const manifestUrl = httpsUrl(config.manifestUrl, "manifestUrl");
  const signatureUrl = httpsUrl(config.signatureUrl, "signatureUrl");

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes));
  } catch {
    throw new Error("manifest JSON을 읽을 수 없습니다.");
  }
  const manifest = validateReleaseManifest(parsed, now);
  const selectedKey = config.keyRing.find((key) => key.keyId === manifest.signing.keyId);
  if (!selectedKey) throw new Error("manifest의 서명 키를 신뢰 키 ring에서 찾지 못했습니다.");
  const verified = await importActiveKey(selectedKey, now);
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    verified.cryptoKey,
    arrayBuffer(signatureBytes),
    arrayBuffer(manifestBytes)
  );
  if (!valid) throw new Error("신뢰된 공개 키로 manifest 서명을 검증하지 못했습니다.");

  const keyNotBefore = Date.parse(verified.key.notBefore);
  const keyExpiresAt = Date.parse(verified.key.expiresAt);
  const manifestPublishedAt = Date.parse(manifest.publishedAt);
  const manifestExpiresAt = Date.parse(manifest.expiresAt);
  if (
    manifestPublishedAt < keyNotBefore ||
    manifestPublishedAt >= keyExpiresAt ||
    manifestExpiresAt > keyExpiresAt
  ) {
    throw new Error("manifest 유효 기간이 서명 키 유효 기간을 벗어났습니다.");
  }
  assertReleasePolicy(manifest, {
    manifestUrl,
    signatureUrl,
    expectedChannel: config.expectedChannel,
    allowedImageRepositories: config.allowedImageRepositories,
    allowedWorkerOrigins: config.allowedWorkerOrigins
  });
  const immutableBase = new URL(".", manifest.workers["windows-x64"].url);

  return Object.freeze({
    manifest,
    manifestBytes,
    signatureBytes,
    manifestSha256: await sha256Hex(manifestBytes),
    verifiedKey: verified.key,
    verifiedAt: now.toISOString(),
    manifestUrl,
    signatureUrl,
    immutableManifestUrl: new URL("release-manifest.json", immutableBase).href,
    immutableSignatureUrl: new URL("release-manifest.json.sig", immutableBase).href
  });
}

async function fetchBounded(url: string, maximum: number, label: string): Promise<Uint8Array> {
  const response = await fetch(url, {
    cache: "no-store",
    credentials: "omit",
    redirect: "error",
    referrerPolicy: "no-referrer"
  });
  if (!response.ok) throw new Error(`${label} 다운로드 실패: HTTP ${response.status}`);
  const declaredValue = response.headers.get("content-length");
  if (declaredValue !== null) {
    const declared = Number(declaredValue);
    if (!Number.isSafeInteger(declared) || declared < 1 || declared > maximum) {
      throw new Error(`${label} Content-Length가 올바르지 않습니다.`);
    }
  }
  if (!response.body) throw new Error(`${label} 응답 본문이 없습니다.`);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      total += result.value.byteLength;
      if (total > maximum) {
        await reader.cancel().catch(() => {});
        throw new Error(`${label} 응답이 너무 큽니다.`);
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  if (total < 1) throw new Error(`${label} 응답이 비어 있습니다.`);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

export async function fetchAndVerifyRelease(
  config: InstallerBuildConfig,
  now = new Date()
): Promise<VerifiedRelease> {
  if (!config.configured) {
    throw new Error(
      config.configurationError ??
        "공식 릴리스 신뢰 정보가 빌드에 설정되지 않아 설치가 비활성화되었습니다."
    );
  }
  if (!config.keyRing.length) throw new Error("내장된 릴리스 공개 키가 없습니다.");
  const [manifestBytes, signatureBytes] = await Promise.all([
    fetchBounded(config.manifestUrl, MAX_MANIFEST_BYTES, "manifest"),
    fetchBounded(config.signatureUrl, MAX_SIGNATURE_BYTES, "manifest signature")
  ]);
  return verifyReleaseBytes(manifestBytes, signatureBytes, config, now);
}

export async function fetchVerifiedWorkerAsset(asset: WorkerAsset): Promise<Uint8Array> {
  if (
    !Number.isSafeInteger(asset.size) ||
    asset.size < 1 ||
    asset.size > MAX_WORKER_BYTES ||
    !SHA256.test(asset.sha256)
  ) {
    throw new Error("Worker 자산 검증 정보가 올바르지 않습니다.");
  }
  const url = httpsUrl(asset.url, "Worker asset URL");
  const response = await fetch(url, {
    cache: "no-store",
    credentials: "omit",
    redirect: "error",
    referrerPolicy: "no-referrer"
  });
  if (!response.ok) {
    throw new Error(`Worker 패키지 다운로드 실패: HTTP ${response.status}`);
  }
  const declaredValue = response.headers.get("content-length");
  if (declaredValue !== null) {
    const declared = Number(declaredValue);
    if (!Number.isSafeInteger(declared) || declared !== asset.size) {
      throw new Error(
        `Worker 패키지 Content-Length가 manifest와 다릅니다. 예상 ${asset.size}, 응답 ${declaredValue}`
      );
    }
  }
  if (!response.body) throw new Error("Worker 패키지 응답 본문이 없습니다.");

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      total += result.value.byteLength;
      if (total > asset.size || total > MAX_WORKER_BYTES) {
        await reader.cancel().catch(() => {});
        throw new Error("Worker 패키지가 manifest의 크기 상한을 초과했습니다.");
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  if (total !== asset.size) {
    throw new Error(`Worker 패키지 크기가 다릅니다. 예상 ${asset.size}, 실제 ${total}`);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const digest = await sha256Hex(bytes);
  if (digest !== asset.sha256) {
    throw new Error("Worker 패키지 SHA-256이 manifest와 일치하지 않아 실행할 수 없습니다.");
  }
  return bytes;
}
