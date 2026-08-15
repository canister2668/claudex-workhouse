# 보안

[English](security.en.md) · [한국어](security.ko.md) · [日本語](security.ja.md)

이전: [Provider 인증](provider-authentication.ko.md) · [가이드북](guide.ko.md) · 다음: [배포와 운영 →](deployment.ko.md)

## 경계

- 서버는 `127.0.0.1:3410`에만 바인딩되며 NAS 인터페이스나 외부 포트를 열지 않습니다.
- 고정된 `projectId`만 받습니다. 경로는 서버에서 해석하고 시작 시점과 작업 생성 직전에 정확한 `realpath`인지 확인합니다.
- Provider 명령은 `spawn(binary, args, { shell: false })`를 사용합니다. Workspace 파일 API는 기존 realpath, symlink, 크기, Git metadata 검사를 유지하지만 파일명이 민감해 보인다는 이유만으로 거부하지 않습니다.
- 요청 본문은 64 KiB, prompt는 20,000자로 제한하며 명령 시간과 출력에도 상한이 있습니다.
- 변경 요청에는 same Origin, 존재할 경우 `Sec-Fetch-Site`, `X-Claudex-Workhouse-Request: 1`, UUID 멱등성 키가 필요합니다.
- 일반 요청은 분당 120회, 작업 생성은 분당 6회로 제한합니다.
- CSP, `frame-ancestors 'none'`, nosniff, no-referrer, permissions policy, API `no-store`를 적용합니다.
- Service Worker는 앱 shell만 cache하며 `/api` 내용, 작업 log, token, 결과는 cache하지 않습니다.
- SSE는 정상 Access 신원, 정확한 허용 Origin, 활성 Project의 소유 작업, 연결 제한(전체 8개·작업당 3개)을 요구합니다. 응답은 `no-store`이고 proxy buffering을 끄며 app-server socket을 노출하지 않습니다.
- Stream spool은 기록 전에 정제하고 `data/stream-events`(`0700`) 아래 `0600`으로 저장하며 8 MiB에서 회전하고 24시간 보존합니다. Authorization header, OAuth token, API key, password, private key, JWT, 환경 변수 대입과 같은 구조화된 secret은 `[REDACTED]`로 바꿉니다.
- Task 결과·오류·log와 자동 진단 metadata는 SQLite 저장 전에 정제합니다. Worker 상태 파일, audit 상세, HTTP 오류, task/runtime/collaboration SSE, Desktop Worker relay도 같은 정제기를 사용하며 실패 시 원본 대신 해당 값을 생략합니다.
- Fastify log는 Access JWT, cookie, authorization header를 가리고 handler 오류를 정제합니다. 인증 URL과 일회용 로그인 코드는 인증된 전용 login event에만 두고 일반 task event나 audit로 복사하지 않습니다.
- Agent event metadata는 JSON object여야 하며 정제 후 8 KiB로 제한합니다. Secret-like key/value, bearer/JWT, 환경 변수 대입, private-key block은 브라우저 전달 전에 가립니다. 정상 hash, UUID, task/thread ID, 경로 등은 보존합니다.
- 자동 handoff patch는 알려진 secret-like 파일명의 변경을 제외하며 handoff 전체를 실패시키지 않습니다. Manifest에는 제외 개수만 기록합니다. 사용자가 직접 열고 편집하거나 내려받는 파일은 차단·가림 처리하지 않습니다.
- 인증된 설정에서 지원 Provider용 외부 HTTP MCP 주소를 등록할 수 있습니다. 원격 주소는 HTTPS만 허용하고 HTTP는 localhost에서만 받으며, 각 항목은 허용된 읽기 전용 역할에 배정되고 운영자가 타사 도구의 읽기 전용 성격을 확인해야 합니다. Workhouse는 타사 서버 코드를 설치·검사하지 않으며 서버가 쓰기 가능 도구를 잘못 표시하는 일을 기술적으로 막을 수 없습니다. Bearer token은 비밀값으로 저장하고 설정 화면에 다시 불러오지 않습니다. Grok에는 이 설정을 전달하지 않습니다.
- 내장 Emotion MCP는 loopback peer만 허용하고 Cloudflare proxy 요청은 거부합니다. 이미지는 변경 불가능한 same-origin bundle이며 쓰기 상태는 `data/emotion`에 둡니다.
- Codex model, effort, service tier, permission profile은 Worker 시작 직전에 현재 app-server catalog로 다시 검증합니다. `:danger-full-access`는 브라우저의 명시적 확인도 필요하며 전역 Codex 설정은 다시 쓰지 않습니다.
- Codex 중지는 기록된 PID, PGID, 시작 시각, Worker marker, command 일치 또는 연결된 cx job이 필요합니다. 외부 CLI/VS Code thread는 저장된 turn이 active처럼 보여도 중지 control을 받지 않습니다.
- 영구 삭제는 중지·보관과 별개입니다. UUID 멱등성 키, 별도 경고와 명시적 동의, 활성 Worker 없음, transcript를 제외한 audit record가 필요하며 파일이나 Git history를 되돌리지 않습니다.

## 인증

Production mode는 Access team JWKS, 정확한 issuer, Application AUD, 정확한 이메일 `admin@example.com`으로 `Cf-Access-Jwt-Assertion`을 검증합니다. Team Domain/AUD가 없으면 HTTP 503으로 fail closed하며 브라우저가 보낸 email header는 신뢰하지 않습니다.

Test 인증은 `authMode=test`, `CLAUDEX_WORKHOUSE_TEST_MODE=1`, loopback peer, 정확한 test identity header가 모두 있어야 합니다. DSM 시작 작업에서 test mode를 사용하지 마세요.

## 개인 사용자 Provider 자격 증명 범위

Claudex Workhouse는 개인용 셀프 호스팅 환경을 대상으로 합니다. Claude Code, Codex, GitHub CLI, Git credential helper, OS credential store는 web identity가 아니라 호스트 단위입니다. Provider 프로세스는 실행 호스트 OS 사용자의 로그인 상태를 사용합니다. Cloudflare Access와 Workhouse browser session은 Workhouse 접근만 인증하며 Provider 계정을 인증하지 않습니다.

소유자가 로컬 Provider 설정·인증 파일, `.env`, Git 자격 증명, SSH 파일을 직접 열거나 수정하는 것을 막지 않으며 Provider CLI의 `HOME`, `.claude`, `.codex` 접근도 그대로입니다. 서로 신뢰하지 않는 사용자에게 한 설치를 공유하지 마세요. 실행 호스트의 Provider 신원과 파일시스템 권한을 함께 쓰게 됩니다.

Redaction은 Provider 출력, 오류, log, persistence, event, 진단, 자동 handoff에 자동 복사되는 값을 보호합니다. 사용자가 명시적으로 연 파일 내용에는 의도적으로 적용하지 않습니다.

## Claude 중지 안전성

소유 작업만 중지할 수 있습니다. 신호를 보내기 전에 PID, 시작 시각, process group, Worker command, 임의 command marker를 비교합니다. 해당 process group에 TERM을 보내고 5초 기다린 뒤 같은 신원이 남아 있을 때만 KILL을 보냅니다.

## ACL

독립 DSM shared folder는 `admin`, 전용 service account, `administrators`에만 명시적 full-access ACE를 부여하며 `everyone` ACE는 없습니다. 하위 파일은 이 ACE만 상속합니다. Synology ACL에서는 POSIX mode가 `777`로 보여도 권한의 기준이 아닙니다. `storage-and-permissions.md`를 참고하세요.
