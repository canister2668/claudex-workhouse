# Windows 설치

[설치 시작](index.md) · [Windows Worker](windows-worker.md) · [Docker 상세](../docker.ko.md)

> **개발 중 · 배포하지 않음.** 아래 절차는 개발 참고용으로만 남겨 둡니다.
> Windows 대상은 포터블 서버, 네이티브 Worker, Docker Desktop + Worker 구성까지
> 모두 아직 배포하지 않습니다. 남은 과제는
> [Windows 지원 정책](../windows-support-policy.md)에 정리되어 있습니다.
>
> Windows에서 지금 쓰려면 **Linux 호스트나 NAS에 메인 서버를 설치하고 브라우저로
> 접속**하세요 — [설치 시작](index.md). PWA가 지원되는 Windows 사용 방식입니다.
>
> **공개 릴리스에는 Windows 자산이 하나도 들어 있지 않습니다.** 아래에서 말하는
> EXE·포터블 ZIP·Windows Worker ZIP은 릴리스에서 내려받을 수 없고, 직접 소스에서
> 빌드해야 합니다(`windows-test-build` workflow를 수동 실행).

## 지원 위치

메인 서버는 **Linux 또는 Linux 기반 NAS의 Docker로 설치**합니다. 아래 Windows
절차는 아직 검증되지 않았습니다. 포터블 서버는 페이로드 검증 단계에서 실패해
기동을 완료하지 못하고, 네이티브 Worker는 훅 실행·Codex CLI 설치·세션 진행
표시가 신뢰할 수 있게 동작하지 않습니다.

## Windows 대안: 포터블 ZIP

1. 공개 릴리스에서 `claudex-workhouse-server-windows-x64-portable.zip`을 받습니다.
2. SHA-256 값이 릴리스의 `SHA256SUMS`와 같은지 확인합니다.
3. ZIP을 일반 로컬 폴더에 풀고 `Claudex Workhouse.exe`를 실행합니다. 서명되지 않은 베타라면 SmartScreen에 게시자 경고가 표시될 수 있습니다. Windows 보안 기능을 끄지 마세요.
4. 설치 화면·설치 위치 선택·설치 버튼은 나오지 않습니다. 런처는 EXE 옆의 payload를 검증하고 바로 서버를 시작한 뒤 상태 화면을 보여 줍니다. 상태 화면에서 **Workhouse 열기**를 누릅니다.
5. 열린 로컬 페이지에서 코드 인증과 관리자 등록을 완료합니다.
6. 최초 설정 화면이 Claude Code와 Codex를 자동 탐색합니다. `미설치`이면 해당 **설치** 버튼을 누릅니다.
7. `로그인 필요`이면 **공식 로그인 열기**를 누르고 브라우저 로그인 절차를 완료합니다.
8. 작업 폴더를 등록하고 읽기 전용 첫 테스트가 성공하면 설정이 끝납니다.

정상 흐름은 다음 한 줄입니다.

```text
ZIP 압축 해제 → Claudex Workhouse.exe → 즉시 시작·상태 화면 → 브라우저 설정(코드 인증) → Provider 설치 → 공식 로그인 → 작업 폴더 → 첫 테스트 성공
```

포터블 ZIP은 설치하지 않습니다. 프로그램 파일은 압축을 푼 폴더에만 있고, 시작
메뉴·바탕화면 바로가기, Windows `설치된 앱` 등록, 설치 위치 레지스트리 항목을
만들지 않습니다. 폴더를 지우면 프로그램이 사라지고, 폴더를 통째로 옮기거나 USB에
담아 다른 PC에서 실행할 수 있습니다. 설정·자격 증명·로그·DB 같은 사용자 데이터만
`%LOCALAPPDATA%\Claudex Workhouse`에 저장됩니다.

설치형이 필요하면 단일 EXE(`claudex-workhouse-server-windows-x64.exe`)를 사용하세요.
단일 EXE만 설치 마법사와 설치 위치 선택, 바로가기·제거 등록을 제공합니다.

Provider 설치본과 로그인 정보는 현재 Windows 사용자 영역에만 보관됩니다. Workhouse는 로그인 비밀번호나 OAuth 토큰을 화면, 로그 또는 DB에 복사하지 않습니다.

## 업데이트와 제거

업데이트 전 현재 포터블 폴더와 사용자 데이터의 백업·복구 경로를 확인하세요. 프로그램 파일과 사용자 데이터는 별개이며 작업 폴더 자체를 삭제하면 안 됩니다. 포터블 폴더를 지우는 것이 제거이며, 사용자 데이터는 `%LOCALAPPDATA%\Claudex Workhouse`에 남습니다.

## 고급·대체 설치

- **Linux/NAS Docker**: 가능하면 이 권장 경로를 사용합니다. [설치 시작](index.md)을 참고하세요.
- **Docker Desktop + Windows Worker**: Windows 안에서 서버와 실행 환경을 분리하는 대안입니다. [Windows Worker](windows-worker.md)를 참고하세요.
- **Node 직접 설치**: 개발·디버깅용이며 초보자 기본 경로가 아닙니다.

이전: [설치 시작](index.md) · 다음: [로컬 네트워크](local-network.md)
