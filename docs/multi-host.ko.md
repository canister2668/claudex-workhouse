# 멀티 호스트 실행 구조

[English](multi-host.en.md) · [한국어](multi-host.ko.md) · [日本語](multi-host.ja.md)

Claudex Workhouse는 NAS를 변경 불가능한 `local` 실행 호스트로, 페어링된 각 컴퓨터를 `worker` 호스트로 취급합니다. Project는 논리 이름이고 Workspace는 한 호스트에서 그 Project에 속하는 검증된 디렉터리입니다. Provider 세션은 항상 Provider, 호스트, Workspace에 귀속됩니다. 이전 요청에 `executionHostId`/`workspaceId`가 없으면 기존 NAS 매핑으로 해석합니다.

## 신뢰 경계

- 브라우저 변경 요청에는 Cloudflare Access, same-origin, `X-Claudex-Workhouse-Request: 1`, UUID 멱등성 키, rate limit이 계속 필요합니다.
- `/worker/*`는 브라우저 쿠키나 Cloudflare 사용자 신원을 사용하지 않습니다. 페어링은 10분짜리 일회용 코드를 사용하고, 연결된 Worker는 256비트 자격 증명에서 파생한 키로 임의 challenge에 인증합니다.
- 서버는 자격 증명 파생 해시만 저장합니다. Worker는 원본을 OS 사용자 설정에 `0600` 모드로 저장합니다(Windows는 현재 사용자 ACL).
- Cloudflare 서비스 토큰 헤더는 전송 관문 용도로만 Worker 환경 변수에서 제공할 수 있으며 Worker 신원으로 인정되지 않습니다.
- 프로토콜은 고정된 typed command만 허용합니다. shell, 실행 파일, argv RPC는 없습니다. Prompt와 Markdown은 Provider 입력이나 파일로만 전달되고 shell에서 해석하지 않습니다.
- 모든 메시지는 연결 generation과 증가하는 sequence를 가집니다. 인증된 새 연결은 이전 generation을 대체하며 메시지 크기는 1 MiB로 제한됩니다.

## Workspace 경계

로컬 Root는 `config/claudex-workhouse.json`의 `workspaceRoots`에서 가져옵니다. 없으면 설치 루트 아래 `workspaces/`를 만듭니다. 이 Root 밖의 기존 Project에는 정확한 경로만 등록 가능한 Root를 부여하며 넓은 상위 디렉터리를 암묵적으로 신뢰하지 않습니다.

Worker Root는 로컬 Worker CLI에서만 추가할 수 있습니다. 웹 UI는 기존 Root를 선택할 수 있지만 새 절대 경로를 제출할 수 없습니다. 디렉터리 탐색은 HMAC 서명된 항목 ID를 반환합니다. 등록과 생성 시 lexical containment와 `realpath`를 다시 확인하고 symlink를 따라가지 않습니다. Windows Worker도 같은 real-path containment를 적용하고 예약 이름을 거부합니다. junction/reparse point 검증은 릴리스 전 실제 Windows 호스트에서 수행해야 합니다.

Git clone은 HTTPS나 호스트에 설정된 SSH만 허용하고, `protocol.file.allow=never`, `protocol.ext.allow=never`, `shell:false`를 강제하며 추가 Git 인자를 받지 않습니다. 실패한 clone은 해당 clone을 위해 만든 빈 디렉터리만 제거합니다.

## 원격 작업 수렴

Worker는 로컬과 같은 컴파일된 Claude/Codex Worker runner를 시작합니다. 작업 상태와 8 MiB/24시간 NDJSON 이벤트 spool은 Worker OS 사용자 영역에 둡니다. 연결이 끊기면 서버는 호스트를 offline, 활성 작업을 마지막 상태의 `unknown`으로 표시하고 실패 처리하지 않습니다. 재인증 후 Worker가 authoritative snapshot과 보내지 못한 event ID를 전송합니다. 서버는 오래된 generation을 거부하고 최근 event ID의 중복을 제거합니다.

소유 프로세스는 marker와 플랫폼 프로세스 신원으로 기록합니다. Linux는 PID, 시작 시각, 실행 파일, 명령줄, process group을, macOS는 PID, 시작 시각, 소유 marker를, Windows는 PID, CIM 생성 시각, 실행 파일, command marker를 확인한 뒤 process-tree 중지를 허용합니다. 외부 CLI/VS Code 프로세스는 표시만 하고 Worker 명령으로 중지하지 않습니다.

## Handoff와 WorkChain

Handoff는 프로세스 메모리나 Provider 세션 ID를 옮기지 않습니다. 새 대상 세션을 만들고 `WorkChain`에 `SessionLink`를 저장합니다.

Artifact는 Project별 `data/handoffs/<project>/<artifact>/`에 저장합니다. 디렉터리는 `0700`, 파일은 `0600`이며, 결정적인 `handoff.md`, checksum이 있는 비실행 `manifest.json`, 선택적인 최대 8 MiB `git diff --binary` patch로 구성됩니다.

원격 patch 생성·전달은 checksum으로 검증한 512 KiB typed chunk를 사용해 메시지가 1 MiB를 넘지 않게 합니다. Worker는 등록된 Workspace에서 자신이 방금 만든 patch만 읽을 수 있으며 범용 다운로드 RPC가 아닙니다.

Patch는 자동 적용하지 않습니다. secret-like 파일명이 있으면 생성을 중지합니다. 대상 검증은 Project, 호스트 가용성, Git remote/commit, dirty 상태, 활성 Workspace lease를 비교합니다. Commit 불일치가 checkout/pull/branch 변경을 일으키지 않습니다. Continue handoff는 source write lease를 놓고 target write lease를 얻으며 review는 read lease를 얻습니다. Artifact는 7일 뒤 만료되고 내용과 patch byte는 audit에 복사하지 않습니다.

## 운영상 고지

- Provider 인증은 실행 호스트별로 별도이며 호스트 간 복사하지 않습니다.
- 여러 웹 화면은 해당 호스트 OS 사용자의 Provider 계정을 공유합니다. 멀티테넌트 격리가 아닙니다.
- Worker가 offline이면 현재 작업 상태나 중지 결과를 확인할 수 없습니다.
- “Workspace 등록 해제”는 DB 매핑만 제거하고 파일은 남깁니다.
- 디스크 삭제는 별도 작업이며 Root별 기본 비활성화, 활성/unknown 작업 차단, Workspace 이름 재입력이 적용됩니다.
- 교차 Provider review는 선택한 handoff 자료와 관련 코드 문맥을 다른 Provider에 보냅니다.
- 원격 Provider 상태는 호스트 진단에서 확인합니다. 로그인은 해당 호스트의 공식 CLI에서 할 수 있으며, 검증되지 않은 Worker 플랫폼에서 원격 로그인 브리지를 켜면 안 됩니다.
