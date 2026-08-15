# Node 설치 (npm)

[설치 시작](index.md) · [일반 Linux](linux.md) · [Docker 상세](../docker.ko.md)

Docker 없이 호스트의 Node.js로 메인 서버를 직접 실행하는 방법입니다. 개발자가
이 저장소를 운영하는 방식과 같은 구성이며, Docker Engine을 설치할 수 없거나
설치하고 싶지 않은 호스트에 적합합니다.

## 준비 사항

- Linux x64·arm64
- **Node.js 20 이상**
- **Python 3** — SQLite 워커가 사용합니다. 대부분의 배포판에 이미 있습니다.
  `python3`를 PATH에서 찾으며, `PYTHON_BIN`으로 직접 지정할 수 있습니다.
- 기본 포트 3410 또는 사용하지 않는 다른 TCP 포트
- 데이터 디렉터리를 쓸 수 있는 사용자 권한

Windows는 지원하지 않습니다. 패키지가 `os` 필드로 설치를 거부합니다.
[Windows 지원 정책](../windows-support-policy.md)을 보세요.

## 설치

```sh
npm install -g claudex-workhouse
```

`better-sqlite3`는 선택적 의존성입니다. Linux에서는 사용하지 않으므로
네이티브 빌드가 실패해도 설치는 계속 진행되며 서버 동작에 영향이 없습니다.

## 실행

```sh
claudex-workhouse start
claudex-workhouse status
claudex-workhouse logs
```

`start`가 출력하는 주소를 브라우저에서 열고 owner claim을 완료합니다. 중지와
재시작은 다음과 같습니다.

```sh
claudex-workhouse restart
claudex-workhouse stop
```

## 데이터 위치

기본값은 설치 디렉터리 기준이며, 다음 환경 변수로 옮길 수 있습니다.

| 변수 | 뜻 |
| --- | --- |
| `CLAUDEX_WORKHOUSE_DATA_ROOT` | 데이터베이스·설정·로그·런타임 디렉터리 |
| `CLAUDEX_WORKHOUSE_APP_ROOT` | 서버 코드 위치 (보통 바꾸지 않습니다) |
| `PYTHON_BIN` | SQLite 워커가 쓸 Python 인터프리터 |
| `CLAUDEX_WORKHOUSE_CLAUDE_BIN` | 외부에서 관리하는 Claude Code 실행 파일 |
| `CLAUDEX_WORKHOUSE_CODEX_BIN` | 외부에서 관리하는 Codex 실행 파일 |

Claude는 PATH에서도 찾지만 **Codex는 찾지 않습니다.** 관리 런타임이 없으면
`/usr/local/bin/codex`만 확인합니다. 전역 npm 설치본이 관리 런타임을 조용히
대체하는 것을 막기 위한 의도된 동작이므로, Codex를 다른 경로에 설치했다면
`CLAUDEX_WORKHOUSE_CODEX_BIN`으로 명시하세요.

## owner claim을 브라우저로 못 할 때

첫 실행 owner claim은 브라우저에서 진행합니다. 헤드리스 호스트 등으로 그
경로를 못 쓸 때만 루프백 복구 CLI를 사용합니다. **데이터 경로를 기본값이
아닌 곳에 두었다면 `CLAUDEX_WORKHOUSE_ROOT`로 알려줘야 합니다** — 이 CLI는
서버 설정을 읽지 않고 그 변수만 봅니다.

```sh
CLAUDEX_WORKHOUSE_ROOT="$CLAUDEX_WORKHOUSE_DATA_ROOT" \
  node "$(npm root -g)/claudex-workhouse/app/dist-server/bootstrap/owner-recovery-cli.js" \
  --url http://127.0.0.1:3410
```

전역 설치는 npm 업데이트 시 디렉터리가 교체될 수 있으므로, 데이터 경로는
설치 디렉터리 바깥으로 지정하는 것을 권장합니다.

```sh
export CLAUDEX_WORKHOUSE_DATA_ROOT="$HOME/.local/share/claudex-workhouse"
claudex-workhouse start
```

## Provider CLI

Provider CLI(Claude Code, Codex 등)는 이 패키지에 포함되지 않습니다. 서버를 실행하는
사용자 계정에서 공식 방법으로 설치하고 로그인하세요. 자격 증명은 각 CLI의 공식
상태 디렉터리에 남고 Workhouse가 따로 보관하지 않습니다.

## 자동 시작

`systemd --user` 등록은 [배포와 NAS 자동 시작](../deployment.ko.md)을 따르되,
`ExecStart`를 전역 설치된 `claudex-workhouse start`로 지정합니다.

## 업데이트

```sh
npm update -g claudex-workhouse
claudex-workhouse restart
```

## 무결성 확인

공개 릴리스에는 tarball과 함께 `.sha256` 사이드카가 올라갑니다. 설치 전에
직접 대조할 수 있습니다.

```sh
npm pack claudex-workhouse --dry-run
sha256sum claudex-workhouse-<version>.tgz
```

tarball은 공개 트리에서만 만들어지며, 반입 목록에 있는 파일만 담기고 페이로드
검사를 통과해야 생성됩니다. 소스 맵과 개발용 파일은 포함되지 않습니다.
