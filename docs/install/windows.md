# Windows 설치

[설치 시작](index.md) · [Windows Worker](windows-worker.md) · [Docker 상세](../docker.ko.md)

> **포터블 ZIP: 출시 후보 · Windows 11 인수 테스트 대기.** 포터블 서버는
> 이제 payload 검증과 서버 기동을 모두 통과하고, Claude Code·Codex 작업을 별도
> Worker 없이 서버가 직접 실행합니다. 다만 [Windows 지원 정책](../windows-support-policy.md)의
> 깨끗한 비관리자 Windows 11 인수 테스트를 아직 수행하지 않았으므로 정식 지원으로
> 표시하지 않습니다. 단일 EXE 설치형과 Windows Worker는 계속 개발 중입니다.
>
> 공개 릴리스에는 아직 Windows 자산이 없습니다. 포터블 ZIP은 소스에서
> 빌드합니다(`windows-test-build` workflow 수동 실행 또는 아래 "직접 빌드").

## 포터블 ZIP으로 실행

1. `claudex-workhouse-server-windows-x64-portable.zip`을 받습니다.
2. SHA-256 값이 함께 배포된 `.sha256` 파일과 같은지 확인합니다.
   `Get-FileHash .\claudex-workhouse-server-windows-x64-portable.zip -Algorithm SHA256`
3. ZIP을 일반 로컬 폴더에 풉니다(탐색기 "압축 풀기"로 충분합니다). 압축을 풀면
   `Claudex Workhouse` 폴더가 생기고 그 안에 `Claudex Workhouse.exe`가 있습니다.
   서명되지 않은 빌드라 SmartScreen에 게시자 경고가 표시될 수 있습니다. Windows 보안
   기능을 끄지 마세요.
4. `Claudex Workhouse.exe`를 실행합니다. 설치 화면은 없습니다. 런처가 폴더 안의
   payload 전체를 manifest와 대조해 검증한 뒤 바로 서버를 시작하고 상태 화면을
   보여 줍니다. **Workhouse 열기**를 누릅니다.
5. 열린 로컬 페이지에서 코드 인증과 관리자 등록을 완료합니다.
6. Claude Code 또는 Codex CLI를 설치합니다. 서버는 공식 설치 위치
   (`%USERPROFILE%\.local\bin`, `%LOCALAPPDATA%\Programs\...`, PATH, 데스크톱 앱)와
   앱 안 설치 경로(`%LOCALAPPDATA%\Claudex Workhouse\runtime\...`)에서 `claude.exe`,
   `codex.exe`를 자동으로 찾습니다. 앱 안 설치본이 있으면 그것이 우선합니다.
7. `로그인 필요`이면 **공식 로그인 열기**를 누르고 브라우저 로그인 절차를 완료합니다.
8. 작업 폴더를 등록하고 읽기 전용 첫 테스트가 성공하면 설정이 끝납니다.

```text
ZIP 압축 해제 → Claudex Workhouse.exe → 검증·즉시 시작 → 브라우저 설정(코드 인증) → CLI 설치 → 공식 로그인 → 작업 폴더 → 첫 테스트 성공
```

### Worker 없이 직접 실행

Windows 서버는 Linux 서버와 같은 방식으로 Claude Code와 Codex를 **서버 프로세스가
직접** 실행합니다. 예전처럼 서버가 자기 자신에게 연결하는 로컬 Worker를 띄우지
않으므로 Worker 연결 대기, Worker 재연결 같은 단계가 없습니다.

- 작업 프로세스의 생존 여부는 작업마다 쥐고 있는 배타 잠금 파일로 확인합니다.
  PID 재사용에 속지 않고 PowerShell 호출도 필요 없습니다.
- 작업 중지는 작업 프로세스가 스스로 정리하도록 요청한 뒤(Codex는 진행 중 턴을
  중단), 5–8초 안에 끝나지 않으면 CLI와 그 하위 도구 프로세스 전체를 종료합니다.
- Python은 필요 없습니다. DB는 번들된 Node SQLite 워커를 씁니다.

Windows에서 아직 동작하지 않는 기능:

- Antigravity·Grok 실행과 로그인(POSIX 의사 터미널과 Unix 소켓이 필요합니다). DeepSeek·Ollama는
  Claude Code 엔진으로 직접 실행됩니다.
- Claude 사용량 조회와 Claude 모델 목록 자동 갱신(Python 도구 사용). 모델 목록은
  기본 목록으로 대체되고 작업 실행에는 영향이 없습니다.

### 직접 빌드

Windows x64에서 Node 24, pnpm, CMake·MSVC로 빌드합니다.

```powershell
cd app
pnpm install --frozen-lockfile
pnpm run build
pnpm prune --prod
cmake -S ..\launcher\windows -B ..\out\windows-launcher -A x64
cmake --build ..\out\windows-launcher --config Release
$env:CLAUDEX_WORKHOUSE_WINDOWS_NODE_EXE = (Get-Command node.exe).Source
$env:CLAUDEX_WORKHOUSE_WINDOWS_NODE_MODULES = (Resolve-Path node_modules).Path
$env:CLAUDEX_WORKHOUSE_WINDOWS_LAUNCHER_EXE = (Resolve-Path ..\out\windows-launcher\Release\claudex-workhouse.exe).Path
node scripts/package-windows-server.mjs
```

결과물은 `packages\claudex-workhouse-server-windows-x64-portable.zip`과 `.sha256`
파일입니다. 패키저는 ZIP을 직접 작성하며, 모든 항목 이름이 ASCII이고 탐색기의
경로 길이 한도 안에 있는지 확인하지 못하면 빌드를 실패시킵니다.

포터블 ZIP은 설치하지 않습니다. 프로그램 파일은 압축을 푼 폴더에만 있고, 시작
메뉴·바탕화면 바로가기, Windows `설치된 앱` 등록, 설치 위치 레지스트리 항목을
만들지 않습니다. 폴더를 지우면 프로그램이 사라지고, 폴더를 통째로 옮기거나 USB에
담아 다른 PC에서 실행할 수 있습니다. 설정·자격 증명·로그·DB 같은 사용자 데이터만
`%LOCALAPPDATA%\Claudex Workhouse`에 저장됩니다.

설치 마법사, 설치 위치 선택, 바로가기·제거 등록은 단일 EXE
(`claudex-workhouse-server-windows-x64.exe`, 개발 중)만 제공합니다.

Provider 설치본과 로그인 정보는 현재 Windows 사용자 영역에만 보관됩니다. Workhouse는 로그인 비밀번호나 OAuth 토큰을 화면, 로그 또는 DB에 복사하지 않습니다.

## 업데이트와 제거

업데이트 전 현재 포터블 폴더와 사용자 데이터의 백업·복구 경로를 확인하세요. 프로그램 파일과 사용자 데이터는 별개이며 작업 폴더 자체를 삭제하면 안 됩니다. 포터블 폴더를 지우는 것이 제거이며, 사용자 데이터는 `%LOCALAPPDATA%\Claudex Workhouse`에 남습니다.

## 고급·대체 설치

- **Linux/NAS Docker**: 가능하면 이 권장 경로를 사용합니다. [설치 시작](index.md)을 참고하세요.
- **Docker Desktop + Windows Worker**: Windows 안에서 서버와 실행 환경을 분리하는 대안입니다. [Windows Worker](windows-worker.md)를 참고하세요.
- **Node 직접 설치**: 개발·디버깅용이며 초보자 기본 경로가 아닙니다.

이전: [설치 시작](index.md) · 다음: [로컬 네트워크](local-network.md)
