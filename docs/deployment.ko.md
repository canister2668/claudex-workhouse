# 배포

[English](deployment.en.md) · [한국어](deployment.ko.md) · [日本語](deployment.ja.md)

이전: [보안](security.ko.md) · [가이드북](guide.ko.md) · 다음: [테스트 →](testing.ko.md)

## 빌드

```sh
cd $CLAUDEX_WORKHOUSE_ROOT/app
pnpm install
pnpm check && pnpm test && pnpm build
node $CLAUDEX_WORKHOUSE_ROOT/bin/claudex-workhouse.mjs restart
```

첫 `start` 때 Claude Code와 Codex 런타임이 없으면 공식 배포 endpoint에서 설치합니다. 기존 관리 바이너리는 건드리지 않습니다. 외부 provisioner가 두 런타임을 모두 관리할 때만 `CLAUDEX_WORKHOUSE_SKIP_RUNTIME_BOOTSTRAP=1`을 설정하거나, 실행 가능한 `CLAUDEX_WORKHOUSE_CLAUDE_BIN`과 `CLAUDEX_WORKHOUSE_CODEX_BIN` 경로를 명시하세요.

Production에서는 test 인증 환경 변수를 설정하지 마세요. Access 값이 구성되기 전 loopback 서비스는 fail closed로 동작합니다. `/api/health/live`는 작동하지만 보호 API는 setup-required를 반환합니다.

## NAS 재부팅 후 자동 시작

Cloudflare Tunnel은 `claudex-workhouse.example.com`을 `http://127.0.0.1:3410`으로 연결합니다. 재부팅 뒤 Workhouse를 시작하는 항목이 없으면 해당 loopback port에 listener가 없고 `cloudflared`가 connection-refused를 받아 외부 URL은 **HTTP 502 Bad Gateway**가 됩니다. 따라서 DSM boot task가 필요합니다.

### Boot wrapper

원시 manager가 아니라 wrapper로 시작합니다.

```text
$CLAUDEX_WORKHOUSE_ROOT/bin/boot-start.sh
```

Wrapper는 sudo/chmod/chown/synoacltool 없이 전용 DSM service account로 실행되며 다음을 수행합니다.

- `HOME=$HOME`, `PATH=/usr/local/bin:/usr/bin:/bin` 설정
- `$CLAUDEX_WORKHOUSE_ROOT`가 mount되고 쓰기 가능할 때까지 기본 120초 동안 3초 간격으로 대기
- `/api/health/live`가 이미 200이면 두 번째 supervisor를 만들지 않고 0으로 종료
- stale PID를 정리하고 중복 supervisor를 만들지 않는 `claudex-workhouse.mjs start`에 시작 위임
- 시작 후 기본 60초 동안 `/api/health/live` 200 대기
- Workhouse만 시작하고 `cx` broker/worker나 Claude session에는 신호를 보내지 않음
- `logs/claudex-workhouse-boot.log`에 기록(supervisor와 같은 10 MiB × 4 회전)

종료 코드는 `0` 정상, `10` volume 준비 실패, `11` manager start 실패, `12` 시작 후 health 200 도달 실패입니다.

### DSM 작업 스케줄러(관리자 수동 설정)

`esynoscheduler.db`는 root 소유이므로 이 단계만 DSM UI에서 직접 해야 합니다. DSM 내부 scheduler 파일을 편집하거나 root task를 만들지 마세요.

제어판 > 작업 스케줄러 > **생성 > 트리거된 작업 > 사용자 정의 스크립트**:

- 작업 이름: `Claudex Workhouse Startup`
- 사용자: 애플리케이션 파일을 소유한 전용 DSM service account
- 이벤트: `Boot-up`
- 실행 명령: `$CLAUDEX_WORKHOUSE_ROOT/bin/boot-start.sh`

Wrapper를 쓰지 않는 fallback은 volume 대기와 health gate가 없습니다.

```text
/usr/local/bin/node $CLAUDEX_WORKHOUSE_ROOT/bin/claudex-workhouse.mjs start
```

생성 후 작업을 선택해 한 번 **실행**하고 확인합니다.

```sh
node $CLAUDEX_WORKHOUSE_ROOT/bin/claudex-workhouse.mjs status      # running supervisor=… bind=127.0.0.1:3410
curl -sS http://127.0.0.1:3410/api/health/live                    # {"ok":true,"status":"live"}
```

자동 시작을 제거하려면 작업 스케줄러에서 `Claudex Workhouse Startup`을 삭제합니다.

## Log와 health

```sh
node $CLAUDEX_WORKHOUSE_ROOT/bin/claudex-workhouse.mjs status
node $CLAUDEX_WORKHOUSE_ROOT/bin/claudex-workhouse.mjs logs
curl -sS http://127.0.0.1:3410/api/health/live
```

보호된 전체 `/api/health`는 SQLite, Codex, Claude, Access 설정 여부도 확인합니다.

## 업데이트

변경한 source/config를 먼저 backup하고 build를 끝낸 다음 Workhouse만 restart합니다. Web process 실패 시 자동으로 다시 시작됩니다. 정상 restart/stop은 `cx`나 Claude Worker process group을 대상으로 하지 않습니다.

### Claudex Workhouse 본체 업데이트

전역 설정 > 시스템의 **Claudex Workhouse 업데이트**는 Provider 런타임
업데이트와 분리되어 있습니다. owner가 확인한 signed stable release만 적용할
수 있습니다. 활성 task, collaboration, maintenance가 있으면 차단하고 payload를
바꾸기 전에 검증된 SQLite/config snapshot을 만듭니다.

Docker/NAS 설치본은 앱 컨테이너에 Docker socket을 연결하지 않고 host-side
updater를 사용합니다. Windows portable 설치본은 별도 process updater를 쓰고
rollback을 위해 직전 payload를 보존합니다. 현재 Windows launcher에는
Authenticode 서명이 없으며 신뢰 근거는 signed release manifest, 정확한
SHA-256, GitHub artifact attestation, 공개된 Defender 결과입니다. Source
checkout은 자동 업데이트하지 않습니다.

[릴리스 검증](release/verification.md)과 [키 교체](release/key-rotation.md)를
참고하세요.

### 관리형 Claude Code 런타임

Workhouse는 `runtime/claude-bin/claude`를 실행하며 VS Code extension directory를 검색하지 않습니다. 공식 Anthropic release manifest wrapper로 관리합니다.

```sh
node $CLAUDEX_WORKHOUSE_ROOT/bin/claude-runtime.mjs status
node $CLAUDEX_WORKHOUSE_ROOT/bin/claude-runtime.mjs check latest
node $CLAUDEX_WORKHOUSE_ROOT/bin/claude-runtime.mjs update latest
```

`update`는 `downloads.claude.ai`에서만 내려받고 manifest version, artifact size, SHA-256, 실행 파일 version을 확인한 뒤 원자적으로 교체합니다. 이전 실행 파일은 `backups/claude-runtime`에 최신 4개를 보존합니다. 관리 Worker의 Claude 내부 auto-updater는 꺼서 이 검사와 backup을 우회하지 못하게 합니다. 활성 Claude task가 시작 중이지 않을 때 런타임 업데이트 후 Workhouse를 restart하세요.

### 관리형 Codex 런타임과 UI 업데이트

Workhouse는 root 소유 npm fallback `/usr/local/bin/codex`와 독립된 공식 standalone을 사용합니다. Windows와 Linux/NAS 모두 `runtime/codex-home/packages/standalone/releases/<version>-<target>/bin/codex[.exe]`의 실제 일반 파일을 실행하며 `current` 또는 visible-bin symlink/junction을 실행 경로로 사용하지 않습니다. 활성 버전은 해시가 기록된 `runtime/codex-runtime.json`이 가리킵니다. 따라서 배포 런타임이 DSM 사용자 홈의 package cache에 의존하지 않습니다. Codex 인증과 native session history는 Provider의 정상 사용자 홈에 남으며 Workhouse 배포 파일이 아닌 사용자 identity/state입니다.

Avatar 상태는 관리 Claude/Codex Worker의 Provider stream event로 구동됩니다. 배포 과정은 `~/.claude/settings.json`, `~/.codex/hooks.json`, Project 설정에 lifecycle hook이나 Workhouse 경로를 추가하지 않습니다.

전역 설정 > 런타임에는 두 Provider의 **업데이트 확인**이 있고 업데이트가 있으면 **업데이트** 버튼을 표시합니다. Codex는 모든 지원 OS에서 OpenAI 공식 release metadata와 `codex-package_SHA256SUMS`를 각각 검증하고 두 digest가 일치하는 package만 버전 디렉터리에 푼 뒤 상태 파일을 원자적으로 전환합니다. Claude는 `bin/claude-runtime.mjs`를 사용합니다. 요청은 same-origin 보호, rate limit, Provider별 직렬화, audit log가 적용됩니다. 기존 Worker에는 신호를 보내지 않고 새 Codex app-server부터 업데이트된 바이너리를 사용합니다.

사용량 popover는 격리된 safe-mode pseudo-terminal에서 Claude Code 공식 `/usage`를 요청합니다. Workhouse는 Claude credential 파일이나 문서화되지 않은 Anthropic consumer OAuth endpoint를 읽거나 호출하지 않습니다. Probe는 Python 3 표준 라이브러리만 사용하고 파싱된 plan percentage와 reset label만 반환하며 terminal/account text는 폐기합니다.
