# 서명된 애플리케이션 업데이트와 최초 공개 릴리즈 실행 계획

## 1. 목표

새 세션의 최종 목표는 Claudex Workhouse 본체에 안전한 업데이트 기능을
완성하고, 최초 공개 버전의 설치·업데이트용 최종 릴리즈 파일을 실제로
생성·게시·검증하는 것이다.

완료 상태는 단순히 `pnpm build`가 성공하거나 GitHub Actions가 초록색인
상태가 아니다. 아래 결과가 모두 있어야 한다.

1. 설치된 Workhouse가 서명된 `stable` 채널에서 새 버전을 확인한다.
2. 사용자가 업데이트 내용을 확인하고 명시적으로 적용할 수 있다.
3. 업데이트 중 데이터와 설정을 보존하고, 실패하면 이전 실행 버전으로
   복구한다.
4. 새 버전이 정상 기동되고 readiness 검사를 통과한 뒤에만 성공으로
   기록한다.
5. Git tag, GHCR 이미지, GitHub Immutable Release, 설치 페이지와 서명된
   stable manifest가 동일한 버전·digest·파일을 가리킨다.
6. Windows·Linux/NAS·Worker용 최종 배포 파일을 새 환경에서 설치하고,
   직전 버전에서 새 버전으로 실제 업데이트해 검증한다.

이 계획은 DeepSeek, Google Antigravity 등 새 Provider 추가를 포함하지
않는다. Provider 확장은 업데이트 기반과 최초 릴리즈가 안정된 뒤 별도
작업으로 진행한다.

## 2. 현재 기준선

계획서 작성 시점의 기준은 `main`의 `c7b3cf329ae822a7b937f5f99f7c82756124f5f8`
이며 `origin/main`과 일치한다. 실행 세션은 시작할 때 반드시 다시 확인하고,
이 SHA를 현재값으로 가정하지 않는다.

### 이미 구현된 것

- `vMAJOR.MINOR.PATCH` tag push로 시작하는
  `.github/workflows/release.yml`
- `linux/amd64`, `linux/arm64` 메인 서버 이미지 빌드와 digest 고정
- Windows x64 메인 서버 EXE·portable ZIP 패키징과 실행 검사
- Windows x64, Linux x64, Linux arm64 Worker 패키징
- SBOM, artifact attestation, Trivy 검사, Windows Defender 검사
- exact manifest bytes에 대한 detached RSA-SHA256 서명
- 공개키 key ring 검증, key ID·폐기 상태·만료 시각 검증
- manifest version·release sequence·digest·크기·SHA-256 검증
- downgrade와 동일 sequence의 다른 manifest를 거부하는 상태 저장
- 이전 stable을 보존한 Pages stage와 마지막 stable 승격
- GitHub Immutable Release와 GHCR stable/latest의 마지막 승격
- 서버의 `ReleaseService`와
  `GET /api/deployment/releases/current`
- Codex CLI와 Claude Code 자체를 갱신하는 별도 runtime updater

### 아직 완료되지 않은 것

- `deploy/release-key-ring.json`과 실제 운영 공개키
- GitHub `release` 환경의 운영 개인키 secret과 key ID variable
- GitHub Immutable Releases, Pages, 공개 GHCR의 운영 설정 검증
- Workhouse 본체의 설치 버전과 stable 버전을 비교하는 상태 API
- Workhouse 본체 업데이트 UI와 적용 coordinator
- Docker/NAS 메인 서버를 안전하게 교체하는 host-side updater
- Windows portable 메인 서버의 out-of-process updater
- 업데이트 전 snapshot, 활성 작업 gate, readiness 확인, 자동 복구
- 설치 방식별 실제 `N-1 → N` 업데이트 E2E
- Windows portable ZIP을 포함한 모든 설치 가능 payload의 signed manifest 결속
- 사람이 내려받아 확인할 수 있는 통합 `SHA256SUMS`
- 실제 Git tag, 공개 GitHub Release, 공개 stable manifest

설정 화면의 기존 “업데이트”는 Workhouse 애플리케이션 업데이트가 아니라
Codex CLI·Claude Code runtime 업데이트다. 새 UI와 API는 이를 명확히
구분해야 한다.

## 3. 범위와 고정 결정

### 3.1 공식 업데이트 대상

1차 공개 업데이트 대상은 다음과 같다.

| 대상 | 설치 형태 | 업데이트 적용 주체 |
|---|---|---|
| Synology/Linux 메인 서버 | digest 고정 Docker Compose | host-side updater |
| Windows x64 메인 서버 | portable directory/launcher | 별도 updater process |
| Windows x64 Worker | current-user package | Worker updater |
| Linux x64/arm64 Worker | current-user package | Worker updater |

개발용 source checkout과 현재 NAS의 source-build supervisor 설치는 자동
업데이트 대상에서 제외한다. 이 환경은 계속 Git checkout, build, restart로
관리한다. source tree를 원격 manifest에 맞춰 자동 덮어쓰는 기능은 만들지
않는다.

### 3.2 채널과 버전

- 최초에는 `stable` 단일 채널만 제공한다.
- 버전은 SemVer를 사용하고 최초 공개 tag 후보는 `v1.0.0`으로 한다.
- 같은 tag와 같은 버전의 자산을 다시 올리거나 덮어쓰지 않는다.
- 수정 릴리즈는 `v1.0.1`, 기능 추가는 `v1.1.0`처럼 새 tag로 발행한다.
- 최초 공개 전 dry-run은 실제 tag를 재사용하지 않는 별도 검증 경로로 한다.

### 3.3 보안 원칙

- Workhouse 컨테이너에 Docker socket을 마운트하지 않는다.
- 앱 프로세스가 실행 중인 자신의 바이너리나 컨테이너를 직접 덮어쓰지
  않는다.
- manifest와 signature는 같은 고정 HTTPS origin에서 redirect 없이 받는다.
- 설치 파일은 signed manifest에 기록된 URL·크기·SHA-256·platform·arch와
  모두 일치해야 한다.
- 개인 서명키는 저장소, Actions artifact, 컨테이너, 로그, 지원 bundle에
  넣지 않는다.
- 업데이트 적용 API는 owner credential, Cloudflare Access, same-origin,
  mutation header, UUID idempotency key, rate limit, 명시적 확인을 요구한다.
- 활성 작업이 있으면 기본적으로 업데이트를 거부한다. 강제 업데이트는
  1차 범위에 넣지 않는다.

## 4. 목표 구조

```text
Git tag v1.0.1
  -> GitHub Actions build/test/scan
  -> GHCR version@sha256 digest
  -> GitHub Immutable Release assets
  -> release-manifest.json + detached signature
  -> Pages releases/stable pointer

설치된 Workhouse
  -> signed stable manifest 확인
  -> 설치 버전과 비교
  -> 사용자에게 변경 버전/상태 표시
  -> 설치 방식별 updater에 검증된 update request 전달
  -> snapshot + active-task gate
  -> 새 payload stage
  -> out-of-process 교체와 restart
  -> readiness 검증
  -> 성공 확정 또는 이전 버전 복구
```

업데이트 확인과 검증은 Workhouse가 담당하지만, 실행 중인 본체의 교체는
host-side updater 또는 launcher가 담당한다. 이 경계를 지키면 Docker socket
노출과 Windows 실행 파일 self-overwrite를 피할 수 있다.

## 5. 구현 단계

### 단계 A — 기준선과 릴리즈 계약 고정

1. 새 세션 시작 시 `pwd`, `git status -sb`, `git rev-parse HEAD origin/main`,
   tag·release·workflow 상태를 다시 기록한다.
2. 기존 사용자 미추적 파일은 staging하거나 수정하지 않는다.
3. 현재 릴리즈 workflow의 산출물 inventory를 테스트 fixture로 고정한다.
4. application version, manifest version, container label, Windows package
   manifest, Worker version이 tag와 일치하는 계약 테스트를 추가한다.
5. 기존 Codex/Claude runtime updater와 새 application updater의 타입·API·UI
   명칭이 겹치지 않도록 이름을 분리한다.

완료 조건:

- 현재 구현과 새 구현의 경계가 테스트에 고정된다.
- tag, package version, manifest version 불일치가 CI에서 실패한다.

### 단계 B — manifest와 최종 파일 계약 확장

1. `release-manifest` schema를 호환 가능한 새 버전으로 확장한다.
2. Windows 메인 서버 EXE뿐 아니라 portable ZIP도 filename, URL, size,
   SHA-256, platform, architecture로 manifest에 결속한다.
3. 설치 방식별 updater payload와 최소 updater protocol version을 기록한다.
4. 필요하면 다음 필드를 추가한다.
   - 최소 설치 가능 버전
   - 데이터 schema version
   - rollback 호환 최소 버전
   - release notes URL 또는 요약
5. 모든 정적 release asset을 대상으로 통합 `SHA256SUMS`를 생성한다.
6. manifest 검증기, installer-web 검증기, directory verifier가 같은 계약을
   사용하도록 테스트한다.
7. 구 schema를 허용해야 한다면 읽기 호환만 유지하고, 새 updater 적용은
   필요한 필드가 없는 구 manifest에서 fail closed 한다.

완료 조건:

- 설치 가능한 모든 payload가 signed manifest 또는 signed manifest가
  가리키는 digest에 결속된다.
- 파일 하나를 바꾸거나 이름·URL·크기를 바꾸면 검증이 실패한다.
- `SHA256SUMS`가 공개 asset inventory와 정확히 일치한다.

### 단계 C — 애플리케이션 업데이트 상태 서비스

새 모듈은 기존 `ReleaseService`의 검증 결과를 재사용하고 서명 검증을
우회해서는 안 된다.

권장 상태 모델:

```text
unconfigured
checking
up-to-date
available
blocked-active-tasks
staging
applying
verifying
completed
rollback-running
rolled-back
failed
```

구현 항목:

1. 현재 설치 metadata를 정규화한다.
   - version
   - install method
   - platform/architecture
   - image digest 또는 package SHA-256
   - updater protocol version
2. SemVer와 digest를 함께 비교한다. version text만 같고 digest가 다르면
   정상 상태로 취급하지 않는다.
3. verified release state와 update attempt를 SQLite에 기록한다.
4. 중복 확인 요청은 합치고, 적용은 process-wide lock으로 직렬화한다.
5. 다음 API를 추가한다.
   - `GET /api/application-updates`
   - `POST /api/application-updates/check`
   - `POST /api/application-updates/apply`
   - `GET /api/application-updates/events`
6. apply body에는 target version·manifest SHA-256·`confirm:true`를 요구해
   확인 이후 stable pointer가 바뀌는 TOCTOU를 막는다.
7. audit에는 actor, source version, target version, manifest hash, 결과와
   복구 여부만 기록하고 token·URL query·환경값은 기록하지 않는다.

완료 조건:

- downgrade, equivocation, expired manifest, revoked key, wrong platform,
  hash mismatch가 모두 적용 전에 차단된다.
- 같은 idempotency key의 재시도가 두 번 업데이트하지 않는다.

### 단계 D — 공통 안전 gate와 snapshot

1. 다음 상태에서는 적용을 차단한다.
   - 실행 중이거나 승인 대기 중인 Provider task
   - 진행 중인 collaboration
   - 연결 중인 DB migration/maintenance
   - 이미 실행 중인 update attempt
2. 업데이트 직전에 다음을 별도 recovery directory에 저장한다.
   - SQLite online backup과 검증 결과
   - config와 projects allowlist
   - 현재 설치 metadata
   - 이전 image digest 또는 package directory pointer
3. SQLite backup은 원본 DB/WAL 단순 복사가 아니라 기존 snapshot 계층이나
   SQLite backup API를 사용하고 `quick_check`와 독립 open을 확인한다.
4. snapshot은 일반 로그·release asset과 분리하고 `0700/0600` 권한을
   유지한다.
5. 업데이트 성공 후에도 직전 복구본은 정책 기간 동안 유지한다.
6. DB migration이 비가역이면 코드 rollback만 자동 수행하지 않는다.
   manifest의 rollback compatibility를 확인하고, 불가능하면 recovery
   snapshot과 명확한 수동 복구 절차를 제공한다.

완료 조건:

- 활성 작업 중 업데이트가 시작되지 않는다.
- snapshot 실패 시 payload 교체가 시작되지 않는다.
- 복구본과 현재 설치본의 버전·hash 연결이 기록된다.

### 단계 E — Docker/NAS host-side updater

Docker 설치 bundle에 root가 아닌 제한된 운영 경로의 updater와 상태 파일을
포함한다. 앱 컨테이너는 Docker socket을 받지 않는다.

적용 순서:

1. Workhouse가 검증된 update request 파일을 원자적으로 작성한다.
2. host-side updater가 request의 manifest SHA-256과 local key ring을 다시
   검증한다.
3. 대상 `repository@sha256:digest`를 pull한다.
4. 기존 compose/env와 현재 digest를 복구 가능하게 보존한다.
5. compose의 image reference를 새 digest로 원자 교체한다.
6. 새 컨테이너를 기동한다.
7. 제한 시간 안에 `/api/health/live`와 `/api/health/ready`를 확인한다.
8. 설치 metadata와 update attempt를 성공으로 확정한다.
9. 실패하면 이전 digest로 compose를 되돌리고 다시 기동한 뒤 복구 결과를
   기록한다.

updater 실행 방식은 설치 시 만든 명시적 명령 또는 제한된 scheduler/service로
정한다. 앱이 임의 shell command를 전달하는 범용 privileged agent는 만들지
않는다.

완료 조건:

- Docker socket이 Workhouse 컨테이너에 노출되지 않는다.
- 잘못된 digest, readiness timeout, 새 이미지 crash에서 이전 digest가
  실제로 다시 기동한다.
- DB, 설정, Provider runtime volume이 그대로 유지된다.

### 단계 F — Windows portable out-of-process updater

실행 중인 EXE를 직접 덮어쓰지 않는다. launcher/updater가 버전 directory와
`current` pointer를 관리한다.

적용 순서:

1. signed manifest에 결속된 portable ZIP을 다운로드한다.
2. size와 SHA-256을 확인하고 새 sibling version directory에 압축 해제한다.
3. archive traversal, symlink/reparse point, 중복 경로, 크기 상한을 검사한다.
4. 새 server package manifest와 entrypoint를 검사한다.
5. 기존 서버에 정상 종료를 요청하고 PID/시작 시각/실행 경로를 확인한다.
6. `current` pointer를 새 directory로 원자 교체한다.
7. 새 서버를 시작하고 local readiness를 확인한다.
8. 실패하면 pointer를 이전 directory로 되돌리고 이전 서버를 시작한다.
9. 성공 후에도 직전 한 버전은 즉시 삭제하지 않는다.

Windows EXE가 Authenticode unsigned라는 현재 정책은 UI와 README에 명확히
표시한다. 신뢰 근거는 signed manifest, SHA-256, GitHub artifact attestation,
Defender 검사 결과다.

완료 조건:

- 실행 중 파일 overwrite가 없다.
- portable ZIP 변조와 archive 공격이 적용 전에 차단된다.
- 새 프로세스 시작 실패 시 이전 버전이 복구된다.

### 단계 G — Worker 업데이트 통합

기존 `worker-install.ts`와 패키지 검증을 재사용한다.

1. Worker handshake에 현재 version, package hash, updater protocol을 포함한다.
2. 메인 서버가 Worker platform/architecture에 맞는 signed payload만 제안한다.
3. 활성 Worker job이 있으면 업데이트를 거부한다.
4. Worker가 스스로 stage, stop, pointer swap, reconnect를 수행한다.
5. 새 버전으로 재연결되지 않으면 이전 package로 복구한다.
6. 서버 UI에는 본체 업데이트와 Worker별 업데이트를 구분해 표시한다.

완료 조건:

- Windows/Linux Worker가 작업이 없을 때만 갱신된다.
- 갱신 후 같은 Worker identity로 재연결되고 Workspace credential을 보존한다.

### 단계 H — UI와 다국어

설정의 시스템 또는 인프라 화면에 “Claudex Workhouse 업데이트” 영역을
추가하고 기존 “Provider runtime 업데이트”와 분리한다.

표시 항목:

- 현재 버전과 설치 방식
- stable 최신 버전과 게시 시각
- manifest 검증 상태와 key ID
- update 가능/차단 이유
- 데이터 snapshot 예정 여부
- 업데이트 후 재시작 안내
- 최근 update와 rollback 결과

적용 전 확인 dialog에는 현재/대상 버전, 활성 작업 0개, snapshot 생성,
서비스 일시 중단을 명시한다. ko/en/ja dictionary key를 동시에 추가하고
literal UI text가 남지 않도록 기존 i18n 검사를 확장한다.

완료 조건:

- desktop, mobile 360/412, tablet에서 세 언어 모두 상태 확인과 적용 확인
  dialog가 정상이다.
- 기존 `locales.spec.ts`의 compact topbar selector를 현재 접근성 역할 기반
  경로로 고쳐 실제 모바일 메뉴를 검증한다.

### 단계 I — 운영 서명키와 GitHub 릴리즈 환경

이 단계는 공개 릴리즈를 만들 권한이 확인된 상태에서 수행한다.

1. workspace 밖의 제한된 경로에서 RSA 운영키를 생성한다.
   - 권장: RSA 3072 이상
   - private PEM 권한 `0600`
   - key ID 예: `release-2026-08`
2. private key에서 SPKI public PEM을 파생한다.
3. public key만 `deploy/release-key-ring.json`에 기록한다.
4. private key 원본은 암호화된 오프라인 백업을 하나 더 만든다.
5. base64 private key를 GitHub `release` environment의
   `RELEASE_SIGNING_PRIVATE_KEY_BASE64` secret으로 설정한다.
6. `RELEASE_SIGNING_KEY_ID` repository/environment variable을 설정한다.
7. 필요할 경우 `PUBLIC_INSTALLER_ORIGIN`을 설정한다. 비어 있으면 workflow의
   GitHub Pages 기본 origin을 사용한다.
8. GitHub에서 다음을 확인한다.
   - release environment와 필요한 protection
   - Release immutability 활성화
   - Pages source가 GitHub Actions
   - GHCR package public read
   - Actions의 contents/packages/pages/id-token/attestation 권한
9. private key 값, secret 설정 명령의 인자, JWT, credential을 로그나 계획서에
   남기지 않는다.
10. 공개키와 CI private key가 일치하는 preflight만 수행하고 private key
    바이트는 artifact로 업로드하지 않는다.

완료 조건:

- 저장소에는 public key ring만 존재한다.
- workflow가 key mismatch와 revoked key에서 fail closed 한다.
- 서명키 없이 release workflow가 publish 단계로 진행하지 않는다.

### 단계 J — 검증과 최초 공개 릴리즈

#### 로컬/CI 검증

1. `pnpm install --frozen-lockfile`
2. `pnpm check`
3. `pnpm test`
4. `pnpm build`
5. release 관련 unit/integration test
6. installer-web check/test/build
7. Docker E2E
8. Windows package build·launch·update·rollback E2E
9. Linux Worker x64/arm64 package 검사
10. browser runtime doctor 후 ko/en/ja update UI Playwright
11. `git diff --check`와 문서 link 검사

전체 테스트에서 현재 Workhouse가 주입한 managed-provider 환경 변수가 child
test에 새어 들어가지 않도록 test harness가 관련 환경을 명시적으로 정리해야
한다. 단순히 실행할 때만 변수를 unset하는 것으로 끝내지 말고 재현 가능한
테스트 격리를 코드로 고정한다.

#### N-1 → N 업데이트 검증

최초 공개에 자동 업데이트를 증명하려면 두 개의 서로 다른 버전이 필요하다.
다음 중 하나를 명시적으로 선택한다.

- 권장: 제한된 pre-release fixture channel에서 `1.0.0-rc.1 → 1.0.0-rc.2`를
  검증하고, public stable은 `v1.0.0`으로 시작한다.
- 대안: `v1.0.0`을 설치 기준선으로 공개한 뒤 최소 변경의 `v1.0.1`까지
  연속 발행해 실제 stable update를 증명한다.

테스트 데이터에는 task/history, workspace allowlist, Provider 설정, owner
claim 상태를 포함하되 실제 Provider token은 fixture에 넣지 않는다.

검증 항목:

- 업데이트 전후 DB row 수와 중요 설정 동일
- owner browser session 또는 재인증 절차가 설계대로 동작
- Cloudflare Access 외부 접속 정상
- Desktop Worker 재연결
- 새 task 생성, stream, stop, resume 정상
- 실패 fixture에서 이전 버전 자동 복구
- downgrade와 동일 sequence 다른 bytes 거부

#### 최초 public release

모든 gate가 통과한 뒤에만 annotated tag를 만들고 push한다.

```text
v1.0.0 tag push
-> public release workflow 완료
-> immutable GitHub Release 공개
-> Pages stable manifest/signature 공개
-> GHCR version digest 공개
-> public bytes 재다운로드 검증
-> GHCR stable과 GitHub latest 마지막 승격
```

tag push와 공개 release는 외부 상태를 영구적으로 만든다. 실행 직전에 HEAD,
working tree, version, release notes, key ID, asset inventory를 한 번 더 제시하고
사용자의 공개 실행 지시를 확인한다. 실패 시 같은 tag를 삭제·재사용하거나
asset을 덮어쓰지 않는다. 원인을 수정해 새 patch version으로 진행한다.

## 6. 최종 릴리즈 산출물

최초 릴리즈 완료 시 아래 항목을 모두 보고하고 검증한다.

### GitHub Release 파일

- `release-manifest.json`
- `release-manifest.json.sig`
- `SHA256SUMS`
- `claudex-workhouse-installer-site-<version>.tar.gz`
- `claudex-workhouse-server-windows-x64.exe`
- `claudex-workhouse-server-windows-x64.exe.sha256`
- `claudex-workhouse-server-windows-x64.exe.spdx.json`
- `claudex-workhouse-server-windows-x64-portable.zip`
- `claudex-workhouse-server-windows-x64-portable.zip.sha256`
- `claudex-workhouse-worker-windows-x64.zip`
- `claudex-workhouse-worker-windows-x64.zip.spdx.json`
- `claudex-workhouse-worker-linux-x64.tar.gz`
- `claudex-workhouse-worker-linux-x64.tar.gz.spdx.json`
- `claudex-workhouse-worker-linux-arm64.tar.gz`
- `claudex-workhouse-worker-linux-arm64.tar.gz.spdx.json`

GitHub 자동 source archive는 별도이며 공식 설치 payload로 취급하지 않는다.

### 컨테이너와 설치 채널

- `ghcr.io/<owner>/claudex-workhouse:<version>`
- 위 tag가 가리키는 multi-arch immutable digest
- `linux/amd64`, `linux/arm64` platform 존재
- 검증 후 승격된 `:stable`
- Pages 설치 UI
- `/releases/stable/release-manifest.json`
- `/releases/stable/release-manifest.json.sig`

### 최종 보고에 포함할 증거

- branch, commit SHA, tag, release URL
- workflow run URL과 모든 job 결과
- manifest version, sequence, key ID, SHA-256
- GHCR repository와 immutable digest
- 각 release asset의 이름, 크기, SHA-256
- Pages stable과 immutable release manifest byte equality
- 새 환경 설치 결과
- N-1 → N 업데이트 결과
- rollback fixture 결과
- 남은 변경 파일과 알려진 제한

## 7. 실패·복구 매트릭스

| 실패 지점 | 기대 동작 |
|---|---|
| manifest/signature 다운로드 실패 | 기존 버전 유지, 적용 버튼 비활성 |
| 서명·key ID·expiry 실패 | fail closed, audit 기록 |
| downgrade/equivocation | 거부, 이전 accepted state 유지 |
| payload hash/size 불일치 | stage 삭제, 현재 버전 유지 |
| snapshot 실패 | 교체 시작 금지 |
| 활성 task 발견 | 업데이트 차단 |
| Docker pull 실패 | 현재 container 유지 |
| 새 container readiness 실패 | 이전 digest로 복구 |
| Windows 새 process 시작 실패 | 이전 `current` pointer 복구 |
| Worker 재연결 실패 | 이전 Worker package 복구 |
| DB migration 후 code rollback 불가 | 자동 code rollback 금지, recovery 안내 |
| Pages stage 실패 | 기존 stable 유지 |
| immutable release 공개 후 stable 실패 | latest/stable 승격 금지, 새 version으로 복구 |

## 8. 테스트 요구사항

최소 테스트 묶음은 다음과 같다.

### Unit

- SemVer/digest update 판정
- 설치 metadata parsing
- update state machine
- idempotency와 lock
- active-task gate
- manifest schema와 모든 payload 결속
- RSA signature, revoked/expired key
- downgrade, equivocation, channel mismatch
- archive traversal와 package bounds
- rollback compatibility 판정

### Integration

- mock HTTPS manifest/signature/payload server
- SQLite accepted release state 원자성
- snapshot 생성과 검증
- updater request/result 파일 원자성
- server API auth, confirmation, rate limit, audit redaction
- release directory 전체 재검증

### E2E

- Docker fresh install
- Docker N-1 → N과 readiness failure rollback
- Windows portable fresh launch
- Windows N-1 → N과 launch failure rollback
- Windows/Linux Worker update와 reconnect
- ko/en/ja desktop/mobile update UI
- Cloudflare Access 뒤에서 check/apply event 흐름
- public installer가 만든 bundle로 별도 환경 설치

## 9. 문서 작업

코드와 함께 다음 문서를 갱신한다.

- `docs/deployment.en.md`, `.ko.md`, `.ja.md`
- `docs/rollback.md`
- `docs/release/signing.md`
- `docs/release/verification.md`
- `docs/release/key-rotation.md`
- 설치 페이지의 세 언어 안내
- Windows unsigned EXE와 signed manifest 신뢰 경계
- 업데이트 중 서비스 중단, snapshot, 활성 작업 제한
- source checkout은 자동 업데이트 대상이 아니라는 설명

README에 새 문서를 연결할 때 영어·한국어·일본어 사용자가 각 언어 문서로
도달할 수 있는지 전체 visible link를 검사한다.

## 10. 커밋과 공개 순서

권장 커밋 경계:

1. manifest/asset 계약과 테스트
2. application update service/API
3. snapshot과 공통 gate
4. Docker host updater
5. Windows updater
6. Worker updater 통합
7. UI/i18n/E2E
8. release workflow, key ring, 문서

각 커밋은 자체 검사 가능해야 한다. 최초 public tag는 모든 구현 커밋과
운영 공개키가 `main`에 push되고, CI가 깨끗한 상태에서만 만든다.

## 11. 최종 완료 판정표

- [ ] Workhouse application update와 Provider runtime update가 분리돼 있다.
- [ ] signed stable manifest에서 update를 확인한다.
- [ ] owner만 update를 적용할 수 있다.
- [ ] 활성 작업 중 적용되지 않는다.
- [ ] 적용 전 검증된 snapshot이 생성된다.
- [ ] Docker 업데이트와 자동 복구가 실기 통과한다.
- [ ] Windows portable 업데이트와 자동 복구가 실기 통과한다.
- [ ] Windows/Linux Worker 업데이트와 재연결이 통과한다.
- [ ] ko/en/ja UI와 모바일 E2E가 통과한다.
- [ ] 운영 private key가 저장소와 artifact에 없다.
- [ ] public key ring이 앱·installer·CI에서 동일하다.
- [ ] GitHub Immutable Releases가 활성화돼 있다.
- [ ] GHCR version digest와 manifest digest가 일치한다.
- [ ] 모든 최종 파일이 manifest 또는 통합 checksum에 결속된다.
- [ ] Pages stable manifest와 immutable release manifest가 byte-equal이다.
- [ ] 새 환경 fresh install이 통과한다.
- [ ] N-1 → N 실제 업데이트가 통과한다.
- [ ] 실패 fixture rollback이 통과한다.
- [ ] tag, release, Pages, GHCR stable/latest 승격이 완료됐다.
- [ ] branch, commit, tag, artifact hash와 남은 변경을 최종 보고했다.

## 12. 새 세션에 전달할 실행 요청

아래 문구와 이 계획서 경로를 새 세션에 함께 전달한다.

```text
/srv/claudex-workhouse에서
docs/signed-application-update-release-plan.ko.md를 기준으로 서명된
Claudex Workhouse 애플리케이션 업데이트 기능을 구현하고 최초 공개
릴리즈 파일까지 생성·검증해라.

먼저 현재 HEAD/origin, dirty worktree, 기존 release workflow와 GitHub 운영
설정을 다시 조사하고 계획서의 현재 기준선과 달라진 점을 보고해라.
기존 사용자 파일은 건드리지 말고, Provider runtime 업데이트와 Workhouse
본체 업데이트를 분리해라. Docker socket을 앱에 노출하거나 실행 중 파일을
in-process로 덮어쓰지 마라. signed manifest, snapshot, active-task gate,
readiness, rollback을 모두 실기 검증해라.

구현·테스트·문서·커밋·push를 완료하되, 운영 private key를 저장소나 로그에
남기지 마라. public tag와 immutable release 게시 직전에는 정확한 HEAD,
버전, key ID, asset inventory를 제시하고 공개 실행 여부를 확인해라.
최종 목표는 GitHub Release 파일, GHCR multi-arch digest, Pages stable
manifest/signature, fresh install과 N-1→N 업데이트 증거까지 갖춘 상태다.
```
