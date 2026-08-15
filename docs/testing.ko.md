# 테스트

[English](testing.en.md) · [한국어](testing.ko.md) · [日本語](testing.ja.md)

이전: [배포](deployment.ko.md) · [가이드북](guide.ko.md) · 다음: [알려진 제한 →](known-limitations.ko.md)

## 자동 테스트

```sh
cd $CLAUDEX_WORKHOUSE_ROOT/app
pnpm check
pnpm test
pnpm build
pnpm test:e2e:docker
```

`test:e2e:docker`는 이미 실행 중인 `http://127.0.0.1:3410` 서비스를 대상으로 버전이 고정된 Playwright 이미지에서 테스트하므로 DSM에 GTK/ATK 브라우저 라이브러리가 필요하지 않습니다. 일반 Playwright 인자는 `--` 뒤에 전달합니다(예: `pnpm test:e2e:docker -- --project=mobile-360`). 대상 변경은 `CLAUDEX_WORKHOUSE_E2E_BASE_URL`을 사용합니다.


Vitest는 정확한 Project allowlist와 path escape 거부, 출력 정제, cx JSON 성공/실패 계약, SQLite WAL/SHM, task persistence, idempotency claim을 다룹니다. Playwright는 360x800, 412x915, 800x1280 list/detail/modal/PWA flow와 가로 overflow를 확인합니다.

Streaming fixture는 Codex/Claude message delta, command output, file-change lifecycle, web search, terminal event, stop, server restart replay, `Last-Event-ID`, 잘못된 Origin/미인증 거부, task별 연결 제한, mobile delta batching, service-worker 제외를 검증합니다.

Screenshot은 `app/test-results`에 저장됩니다. Test 인증은 loopback test server에서 `CLAUDEX_WORKHOUSE_AUTH_MODE=test CLAUDEX_WORKHOUSE_TEST_MODE=1`일 때만 켭니다.

## 통합 결과

- Codex: 생성, pending 등록, list/detail, thread 지정 follow-up, noninteractive fork, targeted stop, browser/server disconnect 생존을 통과했습니다.
- Claude 소유 작업: 생성, session ID 포착, detail, resume, fork, process identity 검사 stop을 통과했습니다.
- Claude 외부 작업: list/detail은 통과했고 stop은 설계대로 거부했습니다.
- 같은 UUID 생성 요청은 cx job과 저장 응답을 각각 하나만 만들었습니다.
- Workhouse server restart 뒤에도 cx Worker가 살아 있고 복구 작업을 표시·중지할 수 있었습니다.
- Fastify child만 종료하면 server PID만 바뀌고 supervisor PID와 cx core check 14개는 유지되었습니다. 기존 dead-broker check 5개는 계속 실패합니다.

### Codex 전체 세션 fixture(2026-07-11)

- App-server metadata pagination으로 native `cli`/`vscode`를 포함한 비보관 thread 721개를 색인했습니다.
- 기존 Codex row는 검증된 `claudex-workhouse` 8개와 `external-cx` 5개로 migration되었습니다.
- Detached Worker create, restart survival, transcript turn paging, 외부 CLI/VS Code resume·fork를 통과했습니다.
- Parent archive/unarchive는 fork child에 영향을 주지 않았고 parent 삭제도 child를 지우지 않았습니다. 반복 삭제는 native not-found를 반환했습니다.
- 실행 중 Worker 삭제는 409, 검증된 Worker stop은 200, stop 후 삭제는 200이었습니다.
- Fixture에서 `gpt-5.4/high/priority`를 허용했고 미지원 Fast/effort/permission 조합은 거부했습니다. Runtime이 보고하지 않아 effective setting은 unknown이었습니다.
- 파괴적 fixture는 이름이나 첫 prompt의 `CLAUDEX_WORKHOUSE_FIXTURE_20260711`로 식별합니다.
- Claude regression fixture `dc1dfc2a-6dca-48cf-a75c-8b3c81fb2cb2`는 create/resume을 통과했고 fork `7082a5f9-a8f0-4840-a684-9b0df81a74cd`를 만들었으며 외부 stop은 HTTP 403이었습니다. Claude history-delete UI가 없어 해당 transcript는 남아 있습니다.

## 실패 조건 검사

미인증, 잘못된 Origin, mutation guard 누락, 알 수 없는 Project/task, 잘못된 ID, 빈/과대 prompt, 재사용 idempotency key, 외부 Claude stop, cx job JSON 누락, Access 설정 누락을 검증했습니다. 생성 timeout은 재시도하지 않으며 pending task는 실제 상태 또는 `unknown`으로 수렴합니다.
