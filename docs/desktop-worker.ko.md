# Claudex Workhouse Desktop Worker

[English](desktop-worker.en.md) · [한국어](desktop-worker.ko.md) · [日本語](desktop-worker.ja.md)

Worker는 Node.js 20 이상이 필요하며 Windows x64, Linux x64/arm64, macOS arm64를 플랫폼 중립 패키지로 지원합니다. 현재 데스크톱 사용자 권한으로 실행되고 외부로 향하는 WSS 연결만 엽니다.

## Windows 포터블 UI(개발 중 · 배포하지 않음)

> Windows Worker는 아직 배포하지 않습니다. 훅 실행, Codex CLI 설치, 세션 진행
> 표시가 신뢰할 수 있게 동작하지 않습니다. 아래는 개발 참고용입니다.
> [Windows 지원 정책](windows-support-policy.md)을 보세요.

Claudex Workhouse 서버에서 포터블 폴더와 ZIP을 빌드합니다.

```sh
cd app
pnpm run worker:portable
```

결과물은 `packages/claudex-workhouse-worker-windows-portable.zip`입니다. 데스크톱에서 압축을 풀고 `Start Claudex Workhouse Worker.vbs`를 더블 클릭하세요. 페어링 명령을 입력할 필요가 없습니다. 로컬 설정 화면에서 다음 기능을 제공합니다.

- Claudex Workhouse URL 및 일회용 페어링 코드 입력
- Workspace Root의 네이티브 폴더 선택
- 연결 및 자동 시작 상태
- Provider/런타임 진단
- 연결 해제 및 로컬 설정

관리 화면은 임의의 `127.0.0.1` 포트에 바인딩되고, 메모리에만 있는 256비트 토큰을 요구하며, `no-store` 응답을 보냅니다. Worker 자격 증명은 노출하지 않으며 Worker 연결 자체도 계속 송신 전용입니다.

포터블 ZIP은 데스크톱에 Node.js 20 이상이 설치되어 있다고 가정합니다. 자체 포함 사내용 ZIP을 만들려면 패키징할 때 `CLAUDEX_WORKHOUSE_WINDOWS_NODE_EXE`가 신뢰할 수 있는 공식 Windows `node.exe`를 가리키게 하세요. 실행 파일은 런처 옆에 포함됩니다. 코드 서명은 별도의 릴리스 단계입니다.

## CLI 설치와 페어링(고급)

서버에서 패키지를 빌드합니다.

```sh
cd app
pnpm run worker:pack
```

생성된 아카이브를 데스크톱에 설치합니다. Workhouse에서 전역 설정 → 실행 호스트 → 새 데스크톱을 연 뒤 표시된 명령을 실행합니다.

```sh
claudex-workhouse-worker pair --url https://agent.example.com --code ABCD-EFGH-IJKL --name Desktop-PC
```

전역 npm 설치 후 `claudex-workhouse-worker-ui`를 실행하면 같은 무터미널 설정 화면이 열립니다.

Cloudflare Access가 `/worker/*`도 보호한다면 Worker 프로세스 환경에 전용 서비스 토큰 `CF_ACCESS_CLIENT_ID`와 `CF_ACCESS_CLIENT_SECRET`을 설정하세요. 이 헤더는 Edge 관문만 통과하며, Worker 신원은 계속 challenge 인증된 Worker 자격 증명으로 확인합니다.

## Root와 Provider 로그인

의도적으로 좁은 프로젝트 Root를 로컬에 추가하세요. 드라이브 루트나 홈 디렉터리 전체를 등록하지 마세요.

```sh
claudex-workhouse-worker roots add "D:\Projects" --name Projects
claudex-workhouse-worker roots list
```

디스크 삭제는 기본적으로 꺼져 있습니다. 로컬 운영자가 `--allow-delete`로 Root별로 명시적으로 허용해야 하며, 웹 UI에서도 이름을 다시 입력해야 합니다. 작업이 실행 중이거나 상태를 확인할 수 없으면 삭제를 거부합니다.

Worker를 실행하는 같은 OS 사용자로 공식 도구에 로그인합니다.

```sh
claude auth login
codex login
```

Claudex Workhouse는 공식 상태 출력과 App Server 계정 상태만 읽으며 자격 증명 파일을 읽거나 업로드하지 않습니다.

현재 Worker 패키지는 호스트별 인증 상태를 보고하지만, 로그인은 데스크톱의 공식 CLI에서 직접 시작합니다. NAS의 Provider 로그인 PTY/기기 코드 브리지는 원격 Worker로 일반화되지 않았으므로, 공개 패키지는 NAS 연결 버튼이 원격 호스트에 로그인해 준다고 안내해서는 안 됩니다.

## 실행 및 서비스 설치

포그라운드에서는 `claudex-workhouse-worker run`, 현재 사용자 자동 시작에는 `claudex-workhouse-worker install-service`를 사용합니다. Windows는 현재 사용자 로그온 작업, Linux는 `systemd --user`, macOS는 사용자 LaunchAgent를 사용합니다. Unix의 root 서비스 설치는 거부됩니다.

## 진단, 연결 해제, 제거

```sh
claudex-workhouse-worker status
claudex-workhouse-worker diagnose
claudex-workhouse-worker unpair
claudex-workhouse-worker uninstall-service
```

`unpair`는 프로젝트를 그대로 둡니다. Workhouse에서도 해당 호스트를 해지하세요. 완전히 제거하려면 서비스를 중지·제거하고, 호스트를 해지하고, 패키지를 제거한 뒤 Worker 소유 작업이 살아 있지 않음을 확인하고 `~/.claudex-workhouse-worker`를 삭제합니다.

복사용 진단 출력에서는 자격 증명, Provider 토큰, 이메일, 전체 환경 변수, URL 쿼리를 제외합니다. Root 경로는 표시 이름이나 basename으로 축약합니다.
