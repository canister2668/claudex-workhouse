import { createTarGzip, gzipSupported } from "./archive";
import { installerConfig } from "./config";
import { createInstallerBundle } from "./deployment";
import {
  fetchAndVerifyRelease,
  sha256Hex
} from "./release";
import { createWindowsWorkerDownload } from "./worker-download";
import { createWindowsDockerDownload } from "./windows-docker-download";
import{createWindowsServerDownload}from"./windows-server-download";
import type {
  AccessMode,
  InstallerBundle,
  InstallerPlatform,
  VerifiedRelease
} from "./types";

const root = document.getElementById("app")!;
if (!root) throw new Error("Installer root is unavailable.");

// The Windows targets are built and tested, but not released. The portable
// server only completes a launch once its own payload manifest is edited, and
// the native Worker path still loses hook execution, Codex CLI installation and
// live session progress. Until those hold on a clean Windows 11 machine the
// installer offers the Docker routes only and shows the rest as in development.
const RELEASED_PLATFORMS = ["synology", "linux"] as const;
const IN_DEVELOPMENT_PLATFORMS = ["windows-docker", "windows-worker", "windows-server"] as const;
const IN_DEVELOPMENT_REASONS: Record<(typeof IN_DEVELOPMENT_PLATFORMS)[number], string> = {
  "windows-docker": "Provider 로그인이 Windows Worker에 묶여 있음",
  "windows-worker": "훅·Codex CLI 설치·세션 표시 미검증",
  "windows-server": "포터블 서버 기동 미검증"
};

const CHECKLISTS: Record<InstallerPlatform, readonly string[]> = {
  "windows-docker": [
    "Windows 11 x64에서 Docker Desktop의 Linux container engine을 사용합니다.",
    "Docker Desktop과 Docker Compose v2를 설치하고 실행했습니다.",
    "메인 서버는 컨테이너에, Provider 로그인과 작업 폴더 접근은 current-user Worker에 둡니다.",
    "기본 주소 http://127.0.0.1:3410은 이 PC에서만 열립니다."
  ],
  synology: [
    "DSM 7과 Container Manager가 설치되어 있습니다.",
    "공유 폴더를 만들고 저장 경로를 확인했습니다.",
    "설치 명령을 실행할 SSH 또는 관리자 작업 환경이 있습니다.",
    "초기 폴더 소유권 설정에 필요한 관리자 권한을 사용할 수 있습니다."
  ],
  linux: [
    "Docker Engine이 설치되어 있습니다.",
    "Docker Compose 2.20 이상을 사용할 수 있습니다.",
    "저장 경로와 포트 사용 권한을 확인했습니다.",
    "초기 폴더 소유권 설정에 필요한 root 권한을 사용할 수 있습니다."
  ],
  "windows-worker": [
    "기존 Claudex Workhouse 메인 서버가 있습니다.",
    "Windows x64와 PowerShell을 사용합니다.",
    "현재 사용자 폴더에 프로그램을 설치할 수 있습니다.",
    "Claude Code 또는 Codex 로그인은 이 Windows 사용자에서 직접 진행합니다."
  ],
  "windows-server":[
    "Windows 11 x64와 PowerShell을 사용합니다.",
    "현재 사용자 Downloads 폴더에 프로그램을 저장할 수 있습니다.",
    "관리자 권한 없이 현재 사용자 범위에서 실행합니다.",
    "이 무료 릴리스는 코드서명되지 않아 Windows SmartScreen 경고가 표시될 수 있습니다."
  ],
};

const state: {
  platform: InstallerPlatform;
  checks: Set<number>;
  dataPath: string;
  port: number;
  accessMode: AccessMode;
  serverOrigin: string;
  release: VerifiedRelease | null;
  releaseBusy: boolean;
  releaseError: string;
  bundle: InstallerBundle | null;
  notice: string;
  archiveBusy: boolean;
  archiveSha256: string;
  workerBusy: boolean;
  workerError: string;
} = {
  platform: "synology",
  checks: new Set(),
  dataPath: "/volume1/docker/claudex-workhouse",
  port: 3410,
  accessMode: "local-only",
  serverOrigin: "",
  release: null,
  releaseBusy: false,
  releaseError: "",
  bundle: null,
  notice: "",
  archiveBusy: false,
  archiveSha256: "",
  workerBusy: false,
  workerError: ""
};

function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatBytes(value: number): string {
  return new Intl.NumberFormat("ko-KR", {
    style: "unit",
    unit: value >= 1024 * 1024 ? "megabyte" : "kilobyte",
    maximumFractionDigits: 1
  }).format(value / (value >= 1024 * 1024 ? 1024 * 1024 : 1024));
}

function platformLabel(platform: InstallerPlatform): string {
  return platform === "windows-docker"
    ? "Windows + Docker Desktop"
    : platform === "synology"
    ? "Synology NAS"
    : platform === "linux"
      ? "Linux"
      : platform==="windows-server"?"Windows 메인 서버":"Windows Worker";
}

function windowsDockerPanel(): string {
  if (!state.release) {
    return `<section class="panel blocked"><h2>Windows Docker Desktop 설치</h2><p>릴리스 서명이 검증되기 전에는 설치 파일을 만들 수 없습니다.</p><button disabled>설치 비활성화</button></section>`;
  }
  const script = createWindowsDockerDownload(state.release);
  const image = `${state.release.manifest.server.image}:${state.release.manifest.server.tag}@${state.release.manifest.server.digest}`;
  return `<section class="panel recommended">
    <span class="route-badge">Windows 권장 경로</span>
    <h2>Docker Desktop 메인 서버 설치</h2>
    <p>메인 서버와 데이터는 Docker Desktop에서 실행하고, Claude Code·Codex 로그인과 로컬 작업 폴더는 다음 단계에서 Windows Worker에 연결합니다.</p>
    <ol class="install-steps">
      <li><strong>Docker Desktop 준비</strong><span>Linux container engine이 실행 중인지 확인합니다.</span></li>
      <li><strong>검증 설치 스크립트 실행</strong><span>서명된 manifest의 정확한 image digest로 서버를 시작합니다.</span></li>
      <li><strong>브라우저 초기 설정</strong><span>owner claim을 완료한 뒤 서버에서 Worker pairing code를 만듭니다.</span></li>
      <li><strong>Windows Worker 연결</strong><span>현재 사용자 계정의 Claude Code·Codex 로그인과 작업 폴더를 진단합니다.</span></li>
    </ol>
    <dl class="facts"><div><dt>고정 이미지</dt><dd title="${escapeHtml(image)}">${escapeHtml(image)}</dd></div><div><dt>로컬 주소</dt><dd>http://127.0.0.1:3410</dd></div></dl>
    <button class="primary" data-action="download-windows-docker" ${state.workerBusy || !allChecksComplete() ? "disabled" : ""}>${state.workerBusy ? "스크립트 생성 중…" : "Docker Desktop 설치 스크립트 받기"}</button>
    ${state.workerError ? `<p class="error" role="alert">${escapeHtml(state.workerError)}</p>` : ""}
    <details><summary>다운로드한 스크립트 실행 방법</summary><pre>${escapeHtml(script.launchCommand)}</pre><p><small><code>Bypass</code>는 이 자식 PowerShell 프로세스에만 적용됩니다. 스크립트는 서명과 manifest 유효기간을 다시 확인하고 <code>latest</code>가 아닌 정확한 digest를 사용합니다.</small></p></details>
    <div class="callout"><strong>Provider 자격증명은 컨테이너에 넣지 않습니다.</strong><p>서버 설치 후 위의 Windows Worker 탭에서 Worker를 받고, 서버가 만든 10분짜리 pairing code로 연결하세요.</p></div>
  </section>`;
}

function allChecksComplete(): boolean {
  return state.checks.size === CHECKLISTS[state.platform].length;
}

function originPlaceholder(): string {
  if (state.accessMode === "tailscale-existing") return "https://nas.example-tailnet.ts.net";
  if (state.accessMode === "cloudflare-existing") return "https://claudex.example.com";
  return `http://192.168.1.20:${state.port}`;
}

function releaseCard(): string {
  if (state.releaseBusy) {
    return `<section class="panel release pending"><h2>공식 릴리스 확인</h2><p>manifest와 detached signature를 검증하고 있습니다…</p></section>`;
  }
  if (!state.release) {
    return `<section class="panel release failed"><h2>공식 릴리스 확인</h2><strong>설치 비활성화</strong><p>${escapeHtml(state.releaseError || "릴리스 검증이 완료되지 않았습니다.")}</p><button data-action="verify-release">다시 확인</button></section>`;
  }
  const { manifest, verifiedKey, manifestSha256, verifiedAt } = state.release;
  return `<section class="panel release verified">
    <h2>공식 릴리스 확인</h2>
    <div class="status-line"><span class="status-dot"></span><strong>서명 검증 완료</strong></div>
    <dl class="facts">
      <div><dt>버전</dt><dd>${escapeHtml(manifest.version)}</dd></div>
      <div><dt>채널·순번</dt><dd>${escapeHtml(manifest.channel)} · ${manifest.releaseSequence}</dd></div>
      <div><dt>이미지 digest</dt><dd title="${escapeHtml(manifest.server.digest)}">${escapeHtml(manifest.server.digest)}</dd></div>
      <div><dt>검증 키</dt><dd>${escapeHtml(verifiedKey.keyId)}</dd></div>
      <div><dt>manifest SHA-256</dt><dd title="${manifestSha256}">${manifestSha256}</dd></div>
      <div><dt>만료</dt><dd>${escapeHtml(manifest.expiresAt)}</dd></div>
      <div><dt>검증 시각</dt><dd>${escapeHtml(verifiedAt)}</dd></div>
    </dl>
  </section>`;
}

function workerPanel(): string {
  if (!state.release) {
    return `<section class="panel blocked"><h2>Windows Worker 패키지</h2><p>릴리스 서명이 검증되기 전에는 다운로드할 수 없습니다.</p><button disabled>다운로드 비활성화</button></section>`;
  }
  const worker = state.release.manifest.workers["windows-x64"];
  const script = createWindowsWorkerDownload(state.release);
  return `<section class="panel">
    <h2>Windows PC를 Worker로 연결</h2>
    <p>아래 패키지는 기존 메인 서버에 연결하는 현재 사용자 범위 x64 Worker입니다.</p>
    <dl class="facts">
      <div><dt>파일</dt><dd>${escapeHtml(worker.filename)}</dd></div>
      <div><dt>크기</dt><dd>${formatBytes(worker.size)}</dd></div>
      <div><dt>SHA-256</dt><dd title="${worker.sha256}">${worker.sha256}</dd></div>
      <div><dt>릴리스</dt><dd>${escapeHtml(state.release.manifest.version)}</dd></div>
    </dl>
    <button class="primary" data-action="download-worker" ${state.workerBusy ? "disabled" : ""}>${state.workerBusy ? "스크립트 생성 중…" : "검증 다운로드 스크립트 받기"}</button>
    ${state.workerError ? `<p class="error" role="alert">${escapeHtml(state.workerError)}</p>` : ""}
    <p><small>GitHub Release의 최종 다운로드 서버는 브라우저 해시 검사용 CORS를 보장하지 않습니다. 서명된 manifest와 공개 키가 포함된 current-user PowerShell 스크립트가 Windows에서 실제 ZIP의 서명·크기·SHA-256을 검증합니다.</small></p>
    <details><summary>다운로드한 스크립트 실행 방법</summary>
      <p>PowerShell을 열고 아래 명령을 한 번 실행하세요. 이 명령의 <code>Bypass</code>는 이 자식 프로세스에만 적용되며 Windows의 전역 실행 정책을 바꾸지 않습니다.</p>
      <pre>${escapeHtml(script.launchCommand)}</pre>
      <p><small>인터넷에서 받은 파일 표시 때문에 기본 <code>Restricted</code> 또는 <code>RemoteSigned</code> 정책이 스크립트를 막는 경우에도 이 명령을 사용합니다. 전역 <code>Set-ExecutionPolicy</code> 변경은 필요하지 않습니다.</small></p>
    </details>
    <div class="callout"><strong>Pairing은 기존 서버에서 시작합니다.</strong><p>Workhouse의 ‘서버 및 실행 장치 → 장치 추가’에서 10분짜리 pairing code를 만든 뒤 Windows Worker에 입력하세요. 이 정적 페이지는 pairing code나 장치 credential을 생성하지 않습니다.</p></div>
  </section>`;
}
function windowsServerPanel():string{
  const asset=state.release?.manifest.windowsServer;
  if(!state.release||state.release.manifest.schemaVersion<2||!asset)return`<section class="panel blocked"><h2>Windows 메인 서버</h2><p>검증된 schema v2 이상 릴리스에 Windows server EXE가 포함되어야 합니다.</p><button disabled>다운로드 비활성화</button></section>`;
  const script=createWindowsServerDownload(state.release);
  const signature=asset.authenticode.status==="valid"?asset.authenticode.subject:"코드서명 없음";
  const unsignedNotice=asset.authenticode.status==="unsigned"?`<div class="callout"><strong>Windows 코드서명 없음</strong><p>무료 공개 프로그램으로 Authenticode 인증서를 구매하지 않았습니다. Microsoft Defender SmartScreen이 ‘알 수 없는 게시자’를 표시할 수 있으므로 공식 GitHub Release에서만 받고 아래 SHA-256을 확인하세요.</p></div>`:"";
  return`<section class="panel"><h2>Windows 메인 서버</h2><p>관리자 권한 없이 현재 Windows 사용자 범위에서 실행되는 x64 단일 EXE입니다.</p>${unsignedNotice}<dl class="facts">
    <div><dt>파일</dt><dd>${escapeHtml(asset.filename)}</dd></div><div><dt>크기</dt><dd>${formatBytes(asset.size)}</dd></div>
    <div><dt>SHA-256</dt><dd title="${asset.sha256}">${asset.sha256}</dd></div><div><dt>코드서명</dt><dd>${escapeHtml(signature)}</dd></div>
  </dl><button class="primary" data-action="download-windows-server" ${state.workerBusy?"disabled":""}>${state.workerBusy?"스크립트 생성 중…":"검증 다운로드 스크립트 받기"}</button>
  ${state.workerError?`<p class="error" role="alert">${escapeHtml(state.workerError)}</p>`:""}
  <p><small>스크립트는 Workhouse가 서명한 release manifest와 EXE size·SHA-256을 실제 Windows에서 확인합니다. 이는 Windows Authenticode 코드서명과는 별개입니다.</small></p>
  <details><summary>다운로드한 스크립트 실행 방법</summary><pre>${escapeHtml(script.launchCommand)}</pre><p><small>ExecutionPolicy Bypass는 이 PowerShell 자식 프로세스에만 적용되며 전역 정책을 바꾸지 않습니다. 위 명령의 EncodedCommand는 셸이 <code>$</code> 변수를 먼저 바꾸지 못하게 한 UTF-16LE 인코딩이며, 실제 내용은 아래와 같습니다.</small></p><pre>${escapeHtml(script.launchScript)}</pre></details></section>`;
}

function bundlePanel(): string {
  if (!state.bundle) return "";
  const bundle = state.bundle;
  const installCommand = state.archiveSha256
    ? `printf '%s  %s\\n' '${state.archiveSha256}' './${bundle.archiveName}' | sha256sum -c - && test ! -e './${bundle.directoryName}' && tar -xzf './${bundle.archiveName}' && cd './${bundle.directoryName}' && sh ./install.sh`
    : "tar.gz를 다운로드하면 검증 SHA-256과 정확한 실행 명령이 여기에 표시됩니다. 개별 파일을 같은 폴더에 받은 경우 sh ./install.sh 를 실행하세요.";
  return `<section class="panel bundle">
    <h2>설치 꾸러미 준비 완료</h2>
    <p>아래 파일은 브라우저 메모리에서 생성됐으며 서버로 전송되지 않았습니다.</p>
    <ul class="artifact-list">${bundle.artifacts
      .map(
        (artifact) =>
          `<li><span><code>${escapeHtml(artifact.path)}</code><small>SHA-256 ${artifact.sha256}</small></span><button data-file="${escapeHtml(artifact.path)}">파일 다운로드</button></li>`
      )
      .join("")}</ul>
    <button class="primary" data-action="download-archive" ${state.archiveBusy ? "disabled" : ""}>${state.archiveBusy ? "tar.gz 생성 중…" : gzipSupported() ? "전체 tar.gz 다운로드" : "이 브라우저에서는 개별 파일만 다운로드 가능"}</button>
    <details ${state.archiveSha256 ? "open" : ""}><summary>NAS/Linux에서 실행할 명령</summary><pre>${escapeHtml(installCommand)}</pre></details>
    <div class="callout"><strong>Owner claim은 설치된 서버가 만듭니다.</strong><p>install.sh가 출력하는 claim URL, 만료 시각, server fingerprint를 사용하세요. 이 페이지는 claim token을 생성하거나 조회하지 않습니다.</p></div>
  </section>`;
}

function serverForm(): string {
  return `<section class="panel">
    <h2>${escapeHtml(platformLabel(state.platform))} 서버 설정</h2>
    <div class="form-grid">
      <label>저장 경로<input data-field="dataPath" value="${escapeHtml(state.dataPath)}" autocomplete="off" spellcheck="false"></label>
      <label>호스트 포트<input data-field="port" type="number" min="1024" max="65535" value="${state.port}"></label>
      <label>접속 방식<select data-field="accessMode">
        <option value="local-only" ${state.accessMode === "local-only" ? "selected" : ""}>같은 네트워크에서 접속</option>
        <option value="tailscale-existing" ${state.accessMode === "tailscale-existing" ? "selected" : ""}>기존 Tailscale HTTPS</option>
        <option value="cloudflare-existing" ${state.accessMode === "cloudflare-existing" ? "selected" : ""}>기존 Cloudflare Tunnel</option>
      </select></label>
      <label>서버에서 사용할 접속 주소<input data-field="serverOrigin" type="url" value="${escapeHtml(state.serverOrigin)}" placeholder="${escapeHtml(originPlaceholder())}" autocomplete="off" spellcheck="false"><small>${state.accessMode === "local-only" ? "NAS/Linux의 사설 IP 또는 .local 주소" : "이미 설정되어 대상 서버로 연결되는 HTTPS 주소"}</small></label>
    </div>
    <details><summary>기술 정보</summary><p>컨테이너 내부 포트는 3410이며, 공개 포트만 위 값으로 바뀝니다. 원격 접속 모드는 host loopback에만 bind합니다. Docker socket과 privileged 모드는 사용하지 않습니다.</p></details>
    <button class="primary" data-action="generate-bundle" ${!state.release || !allChecksComplete() ? "disabled" : ""}>검증된 설치 꾸러미 생성</button>
  </section>`;
}

function render(): void {
  root.innerHTML = `<main class="shell">
    <header class="hero">
      <span class="eyebrow">CLAUDEX WORKHOUSE</span>
      <h1>공개 설치 시작</h1>
      <p>대상 장치에서 공식 설치 명령을 한 번 실행합니다. 관리자 비밀번호, Provider 인증정보, SSH 키는 이 페이지에 입력하지 않습니다.</p>
    </header>

    <section class="platforms" aria-label="설치 대상">
      ${RELEASED_PLATFORMS.map(
        (platform) =>
          `<button data-platform="${platform}" class="${state.platform === platform ? "active" : ""}"><strong>${platformLabel(platform)}</strong><small>${platform === "synology" ? "권장 · Docker Compose 메인 서버" : "Docker Compose 메인 서버"}</small></button>`
      ).join("")}
    </section>

    <section class="platforms in-development" aria-label="개발 중인 설치 대상">
      ${IN_DEVELOPMENT_PLATFORMS.map(
        (platform) =>
          `<button type="button" disabled aria-disabled="true"><strong>${platformLabel(platform)}</strong><small>${IN_DEVELOPMENT_REASONS[platform]}</small><span class="route-badge muted">개발 중</span></button>`
      ).join("")}
    </section>
    <p class="notice" role="note">Windows 대상은 아직 배포하지 않습니다. 네이티브 Windows 경로에서 Provider CLI 설치, 훅 실행, 세션 진행 표시가 아직 신뢰할 수 있게 동작하지 않습니다. 그동안 Windows에서는 Linux 호스트나 NAS에 메인 서버를 두고 브라우저로 접속해 사용하세요.</p>

    ${releaseCard()}

    <section class="panel checklist">
      <h2>설치 전 확인</h2>
      ${CHECKLISTS[state.platform]
        .map(
          (label, index) =>
            `<label><input type="checkbox" data-check="${index}" ${state.checks.has(index) ? "checked" : ""}><span>${escapeHtml(label)}</span></label>`
        )
        .join("")}
    </section>

    ${state.platform === "windows-docker" ? windowsDockerPanel() : state.platform === "windows-worker" ? workerPanel() : state.platform==="windows-server"?windowsServerPanel():`${serverForm()}${bundlePanel()}`}
    ${state.notice ? `<p class="notice" role="status">${escapeHtml(state.notice)}</p>` : ""}
    <footer><span>비밀값은 저장하거나 전송하지 않습니다. 릴리스 검증 실패 시 설치물 다운로드는 계속 차단됩니다.</span><span>GNU AGPL-3.0-only · <a href="./licenses/LICENSE">영문 원문</a> · <a href="./licenses/LICENSE.ko.md">한국어 번역</a> · <a href="./licenses/NOTICE.ko.md">NOTICE</a> · <a href="./licenses/THIRD_PARTY_NOTICES.ko.md">제3자 고지</a></span></footer>
  </main>`;
  bindEvents();
}

function download(name: string, bytes: BlobPart, type: string): void {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function verifyRelease(): Promise<void> {
  state.releaseBusy = true;
  state.releaseError = "";
  state.release = null;
  state.bundle = null;
  state.archiveSha256 = "";
  state.workerError = "";
  render();
  try {
    state.release = await fetchAndVerifyRelease(installerConfig);
  } catch (error) {
    state.releaseError = error instanceof Error ? error.message : String(error);
  } finally {
    state.releaseBusy = false;
    render();
  }
}

async function generateBundle(): Promise<void> {
  if (
    !state.release ||
    state.platform === "windows-docker" ||
    state.platform === "windows-worker" ||
    state.platform === "windows-server" ||
    !allChecksComplete()
  ) return;
  state.notice = "";
  try {
    state.bundle = await createInstallerBundle(
      {
        id: crypto.randomUUID(),
        platform: state.platform,
        dataPath: state.dataPath,
        port: state.port,
        accessMode: state.accessMode,
        serverOrigin: state.serverOrigin
      },
      state.release
    );
    state.archiveSha256 = "";
  } catch (error) {
    state.bundle = null;
    state.archiveSha256 = "";
    state.notice = error instanceof Error ? error.message : String(error);
  }
  render();
}
async function downloadWindowsServer():Promise<void>{
  if(!state.release||state.workerBusy)return;state.workerBusy=true;state.workerError="";state.notice="";render();
  try{const script=createWindowsServerDownload(state.release);download(script.fileName,script.content,"text/x-powershell;charset=utf-8");state.notice=`검증 다운로드 스크립트 준비 완료 · ${script.fileName} · EXE SHA-256 ${state.release.manifest.windowsServer?.sha256}`;}
  catch(error){state.workerError=`${error instanceof Error?error.message:String(error)} 파일을 실행하지 말고 릴리스 관리자에게 확인하세요.`;}
  finally{state.workerBusy=false;render();}
}
async function downloadWindowsDocker(): Promise<void> {
  if (!state.release || state.workerBusy || !allChecksComplete()) return;
  state.workerBusy = true;
  state.workerError = "";
  state.notice = "";
  render();
  try {
    const script = createWindowsDockerDownload(state.release);
    download(script.fileName, script.content, "text/x-powershell;charset=utf-8");
    state.notice = `검증 설치 스크립트 준비 완료 · ${script.fileName} · ${state.release.manifest.server.digest}`;
  } catch (error) {
    state.workerError = `${error instanceof Error ? error.message : String(error)} 파일을 실행하지 말고 릴리스 관리자에게 확인하세요.`;
  } finally {
    state.workerBusy = false;
    render();
  }
}

async function downloadWorker(): Promise<void> {
  if (!state.release || state.workerBusy) return;
  state.workerBusy = true;
  state.workerError = "";
  state.notice = "";
  render();
  const asset = state.release.manifest.workers["windows-x64"];
  try {
    const script = createWindowsWorkerDownload(state.release);
    download(script.fileName, script.content, "text/x-powershell;charset=utf-8");
    state.notice = `검증 다운로드 스크립트 준비 완료 · ${script.fileName} · 대상 ZIP SHA-256 ${asset.sha256}`;
  } catch (error) {
    state.workerError = `${
      error instanceof Error ? error.message : String(error)
    } 파일을 실행하지 말고 릴리스 관리자에게 확인하세요.`;
  } finally {
    state.workerBusy = false;
    render();
  }
}

async function downloadArchive(): Promise<void> {
  if (!state.bundle || state.archiveBusy) return;
  state.archiveBusy = true;
  state.notice = "";
  render();
  try {
    const bytes = await createTarGzip(state.bundle);
    const digest = await sha256Hex(bytes);
    state.archiveSha256 = digest;
    download(state.bundle.archiveName, bytes.slice().buffer, "application/gzip");
    state.notice = `다운로드 완료 · ${state.bundle.archiveName} · SHA-256 ${digest}`;
  } catch (error) {
    state.notice = error instanceof Error ? error.message : String(error);
  } finally {
    state.archiveBusy = false;
    render();
  }
}

function bindEvents(): void {
  root.querySelectorAll<HTMLElement>("[data-platform]").forEach((element) => {
    element.addEventListener("click", () => {
      const platform = element.dataset.platform as InstallerPlatform;
      state.platform = platform;
      state.checks = new Set();
      state.bundle = null;
      state.archiveSha256 = "";
      state.notice = "";
      state.workerError="";
      state.dataPath =
        platform === "synology"
          ? "/volume1/docker/claudex-workhouse"
          : platform==="linux"?"/opt/claudex-workhouse":"";
      render();
    });
  });
  root.querySelectorAll<HTMLInputElement>("[data-check]").forEach((element) => {
    element.addEventListener("change", () => {
      const index = Number(element.dataset.check);
      if (element.checked) state.checks.add(index);
      else state.checks.delete(index);
      state.bundle = null;
      state.archiveSha256 = "";
      render();
    });
  });
  root.querySelector<HTMLInputElement>('[data-field="dataPath"]')?.addEventListener("input", (event) => {
    state.dataPath = (event.currentTarget as HTMLInputElement).value;
    state.bundle = null;
    state.archiveSha256 = "";
  });
  root.querySelector<HTMLInputElement>('[data-field="port"]')?.addEventListener("input", (event) => {
    state.port = Number((event.currentTarget as HTMLInputElement).value);
    state.bundle = null;
    state.archiveSha256 = "";
  });
  root.querySelector<HTMLSelectElement>('[data-field="accessMode"]')?.addEventListener("change", (event) => {
    state.accessMode = (event.currentTarget as HTMLSelectElement).value as AccessMode;
    state.serverOrigin = "";
    state.bundle = null;
    state.archiveSha256 = "";
    render();
  });
  root.querySelector<HTMLInputElement>('[data-field="serverOrigin"]')?.addEventListener("input", (event) => {
    state.serverOrigin = (event.currentTarget as HTMLInputElement).value;
    state.bundle = null;
    state.archiveSha256 = "";
  });
  root.querySelector('[data-action="verify-release"]')?.addEventListener("click", () => {
    void verifyRelease();
  });
  root.querySelector('[data-action="generate-bundle"]')?.addEventListener("click", () => {
    void generateBundle();
  });
  root.querySelector('[data-action="download-archive"]')?.addEventListener("click", () => {
    void downloadArchive();
  });
  root.querySelector('[data-action="download-worker"]')?.addEventListener("click", () => {
    void downloadWorker();
  });
  root.querySelector('[data-action="download-windows-server"]')?.addEventListener("click",()=>{void downloadWindowsServer();});
  root.querySelector('[data-action="download-windows-docker"]')?.addEventListener("click", () => {
    void downloadWindowsDocker();
  });
  root.querySelectorAll<HTMLButtonElement>("[data-file]").forEach((button) => {
    button.addEventListener("click", () => {
      const artifact = state.bundle?.artifacts.find((item) => item.path === button.dataset.file);
      if (artifact) download(artifact.path, artifact.content, `${artifact.mediaType};charset=utf-8`);
    });
  });
}

render();
void verifyRelease();
