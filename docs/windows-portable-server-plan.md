# Windows 단일 EXE 포터블 서버 구현 계획

## 1. 결정 요약

Windows에는 Docker Desktop이나 별도 Node.js 설치를 요구하지 않는
`Claudex Workhouse.exe` 하나를 배포한다.

사용자가 EXE를 실행하면 다음 작업이 자동으로 이루어진다.

1. 내장 페이로드의 서명과 해시를 검증한다.
2. `%LOCALAPPDATA%\Claudex Workhouse\runtime\<version>`에 불변 런타임을
   전개한다.
3. 현재 Windows 사용자 권한으로 메인 서버를 시작한다.
4. 같은 PC의 로컬 실행기를 자동 등록한다.
5. 구축 진행과 실행 상태를 보여주는 작은 Windows 상태창을 연다.
6. 일회성 진입 토큰이 포함된 로컬 관리 화면을 브라우저로 연다.

사용자는 Node.js를 설치하거나 Worker pairing code를 입력하지 않는다.
내부적으로는 기존 Windows Desktop Worker의 실행 경로를 서버 내장
실행기로 재사용하지만, 이는 로컬 서버에 자동 등록되는 구현 세부사항이며
별도의 설치·연결 절차나 Worker 용어로 노출하지 않는다.

Synology와 일반 Linux의 기존 Docker 배포 및 원격 Worker 연결 방식은
유지한다.

## 2. 검토 결론

Claude Code와 현재 저장소를 함께 검토한 결과, 자체 전개형 단일 EXE
방향은 타당하다. 다만 난이도의 중심은 EXE 포장이 아니라 다음 다섯
항목이다.

1. `/bin/python3`에 의존하는 SQLite worker의 Windows 대체
2. 애플리케이션 코드와 변경 가능한 사용자 데이터의 루트 분리
3. 기존 Windows Worker를 이용한 로컬 실행기의 자동 등록
4. `flock`, `/proc`, `bwrap`, Unix 절대경로 전제 제거 또는 능력별 분기
5. Authenticode 및 기존 release manifest에 결속된 배포 검증

메인 서버의 모든 Linux 실행 경로를 Windows로 직접 포팅하지 않는다.
Windows에서 이미 구현된 `desktop-worker`의 Git, workspace, Provider
실행 및 프로세스 관리 경로를 재사용한다. 이렇게 해야 Windows와
Linux의 플랫폼 분기를 줄이면서 기존 원격 Worker 기능도 보존할 수 있다.

## 3. 사용자 경험

### 최초 실행

```text
Claudex Workhouse.exe 실행
→ Authenticode 및 내장 payload 검증
→ LocalAppData에 버전별 런타임 전개
→ 사용자 데이터 디렉터리와 ACL 준비
→ 메인 서버 시작
→ 로컬 실행기 자동 등록
→ 서버·DB·실행기·Provider 단계별 진단
→ Windows 상태창에 접속 주소와 해결 방법 표시
→ 브라우저에서 초기 소유자 설정 화면 열기
→ Codex·Claude 상태 진단 및 필요한 경우 공식 로그인 안내
```

### 이후 실행

- 서버가 꺼져 있으면 현재 버전으로 시작한다.
- 서버가 실행되는 동안 작은 상태창을 유지한다.
- 이미 실행 중이면 두 번째 서버를 만들지 않고 기존 상태창과 관리
  화면을 연다.
- 콘솔 창은 표시하지 않는다.
- 관리자 권한과 Windows 서비스 계정은 요구하지 않는다.

### 자동 시작

- 기본값은 비활성이다.
- 사용자가 켜면 현재 사용자 범위의 `schtasks /SC ONLOGON /RL LIMITED`
  작업을 등록한다.
- LocalSystem, 관리자 서비스, 전역 실행 정책 변경은 사용하지 않는다.

### 네트워크

- Windows 기본 bind는 `127.0.0.1`이다.
- 기본 실행만으로 Windows 방화벽 수신 규칙을 요구하지 않는다.
- LAN 또는 인터넷 공개는 별도 명시적 설정으로만 허용한다.
- HTTPS 원격 접속은 기존 Cloudflare Access, Tailscale 또는 검증된
  reverse proxy 흐름을 사용한다.

### Windows 상태창

상태창은 전체 Workhouse UI를 복제하지 않는다. 서버 구축과 운영에
필요한 최소 제어판으로 제한한다.

```text
Claudex Workhouse

서버          ● 실행 중
로컬 주소     http://127.0.0.1:3410
외부 접속     설정하지 않음
Codex         ● 설치됨 · 로그인됨
Claude Code   ○ 설치됨 · 로그인 필요
작업 실행     ● 준비됨

[Workhouse 열기] [진단 다시 실행] [외부 접속 가이드]
[로그 보기] [서버 다시 시작] [종료]
```

필수 기능:

- 서버 시작·준비·실패 상태
- 현재 버전과 업데이트 상태
- 로컬 접속 링크 열기와 복사
- 외부 접속 주소가 설정된 경우 링크 열기와 복사
- 단계별 진단과 실패 원인
- 실패 항목별 안전한 해결 버튼
- 서버 재시작과 종료
- 로그 폴더 열기와 개인정보가 제거된 진단 내보내기
- 로그인 시 자동 실행 설정
- 관리 화면에서 바로 새 Codex 또는 Claude 요청을 만드는 링크

상태창은 네이티브 Win32 UI로 구현하고 WebView, Electron, Tauri를
요구하지 않는다. 전체 대화와 프로젝트 관리는 기존 브라우저 UI에서
수행한다. 트레이 아이콘은 후속 기능으로 둔다.

### 단계별 구축 진단

진단은 각 항목을 `대기`, `진행 중`, `통과`, `주의`, `실패`로 표시한다.
기존 `infrastructure/health.ts`의 결과 형식과 remediation을 공통 계약으로
사용한다.

1. EXE Authenticode와 내장 payload 검증
2. runtime 버전 전개와 `current.json` 선택
3. data/config 디렉터리와 NTFS ACL
4. 단일 인스턴스와 포트 사용 가능 여부
5. HTTP 서버 bind와 `/api/health/ready`
6. SQLite worker 및 DB 무결성
7. 서버 내장 Windows 실행기 연결
8. Git과 선택적 GitHub CLI
9. Codex 실행 파일·버전·공식 account 상태
10. Claude Code 실행 파일·버전·공식 auth 상태
11. Workspace 경로 접근과 쓰기 가능 여부
12. 선택한 외부 접속 방식의 준비 상태
13. 실제 최소 read-only 테스트 작업

자동 해결은 Workhouse가 소유한 runtime, 설정, 자동 시작에만 적용한다.
방화벽, 공유기, Cloudflare, Tailscale 계정과 Provider credential은
사용자 확인 없이 변경하지 않는다.

### 접속 방식별 구축 가이드

상태창과 브라우저 설정 화면에서 동일한 가이드를 제공한다.

| 방식 | 기본 주소 | 용도 | 진단 |
| --- | --- | --- | --- |
| 이 PC만 | `http://127.0.0.1:3410` | 가장 안전한 기본값 | loopback bind, entry token, ready |
| 같은 LAN | `http://<PC-IP>:3410` | 집·사무실 내부 기기 | bind, Windows 방화벽, 인증, 다른 기기 probe |
| Tailscale | Tailscale HTTPS 주소 | 개인 원격 접속 | daemon, Serve/HTTPS, 인증된 origin |
| Cloudflare | 사용자 도메인 HTTPS | 외부 브라우저 접속 | Tunnel, Access, Team Domain, AUD, origin |
| Reverse proxy | 사용자 HTTPS 주소 | 기존 프록시 연동 | forwarded headers, 인증 경계, WebSocket/SSE |

가이드는 다음을 포함한다.

- 방식별 장단점과 권장 대상
- 필요한 사전 준비
- 단계별 설정
- 복사 가능한 주소와 명령
- Workhouse가 자동으로 할 수 있는 항목과 사용자가 해야 하는 항목
- listener, 인증, WebSocket/SSE, 외부 health의 분리 진단
- 설정 취소와 원래 로컬 전용 상태로 돌아오는 방법

인터넷에 일반 HTTP를 직접 공개하는 선택지는 제공하지 않는다.

## 4. 패키지 구조

공개 산출물은 사용자가 받는 단일 파일이다.

```text
Claudex-Workhouse-Windows-x64.exe
```

EXE 내부에는 다음 페이로드가 들어간다.

```text
payload/
├─ payload.json
├─ node.exe
├─ app/
│  ├─ server/
│  ├─ workers/
│  ├─ dist/
│  └─ public/emoticons/
└─ payload.sig
```

런처는 애플리케이션 로직을 직접 구현하지 않는다. 다음 기능만 담당하는
작고 서명 가능한 네이티브 프로그램으로 제한한다.

- 단일 인스턴스 확인
- 페이로드 서명·크기·SHA-256 검증
- 안전한 staging 전개
- 버전 전환과 실패 시 복구
- 서버 프로세스 시작
- 상태창 렌더링과 로컬 health polling
- 로컬 브라우저 열기
- 진단·가이드·로그·재시작 링크
- 진단 가능한 종료 코드와 로그 기록

Node SEA, `pkg`, Electron 또는 Tauri로 전체 서버를 하나의 프로세스로
합치지 않는다. 서버는 정적 웹 파일과 작업별 Provider 프로세스를
필요로 하므로 실제 파일 전개가 필요하다.

## 5. 디렉터리와 상태 분리

```text
%LOCALAPPDATA%\Claudex Workhouse\
├─ runtime\
│  ├─ 0.1.0\
│  └─ 0.2.0\
├─ current.json
├─ data\
│  ├─ claudex-workhouse.sqlite
│  ├─ provider-auth\
│  └─ emotion\
├─ config\
├─ snapshots\
├─ logs\
├─ run\
└─ workspaces\
```

원칙:

- `runtime\<version>`은 전개 후 불변으로 취급한다.
- `data`, `config`, `snapshots`, `logs`, `workspaces`는 버전과 분리한다.
- `CLAUDEX_WORKHOUSE_APP_ROOT`는 코드와 정적 자산 위치를 가리킨다.
- `CLAUDEX_WORKHOUSE_DATA_ROOT`는 변경 가능한 사용자 상태를 가리킨다.
- 기존 `CLAUDEX_WORKHOUSE_ROOT`는 Linux 호환을 위해 유지하되, 새 두
  변수가 없을 때의 공통 기본값으로만 사용한다.
- Windows 데이터 루트에는 `icacls`로 상속을 제거하고 현재 사용자만
  읽기·쓰기가 가능하도록 ACL을 적용한다.
- 관리자 계정의 OS 차원 접근까지 차단할 수 있다고 주장하지 않는다.

## 6. 프로세스 구조

```text
Claudex Workhouse.exe                 # 상태창과 lifecycle
└─ node.exe server/index.js           # HTTP 제어 평면
   ├─ node.exe db-worker.js
   ├─ embedded DesktopWorkerClient    # 서버 내장 Windows 실행기
   ├─ node.exe claude-worker.js
   └─ codex.exe app-server
```

런처는 서버가 실행되는 동안 상태창을 유지하고 자식 서버의 종료를
감시한다. 상태창을 닫을 때는 “창만 숨기기”가 아니라 서버 종료 여부를
명확히 선택하게 한다. 트레이 UI는 1차 범위에 넣지 않는다.

서버 프로세스는 Windows에서 기존 `local` Linux 실행 경로를 사용하지
않는다. 부팅 시 다음 절차로 로컬 실행기를 자동 준비한다.

1. 설치 단위에 귀속된 로컬 실행기 identity를 만든다.
2. 서버 내부 API로 제한된 로컬 credential을 발급한다.
3. 루프백 WebSocket으로 `DesktopWorkerClient`를 연결한다.
4. 기본 Windows workspace root를 해당 host에 등록한다.
5. UI에는 하나의 “이 PC” 실행 장치로 표시한다.

사용자가 다른 PC를 원격 Worker로 추가하는 기존 pairing UI는 유지한다.

## 7. 플랫폼별 실행 정책

Windows에는 현재 Linux의 `bubblewrap`과 동등한 격리가 없다.

- `read`: Provider가 지원하는 읽기 전용 정책을 사용한다.
- `confirm`: Windows의 권장 기본값으로 한다.
- `automatic`: 샌드박스 없음이 UI와 감사 로그에 명확히 표시되어야 한다.
- `full`: 사용자가 명시적으로 선택한 경우에만 허용한다.
- Windows에서는 `probeNativeSandbox()`가 `bwrap`을 호출하지 않고
  `native-unavailable`을 반환해야 한다.

자동 실행의 정확한 기본값 변경 여부는 기존 사용자의 설정을 건드리지
않도록 플랫폼 기본 설정 생성 시점에만 적용한다.

## 8. 로컬 인증

현재 `authMode: "local"`은 loopback origin만 확인하고 곧바로
`local-admin`을 반환한다. Windows 포터블 서버에서는 같은 PC의 다른
프로세스가 API를 호출할 수 있으므로 이 동작을 그대로 사용하지 않는다.

Windows 로컬 모드는 다음을 요구한다.

- 런처가 생성한 256-bit 일회성 entry token
- 최초 브라우저 진입 후 HttpOnly, SameSite 쿠키로 교환
- 토큰 없는 API 요청 거부
- 토큰 및 credential을 URL·로그·지원 번들에서 삭제 또는 마스킹
- 서버 재시작과 owner claim 이후의 수명 정책을 테스트로 고정

Cloudflare Access 및 기존 test 인증 모드는 불필요하게 변경하지 않는다.

## 9. 데이터베이스와 파일 잠금

### SQLite worker

현재 `DeckDatabase`는 `/bin/python3`로 `sqlite-worker.py`를 실행한다.
Windows에서는 동일한 NDJSON 요청·응답 프로토콜을 구현하는 Node worker를
추가한다.

구현 원칙:

- `DeckDatabase`에 worker launch strategy를 주입한다.
- Linux 기본값은 기존 Python worker로 유지한다.
- Windows는 Node SQLite worker를 사용한다.
- SQL, 트랜잭션, timeout, worker 재시작 의미를 변경하지 않는다.
- Python판과 Node판에 동일한 contract test를 실행한다.

SQLite 구현체는 사전 검증 없이 확정하지 않는다. 다음 조건으로
`node:sqlite`와 검증된 native module을 비교한 뒤 결정한다.

- 지원할 Node LTS와 API 안정성
- Windows x64 prebuilt 공급 여부
- ABI 및 업데이트 결합
- SBOM·CVE 대응
- 백업 API와 WAL 동작
- 설치 없는 배포 크기

### 감정 상태 잠금

현재 `/bin/flock`과 `sh`를 사용하는 상태 기록을 플랫폼 lock adapter로
분리한다.

- Linux는 기존 `flock` 동작을 유지한다.
- Windows는 단일 writer queue와 임시 파일의 원자적 교체를 사용한다.
- 파일 교체 후 watcher가 새 inode를 다시 구독하도록 명시적으로 처리한다.
- 다중 서버 실행은 런처의 single-instance mutex로 먼저 차단한다.

## 10. Provider 런타임과 “해줘” 준비 상태

Workhouse EXE는 자체 Node 런타임을 내장하지만 Codex와 Claude Code는
독립된 공식 Provider 런타임이다.

### 실행 파일 탐색 순서

1. 사용자가 Workhouse에 명시적으로 지정한 실행 파일
2. 이전에 검증하여 저장한 실행 파일
3. `CODEX_BIN`, `CLAUDE_BIN` 등 명시적 환경 변수
4. `where.exe`와 현재 사용자 `PATH`
5. 검증된 공식 설치 위치 후보
6. 사용자가 파일 선택기로 직접 고른 실행 파일

후보는 이름이나 설치 흔적만으로 신뢰하지 않는다.

- regular file인지 확인
- reparse point와 예상 밖 네트워크 경로 정책 적용
- `--version`을 shell 없이 실행
- Provider별 공식 상태 명령 또는 protocol로 계정 상태 확인
- 실행 파일 경로, 버전, 출처와 마지막 검증 시각 기록
- credential 파일 자체는 읽거나 Workhouse DB로 복사하지 않음

### CLI와 공식 앱의 경계

- 공식 CLI가 설치되어 있으면 현재 Windows 사용자의 CLI 로그인 상태를
  사용한다.
- 공식 데스크톱 앱이 문서화된 CLI 또는 app-server 실행 파일을 제공하면
  해당 공식 인터페이스를 탐색 후보로 사용할 수 있다.
- 앱이 설치되어 있다는 사실만으로 CLI 실행 가능 또는 로그인 공유를
  가정하지 않는다.
- 공식 앱의 비공개 credential DB, 브라우저 저장소, registry secret을
  읽거나 변환하지 않는다.
- 공식 실행 인터페이스가 없으면 “앱은 발견했지만 작업 실행기는 없음”으로
  표시하고 공식 CLI 설치 가이드를 제공한다.

### 작업 준비 UX

상태창은 Provider마다 다음 네 상태를 구분한다.

- 찾지 못함
- 설치됨, 로그인 필요
- 설치·로그인됨, 진단 필요
- 작업 요청 가능

`작업 요청 가능`이 되려면 실행 파일, 버전, 공식 인증 상태, workspace
접근, 실행 정책이 모두 통과해야 한다.

상태창의 `Codex로 해줘` 또는 `Claude로 해줘` 버튼은 브라우저에서 해당
Provider와 기본 Workspace가 선택된 새 요청 화면을 연다. 사용자는
일반 입력창에 “이거 고쳐줘”, “테스트 해줘”처럼 요청할 수 있다.
상태창 자체에 별도의 대화 엔진이나 비공식 Provider 자동화를 넣지 않는다.

### 설치 및 로그인 정책

- 기존 Windows 사용자 PATH와 공식 설치 상태를 먼저 진단한다.
- 설치되어 있으면 해당 실행 파일을 사용한다.
- 없으면 Workhouse UI에서 공식 설치 또는 로그인 절차를 안내한다.
- 미검증 바이너리나 사용자 credential 파일을 복제하지 않는다.
- Provider 자동 다운로드를 추가할 경우 공식 배포 URL, 버전, 플랫폼,
  크기, SHA-256을 서명된 release metadata에 결속한다.

“EXE 하나”는 Workhouse 설치 파일이 하나라는 의미이며, Provider CLI가
하나의 프로세스로 합쳐진다는 의미가 아니다.

## 11. 구현 단계

각 단계는 독립적으로 병합할 수 있어야 하며 기존 Linux와 Docker 테스트가
통과해야 다음 단계로 진행한다.

### 단계 0: 지원 정책과 릴리스 선행조건

- Windows x64만 1차 지원 대상으로 확정
- 코드사이닝 인증서와 타임스탬프 서비스 결정
- Windows 기본 automation 정책 확정
- Node SQLite 구현체 확정
- EXE 최대 크기와 지원할 Windows 버전 확정

완료 조건:

- 서명되지 않은 공개 EXE는 stable로 승격할 수 없다는 릴리스 정책
- Windows 지원·비지원 범위 문서화

정책 초안 상태 (2026-07-29, 단계 0 미완료):

- 세부 정책은 `docs/windows-support-policy.md`에 고정했다. 1차 지원은
  지원 수명 안의 Windows 11 x64이며 Windows 10, Arm64, 32-bit,
  Windows Server 사용자 호스트는 제외한다.
- 신규 Windows 설정의 기본 automation은 `confirm`, 번들 런타임은
  Node.js 24 LTS x64, Windows SQLite worker는 고정 버전
  `better-sqlite3` native binary를 선택했다. `node:sqlite`는 현재
  release-candidate 안정성이므로 첫 stable에서 사용하지 않는다.
- 기존 Linux/Docker와 Worker의 Node 22 기준선은 별도 업그레이드 전
  유지한다. Windows SQLite contract는 release script를 실행한 임의의
  Node가 아니라 실제 번들할 Node 24 바이너리로 실행해야 한다.
- 단일 EXE 상한은 200 MiB이고 Provider CLI와 사용자 데이터는 포함하지
  않는다. `private: true`인 동안 버전 상한 `1.0.0`을 유지한다.
- SHA-256 Authenticode, SHA-256 RFC 3161 timestamp, Windows 검증,
  SBOM·attestation·Defender와 signed manifest 결속을 stable 승격의
  필수 gate로 정했다. 다만 실제 인증서 또는 managed-signing 서비스와
  timestamp endpoint는 아직 선택·등록되지 않았다. schema v2와 release
  workflow는 이 계약을 fail-closed로 강제하도록 구현됐지만 실제
  credential과 Windows runner로 성공한 적은 없다. 따라서 단계 0은
  닫히지 않았으며, 준비되기 전 Windows 빌드는 개발 artifact일 뿐 지원
  또는 stable로 표시할 수 없다.

### 단계 1: 경로와 플랫폼 능력 추상화

변경 후보:

- `app/src/server/config.ts`
- `app/src/server/codex/app-server.ts`
- `app/src/server/supervisor.ts`
- `app/src/server/runtime-updates.ts`
- `bin/claudex-workhouse.mjs`
- 신규 `app/src/server/platform.ts`

작업:

- `appRoot`와 `dataRoot` 분리
- `path.isAbsolute()` 기반 플랫폼별 절대경로 검증
- `C:\...`와 UNC 경로 지원
- 경로 비교 시 Windows 대소문자 규칙 반영
- UI와 진단의 `NAS` 고정 표기를 실제 host 이름으로 변경
- Linux 환경 변수와 기본 경로 호환 유지

구현 상태 (2026-07-30, 단계 1 완료):

- `CLAUDEX_WORKHOUSE_APP_ROOT`와 `CLAUDEX_WORKHOUSE_DATA_ROOT`를 분리하고
  기존 `CLAUDEX_WORKHOUSE_ROOT` 단일 루트 동작을 호환 경로로 유지했다.
  코드·정적 자산은 app root, DB·설정·로그·런타임·snapshot 등 변경
  가능한 상태는 data root를 사용한다.
- Windows drive/UNC 절대경로만 허용하고 device namespace, drive-relative,
  traversal, ADS, reserved device name과 모호한 후행 점·공백을 거부한다.
  경로 containment, 중복 제거와 파생 workspace ID에는 Windows
  대소문자 독립 키를 사용한다.
- managed Provider bootstrap은 app root의 installer를 실행하되 data
  root의 런타임만 읽고 쓴다. Windows에서 Codex runtime이 없으면
  PATH의 동명 실행 파일을 사용하지 않고 `unavailable`로 실패한다.
- 기존 Linux CLI는 Windows native launcher가 구현되기 전 비-Linux
  `start|stop|restart`를 spawn 전에 거부한다. 이는 단계 3·6 기능을
  앞당긴 구현이 아니며 orphan 또는 잘못된 PID 종료를 막는 임시
  fail-closed 경계다.
- Windows 경로·root 분리·runtime 선택·bootstrap 왕복·workspace ID
  계약을 단위 테스트로 고정했다. 관련 6개 파일 25개 테스트,
  `pnpm run check`, `git diff --check`가 통과했고 Claude Code 최종
  재검토에서 단계 1 차단 결함이 없음을 확인했다.
- Windows sandbox 결과 라벨, Windows 제어 평면 부팅과 native launcher는
  각각 단계 3과 단계 6 범위로 남아 있다. 이 단계 완료만으로 Windows
  실행 또는 지원을 주장하지 않는다.

### 단계 2: SQLite worker 플랫폼화

구현 상태: 2026-07-30 코드 및 Linux-hosted Node 24 계약 검증 완료.

- Linux 기본값은 기존 `/bin/python3` worker를 유지하고 Windows만 번들
  Node worker를 선택한다.
- Windows worker는 정확히 고정한 `better-sqlite3@12.11.1`과 단일 요청
  queue를 사용하며, WAL·FULL synchronous·busy timeout·재시작 한도를
  기존 계약과 맞췄다.
- canonical schema는 빌드 시 Python worker에서 SQL 자산으로 추출한다.
  빌드는 121개 공통 operation, ensure-column 목록, v6/v8 재구축 SQL과
  identity migration marker 불변식을 비교해 한쪽만 바뀐 경우 실패한다.
- `pnpm run test:sqlite-node`는 빌드된 Node worker를 실제로 실행하며
  DB 기본 계약, 구형 DB migration, Windows slash-form root 이동,
  history casefold, prompt preset, quota reservation, release state와 task
  recovery fixture를 같은 테스트로 검증한다. 이 명령은 GitHub verify
  workflow에도 연결했다.
- Node 유지보수 helper의 원본·백업본 `quick_check`와 online backup
  왕복은 Node 24 Docker에서 확인했다.

아직 깨끗한 Windows 11 x64 runner/VM 자체에서 실행한 결과는 없다.
Windows artifact의 native binding 포함 검증과 Linux/Windows 패키지
분리는 단계 6의 차단 게이트로 유지한다. NAS bind mount에서는 native
worker 최초 로딩이 협업 fixture의 개별 10초 제한을 넘었으므로 해당
59개 협업 테스트를 Node worker 통과로 기록하지 않는다.

변경 후보:

- `app/src/server/db/client.ts`
- `app/src/server/db/sqlite-worker.py`
- 신규 `app/src/server/db/sqlite-worker.mjs`
- `app/src/server/snapshot-store.ts`
- `app/src/server/infrastructure/server-health.ts`

작업:

- worker launch strategy 도입
- Windows Node worker 구현
- 온라인 백업과 `quick_check` 동등성 확보
- DB worker 장애·재시작·timeout 계약 유지

### 단계 3: Windows 제어 평면 부팅

변경 후보:

- `app/src/server/index.ts`
- `app/src/server/security/auth.ts`
- `app/src/server/emotion.ts`
- `app/src/server/execution-policy.ts`
- `app/src/server/config.ts`

작업:

- Windows 루프백 서버 부팅
- entry token 인증
- `flock` 대체 adapter
- Windows sandbox capability 분기
- `execution-policy`의 sandbox label과 transport 값을 Windows 실제
  격리 능력에 맞게 분기
- NTFS ACL 적용
- 상태창이 소비할 bootstrap/health snapshot API
- `/proc`, `/bin/sh`, `/bin/python3` 경로가 Windows 부팅 중 호출되지
  않는지 검증

구현 상태: 2026-07-30 코드 및 Linux-hosted 계약 검증 완료.

- Windows `local` 모드는 `127.0.0.1` bind와 loopback origin을 부팅 시
  강제한다. 런처가 전달한 256-bit token은 환경에서 즉시 제거하며,
  loopback POST 한 번으로만 HttpOnly·SameSite=Strict 세션 쿠키와
  교환된다. 서버 재시작은 이전 쿠키를 무효화한다.
- owner claim 공개 경로도 entry 세션을 먼저 요구한다. claim이 완료된
  뒤에는 entry 쿠키만으로 관리 API에 접근할 수 없고 기존 owner
  credential도 함께 있어야 한다. 이 조합은 Fastify 왕복 fixture로
  고정했다.
- 쿠키를 삭제한 뒤 token을 이미 소비했다면 실행 중인 서버에서는 다시
  교환하지 않는다. 상태창은 bootstrap snapshot의 `consumed`와
  `sessionActive`를 보고 서버 재시작을 안내해야 한다.
- token 없는 API 예외는 최소 liveness/readiness와 loopback 전용
  bootstrap status/exchange뿐이다. 상세 `/api/health`와 API SSE는 인증을
  요구하고, 서버 자체 transport probe는 비-API `/health/sse`를 사용한다.
- 신규 Windows Codex 설정은 서버와 새 브라우저 설정 모두 `confirm`을
  기본으로 삼는다. 명시된 automation/permission 및 기존 브라우저
  설정은 다시 쓰지 않으며 Linux 기본값은 유지한다.
- Windows native sandbox probe는 bwrap, `/proc`, `/bin/sh` 진입 전에
  `native-unavailable`/`platform-unsupported`를 반환한다. read/confirm/
  automatic의 transport와 UI에는 실제 sandbox 부재를 반영한다.
- 감정 상태 쓰기는 Windows에서 프로세스 내부 queue, 같은 디렉터리의
  배타 임시파일, fsync와 atomic rename을 사용한다. rename 실패 시
  임시파일 정리도 검증했다. 단계 6 single-instance mutex 전까지 두
  서버 프로세스가 동시에 쓰는 경우는 보호하지 못한다.
- NTFS ACL은 먼저 현재 사용자에게 명시 Full Control을 부여한 뒤 상속과
  광범위 grant를 제거한다. `/C`를 사용하지 않고 파일 처리 실패를
  fail-closed로 취급한다.

아직 실제 Windows 11 x64 호스트에서 loopback bind, 브라우저 쿠키 수용,
NTFS 최종 ACL과 `icacls` 종료 코드, NTFS rename 경합을 확인하지 못했다.
Claude quota/model/auth용 Python helper는 부팅 경로가 아니며 Windows
Provider 발견·준비 adapter가 구현되는 단계 5 검증 대상으로 이관한다.
런처가 ACL 적용 전 data root/config를 만드는 짧은 구간과 프로세스 간
감정상태 경합은 단계 6에서 각각 bootstrap 순서와 single-instance
mutex로 닫아야 한다.

### 단계 4: 로컬 실행기 자동 등록

변경 후보:

- `app/src/server/worker-hub.ts`
- `app/src/server/desktop-worker/client.ts`
- `app/src/server/desktop-worker/config.ts`
- `app/src/server/host-workspaces.ts`
- `app/src/server/index.ts`

작업:

- 설치 단위 local worker identity
- 사용자 입력 없는 제한된 credential 발급
- loopback 전용 자동 연결
- 재시작 후 identity 재사용
- credential 회전과 폐기
- 원격 Worker pairing과 상태 분리
- UI에서 “별도 Worker 설치”가 아닌 “이 PC”로 표시

구현 상태: 2026-07-30 코드 및 Linux-hosted 통합 검증 완료.

- Windows의 `local` 실행은 별도 pairing 없이 설치 단위
  `runtime/local-worker` identity와 제한 credential을 만들고 WorkerHub의
  loopback WebSocket을 통해서만 Provider 작업을 실행한다. 원격 Worker
  pairing은 계속 UUID host만 만들며 같은 저장소를 재사용하지 못한다.
- credential 평문은 설치별 ACL 대상 config에만 저장하고 DB에는 SHA-256
  hash만 저장한다. 최초 발급은 복구 가능한 config를 DB hash보다 먼저
  원자 저장하여 DB 쓰기 중단 뒤 다음 부팅에서 같은 identity를 복구한다.
  회전은 이전 credential의 짧은 재연결 유예를 사용하고, 폐기된 identity는
  자동 재발급으로 부활시키지 않는다.
- 작업 생성, resume, fork, compact, take-control과 handoff 직전에 서버의
  승인된 local root/workspace를 Worker config로 다시 동기화한다. 기존
  workspace 경계와 경로 검증은 완화하지 않았다.
- UI는 별도 Worker 행을 만들지 않고 local host를 “이 PC”로 표시한다.
  부팅 중 `connecting`, 연결 후 `online`, 연결 해제 또는 bootstrap 실패
  후 `offline` 상태를 같은 host에서 표시한다.
- 실제 Fastify WebSocket과 DesktopWorkerClient를 사용한 fixture에서
  local task start/status 완료, 재시작 identity 재사용, credential 회전
  후 재연결, 폐기 후 재시작 거부, DB 쓰기 실패 후 자동복구를 검증했다.
  loopback 전용 연결과 remote pairing 저장소 거부도 계약 테스트로
  고정했고 Claude Code 재검토에서 단계 4 차단 결함이 없음을 확인했다.

아직 실제 Windows 11 x64 호스트에서 loopback WebSocket과 방화벽 프롬프트,
temp 파일에 적용한 `icacls`가 rename 뒤 보존되는지, data root 상속 ACL,
Worker child process 기동·회수와 `Get-CimInstance` 신원 확인을 검증하지
못했다. approval, user-input, recovery의 managed-local 라우팅은 공통
Worker 술어를 사용하지만 단계 4 전용 통합 fixture로 각각 왕복하지는
않았다. 이 항목은 제한사항으로 남기며 Windows 지원 완료로 표시하지 않는다.

### 단계 5: Provider 발견과 작업 준비

변경 후보:

- `app/src/server/desktop-worker/config.ts`
- `app/src/server/desktop-worker/tasks.ts`
- `app/src/server/infrastructure/health.ts`
- `app/src/server/runtime-updates.ts`
- `app/src/server/provider-auth.ts`
- 신규 `app/src/server/windows/provider-discovery.ts`

작업:

- Windows 실행 파일 탐색 adapter
- CLI와 공식 앱 제공 실행 인터페이스의 출처 구분
- 버전 및 공식 인증 상태 probe
- 사용자가 선택한 실행 파일 저장과 재검증
- “설치됨”과 “작업 요청 가능” 상태 분리
- Provider별 새 요청 deep link
- credential store 비접근 테스트

구현 상태: 2026-07-30 코드 및 Linux-hosted 계약 검증 완료.

- Windows Worker에 Provider 발견 adapter를 추가했다. 사용자가 선택한
  경로, 이전 검증 경로, `CODEX_BIN`/`CLAUDE_BIN`, `where.exe`와 PATH,
  공식 CLI 후보, 공식 앱 제공 인터페이스 후보 순서를 고정했다. 사용자
  선택이 낡거나 잘못된 경우 다른 PATH 바이너리로 조용히 전환하지 않는다.
- 후보는 Windows drive-absolute 경로와 정확한 Provider `.exe` 이름,
  regular file, reparse/realpath 정책을 통과해야 하며 shell 없이
  `--version` probe에 성공해야 한다. UNC, slash-form UNC, device path와
  드라이브 없는 rooted path는 거부한다. `..`가 포함된 입력은 먼저
  Win32 정규화한 뒤 최종 drive-absolute 경로를 다시 검증한다.
- 검증된 경로, 버전, 출처, 인터페이스 종류와 검증 시각은 설치별 Worker
  config에 저장하고 다음 부팅에서 재검증한다. 공식 데스크톱 앱의 존재는
  별도 `presenceDetected`로만 기록하며 호출 가능한 CLI/app-server
  인터페이스가 없으면 runtime으로 취급하지 않는다.
- 인증 상태는 Claude의 공식 `auth status`와 Codex app-server의
  `account/read`만 사용한다. discovery는 Provider credential/token 파일,
  비공개 앱 DB, 브라우저 저장소 또는 registry secret을 읽지 않는다.
  Windows 서버의 상태·진단·runtime API도 local Worker를 경유한다.
- 준비 상태는 `not-found`, `login-required`, `diagnostic-required`,
  `ready`로 구분하고 검증 runtime, 공식 인증 상태, 등록 Workspace 접근,
  기존 execution policy 결과를 함께 반환한다. Windows 기본 정책은
  Codex `confirm`, Claude `auto`이며 실제 policy 객체와 UI label도
  상태에 포함한다.
- 사용자 지정 실행 파일 API는 인증, Worker 플랫폼 재검증, idempotency,
  5회/10분 제한과 경로 비공개 audit를 적용한다. 상태창이 사용할
  `/?new=1&provider=...&host=...&workspace=...` 계약은 부팅 중
  `connecting`인 “이 PC”도 유지하며 Provider와 Workspace를 교차 검증한다.
- 경로 공격, stale 선택, 앱만 설치된 상태, credential 경로 비접근,
  4단계 판정과 deep-link 왕복을 단위 테스트로 고정했다. 기존 managed
  local 및 원격 Worker 통합 테스트와 Claude Code 재검토에서 단계 5
  차단 결함이 없음을 확인했다.

실제 Windows에서 `where.exe` 출력과 다중 후보 순서, junction/reparse의
`realpathSync.native` 결과, 실제 Claude Code/Codex 설치 위치, Claude
인증 JSON과 Codex `account/read`, 선택한 실행 파일의 작업 기동·회수는
검증하지 못했다. 현재 공식 설치 위치 후보도 실기 확인 전의 후보이며
지원 계약으로 확정하지 않는다. Provider capability flag는 현재 지원
버전에 맞춘 값이고 runtime version별 자동 파생은 아직 하지 않는다.

### 단계 6: 단일 EXE 상태창과 패키징

변경 후보:

- 신규 `app/scripts/package-windows-server.mjs`
- 신규 `launcher/windows/`
- `app/package.json`
- 기존 `app/scripts/package-worker-portable.mjs`
- 기존 `app/src/server/deployment/worker-install.ts`

작업:

- 서버·웹·emoticon·Node 런타임 번들
- payload manifest와 파일별 hash
- 안전한 archive path 검증
- staging 전개와 원자적 `current.json` 전환
- single-instance mutex
- 네이티브 상태창과 단계별 진행 표시
- server health polling과 remediation action
- 접속 방식별 내장 가이드
- 로컬·외부 주소 열기와 복사
- Provider별 “해줘” 진입 링크
- 기존 서버 감지 및 브라우저 열기
- 한글·공백·긴 사용자 경로 지원
- 실패 시 이전 버전 보존

런처 구현 언어는 Rust 또는 C++를 우선 검토한다. .NET 런타임을 별도로
요구하는 C# self-contained 배포는 크기와 추가 런타임 검증 비용을 비교한
뒤에만 선택한다.

구현 상태: 2026-07-30 코드 및 Linux-hosted 계약·교차 컴파일 검증 완료.
Windows 실기 릴리스 게이트 전이므로 지원 완료는 아님.

- C++ Win32 런처와 CMake/manifest/resource 뼈대를 추가했다. 런처는 설치
  단위 mutex, 검증된 `current.json` payload 선택, 파일별 size/SHA-256
  확인, loopback bootstrap polling, 로컬·외부 주소 열기/복사와 Provider
  deep link를 제공한다.
- 런처가 만든 서버는 suspended 상태에서 kill-on-close Job Object에 먼저
  연결한 뒤 재개한다. 상태창을 닫을 때 서버 종료, 서버 유지, 취소를
  명시적으로 선택한다. 기존 3410 서버는 bootstrap 응답의 product와
  schema version이 모두 일치할 때만 재사용한다.
- browser fragment의 일회용 entry token을 서버 쿠키로 교환한 뒤 성공과
  terminal 거부에서 fragment를 제거한다. 앱은 이 교환을 owner/API
  요청보다 먼저 수행한다.
- 패키징 스크립트는 외부에서 전달한 Windows `node.exe`, production
  `node_modules`, Windows native `better_sqlite3.node`, 런처 EXE와 현재
  서버·웹 자산을 묶는다. 웹 자산 의존성은 재귀적으로 닫고 누락 시
  실패하며, 200 MiB 제한과 payload manifest를 적용한다. 진단용 폴더와
  단일 EXE를 함께 생성한다.
- 단일 EXE 포맷 v2는 canonical launcher SHA-256, manifest SHA-256과
  파일별 SHA-256을 결속한다. Authenticode가 바꾸는 PE checksum과
  security directory entry만 launcher digest에서 제외하고 certificate
  table 시작점을 논리적 EOF로 사용한다. 서명 모사 fixture에서 footer
  탐색과 checksum 변경 허용, launcher·padding·payload·manifest 변조
  거부를 확인했다.
- 네이티브 런처는 검증한 container를 사용자별 random exclusive staging에
  `CREATE_NEW`로 전개하고 파일별 flush/hash 확인 뒤 version 디렉터리로
  원자 이동한다. 캐시된 version도 매 실행 embedded manifest로 다시
  검증하며, 검증한 target 경로를 `current.json` 왕복 없이 직접 실행한다.
  폴더 패키지는 footer가 없을 때만 개발 fallback으로 사용한다.
- payload helper는 Windows에서 모호한 이름, traversal, 대소문자 충돌,
  symlink/unsupported file을 거부하고 staging 검증 뒤 버전 디렉터리 및
  `current.json`을 원자 전환한다. 동일 버전 재검증 시 남은 staging도
  제거한다.
- Linux에서 payload/bootstrap/local-entry 및 single-EXE 관련 계약
  테스트와 TypeScript/Svelte 검사를 통과했다. Zig 0.16.0의
  `x86_64-windows-gnu` 대상으로 C++ 소스가 실제 PE까지 컴파일·링크되는
  것도 확인했다. 그 교차 컴파일 launcher를 TS builder로 single EXE로
  만든 뒤 inspect·extract한 fixture 왕복도 통과했다. Claude Code
  재검토에서 이 범위의 Blocker/High/Medium이 없음을 확인했다.

아직 실제 Windows 11 x64에서 MSVC `/W4 /WX`, Windows SDK와 resource
manifest 임베드, Authenticode, mutex/Job Object/브라우저/clipboard,
한글·공백·긴 경로, NTFS reparse/rename을 실행하지 못했다. Windows
`node.exe`와 native production dependency를 넣은 실제 릴리스 패키징,
서명 후 재검증, TS build에서 C++ extract·서버 기동까지의 Windows 왕복은
수행하지 못했다. 따라서 구현 코드는 단계 6 범위를 채웠지만 Windows 지원
완료나 배포 가능으로 표시하지 않는다.

### 단계 7: 업데이트와 롤백

- 새 버전을 실행 중 버전과 다른 디렉터리에 전개
- 프로세스 종료 후 `current.json` 전환
- health check 성공 후 현재 버전 확정
- N-1 버전 하나를 롤백용으로 보존
- 실행 중 파일은 삭제하지 않고 pending cleanup으로 처리
- DB migration 전 snapshot 생성
- DB schema가 비가역적으로 올라간 경우 단순 바이너리 롤백 금지
- snapshot 복원까지 포함한 롤백 절차 제공

구현 상태: 2026-07-30 코드 및 Linux-hosted 실제 SQLite fixture 검증 완료.

- 업데이트 상태 저장소는 한 번에 하나의 lease만 허용하고, health 확인
  전에는 새 버전을 확정하지 않는다. 실패하거나 명시적으로 되돌리는 경우
  N-1 payload와 migration 전 snapshot을 함께 사용한다.
- snapshot manifest의 버전·경로·크기·SHA-256을 다시 검증하고
  `quick_check`를 통과한 DB만 같은 디렉터리 임시파일과 원자 교체로
  복원한다. WAL/SHM/journal sidecar도 복원 전 보존하며, restore journal로
  crash 중단 뒤 commit/revert를 재개한다.
- 이전 DB artifact가 불완전하면 바이너리만 낮추지 않고 현재 payload로
  되돌아가는 forward recovery를 수행한다. payload와 DB 복원이 모두
  실패하면 두 오류를 함께 보존한다.
- 실제 Python SQLite DB를 migration snapshot에서 복원하는 통합 fixture,
  hash/path/manifest 변조 거부, 중복 결정, crash journal 회복과
  불완전 snapshot의 fail-closed 경로를 검증했다. 관련 테스트와
  TypeScript 검사, Claude Code 재검토를 통과했다.

아직 실제 Windows 11 x64의 NTFS에서 열린 SQLite 파일, antivirus 간섭,
전원 차단 중 rename/journal 내구성과 launcher 프로세스 전환을 검증하지
못했다. 서버는 DB를 열기 전에 update store의 `initialize()`를 호출해야
하며 이 부팅 순서의 Windows end-to-end 검증도 남아 있다. 오래된
pre-restore 보존본과 중단된 staging/temp 정리 정책은 별도 운영 수명주기
검증 전까지 자동 삭제하지 않는다.

### 단계 8: 통합 릴리스와 설치 사이트

변경 후보:

- `app/src/server/deployment/release-manifest.ts`
- `deploy/release-manifest.schema.json`
- `app/scripts/create-release-manifest.mjs`
- `app/scripts/verify-release-directory.ts`
- `app/scripts/verify-release-promotion.ts`
- `.github/workflows/release.yml`
- `installer-web/src/types.ts`
- `installer-web/src/release.ts`
- `installer-web/src/main.ts`
- 신규 Windows server downloader/검증 코드

작업:

- manifest schema v2에 Windows server EXE 추가
- 기존 Linux server image 및 세 Worker 항목 보존
- Windows EXE의 URL, size, SHA-256, Authenticode 정보를 manifest에 결속
- `windows-2022` CI에서 빌드·서명·스모크·SBOM·attestation 수행
- 정적 설치 사이트에 “Windows 메인 서버” 선택지 추가
- 기존 “Windows는 Worker만 지원” 문구 갱신

구현 상태: 2026-07-30 코드 및 Linux-hosted 계약 검증 완료. 실제 Windows
릴리스 실행과 stable 승격은 미검증 상태다.

- release manifest schema v2는 기존 Linux image와 세 Worker를 유지하면서
  Windows x64 단일 EXE의 immutable URL, size, SHA-256, 유효한
  Authenticode certificate SHA-256·subject·timestamp 정책을 결속한다.
  backend verifier가 동일 release directory와 trusted origin까지
  fail-closed로 검증한다. schema v1 소비 호환은 유지하지만 Windows
  메인 서버 항목을 넣을 수 없다.
- release 생성기는 최종 signed PE와 별도 Authenticode metadata를
  요구하고 MZ/PE, 이름, 크기, hash, signer와 timestamp 일치를 검사한다.
  release directory 검증기도 v2 EXE를 확인하며 v1에는 기존 동작을
  유지한다.
- `windows-2022` release job은 Node 24 payload, MSVC `/W4 /WX` launcher,
  현재 사용자 certificate import, SHA-256/RFC 3161 서명과
  `signtool verify`, Authenticode metadata, Defender gate, SBOM과
  provenance를 최종 signed EXE에 결속하도록 구성했다.
- 정적 설치 사이트는 v2에서만 Windows 메인 서버를 표시한다. 브라우저가
  생성한 PowerShell downloader는 서명된 manifest를 다시 검증하고,
  HTTPS redirect·크기·SHA-256·Authenticode signer와 timestamp를 확인한
  뒤 Windows Known Folder의 Downloads에 저장만 하며 자동 실행하지 않는다.
  v1은 Worker 설치만 계속 제공한다.
- manifest·workflow·generator·release-directory·installer 계약 테스트,
  installer TypeScript 검사와 정적 build, Claude Code 재검토를 통과했다.

실제 GitHub Windows runner에서 이 workflow를 실행하지 않았고 MSVC,
Windows SDK/resource compiler, PFX 또는 managed-signing credential,
선택된 RFC 3161 endpoint, `signtool`, Defender signature freshness,
Syft/SBOM, attestation 결과도 확인하지 못했다. 깨끗한 비관리자 Windows
11 x64에서 다운로드, SmartScreen/신뢰 체인, Known Folder redirection,
한글·공백·긴 경로, 저장 후 수동 실행과 최초 부팅도 미검증이다. 따라서
이 구현만으로 Windows 메인 서버를 supported 또는 stable로 표시하지
않는다.

## 12. 테스트 계획

### 단위 테스트

- Windows 드라이브 및 UNC 절대경로 허용
- 상대경로, device path, traversal, reserved name 거부
- Windows case-insensitive containment
- app/data root 분리
- entry token 없는 local API 거부
- Windows에서 `bwrap` 호출 없음
- local worker credential의 생성·재사용·회전·폐기
- 잘못된 payload hash와 서명 거부
- 중복·대소문자 충돌·reparse point·Zip Slip 경로 거부
- 업데이트 상태 머신과 실패 롤백

### 공통 회귀 테스트

- 전체 unit/integration test
- server typecheck
- web/Svelte typecheck
- installer-web test/build
- character/collaboration test
- Docker 이미지 build 및 health check
- Linux SQLite Python worker contract
- 기존 Windows/Linux Worker package 검증

### Windows CI

- 현재 지원되는 GitHub Windows runner의 빌드·공통 계약 테스트
- 깨끗한 Windows 11 x64 VM의 비관리자 사용자 수용 테스트
- EXE 최초 실행과 브라우저 진입
- 구축 단계가 상태창에 순서대로 표시되는지 확인
- 각 실패 fixture가 올바른 해결 버튼과 가이드로 연결되는지 확인
- 관리자/UAC 프롬프트 없음
- 방화벽 프롬프트 없음
- 두 번째 실행 시 서버 중복 없음
- 한글·공백 사용자명
- 긴 경로 인식
- Codex 및 Claude 상태 진단
- PATH 설치, 명시적 실행 파일, 공식 앱 제공 CLI 후보 탐색
- 앱만 있고 실행 인터페이스가 없을 때 실행 가능으로 오판하지 않음
- Provider credential 파일을 읽지 않음
- “해줘” 버튼이 올바른 Provider·Workspace 새 요청 화면을 여는지 확인
- workspace 생성·등록·Git 작업
- 재부팅 후 선택적 자동 시작
- 업데이트와 N-1 롤백
- 제거 시 runtime 삭제와 data 보존 선택

### 보안 및 릴리스 게이트

- 지원 중인 Windows release runner에서 Authenticode 서명과 trusted
  timestamp 검증
- 내장 payload와 signed manifest SHA-256 일치
- SBOM 생성
- dependency 및 secret scan
- Defender 검사
- 루프백 인증 우회 테스트
- data/config/credential ACL 검사
- 로그와 지원 번들에 token·credential이 없는지 검사

## 13. 완료 기준

다음 조건을 모두 만족해야 Windows 메인 서버를 “지원”으로 표시한다.

1. 깨끗한 Windows x64 VM에서 EXE 하나로 최초 실행할 수 있다.
2. Node.js, Python, Docker 또는 관리자 권한을 사전에 요구하지 않는다.
3. 별도 Worker pairing 없이 Windows workspace에서 테스트 작업이 성공한다.
4. 상태창에서 구축 단계, 실패 원인, 접속 링크와 해결 가이드를 확인할
   수 있다.
5. 공식 CLI가 준비된 Provider는 브라우저의 새 요청 화면에서 바로
   작업을 시작할 수 있다.
6. 공식 앱만 있고 실행 인터페이스가 없는 경우 준비 완료로 오판하지
   않는다.
7. 토큰 없는 로컬 API 접근이 거부된다.
8. Windows 기본 실행 정책이 UI와 실제 Provider 정책에서 일치한다.
9. 업데이트 실패 후 이전 버전 또는 DB snapshot으로 복구할 수 있다.
10. Authenticode, manifest, SBOM, attestation 검증이 모두 통과한다.
11. 기존 Synology/Linux Docker 및 원격 Worker 동작이 바뀌지 않는다.

## 14. 1차 범위에서 제외

- Windows arm64
- LocalSystem Windows 서비스
- Electron/Tauri 데스크톱 셸
- 트레이 UI와 상태창 내 전체 대화 UI
- 직접 인터넷 공개를 위한 자동 방화벽·공유기 설정
- Provider credential 복제
- Windows에서 Linux `bubblewrap`과 동등한 자체 샌드박스 구현
- 실행 중 작업을 유지하는 무중단 바이너리 업데이트

## 15. 권장 작업 분할

한 번에 전체 기능을 구현하지 않는다.

1. `appRoot`/`dataRoot`와 Windows 경로 테스트
2. SQLite worker contract와 Windows 구현
3. Windows 루프백 제어 평면 및 인증
4. 자동 로컬 Worker
5. Provider 발견과 작업 준비 판정
6. 개발용 상태창과 폴더 패키지
7. 자체 전개 EXE
8. 업데이트·롤백
9. signed public release

각 PR은 Linux 동작 불변을 증명하는 기존 테스트와 새 Windows 전용
테스트를 함께 포함해야 한다.
