# 다중 제공자 검토·인계·백그라운드 요청 통합 계획

상태: 코드 구현·검증·운영 재시작 완료 · 전 제공자 종단간 회귀 행렬은 미실행

작성일: 2026-08-06

대상: Claudex Workhouse의 작업 상세 `검토 요청`, `작업 인계`, 명시적 관리형 백그라운드 요청

현재 구현 메모:

- 다섯 회사 탭과 전역 활성 모델 선택기를 검토 요청·인계 UI에 연결했다.
- Assist, Handoff, 관리 MCP가 명시한 모델·추론 수준·서비스 티어를 보존한다.
- 로컬 다섯 제공자를 대상과 관리형 호출 주체로 연결했고, 같은 제공자의 새 독립 세션도 허용한다.
- 호스트 capability에 없는 제공자는 실행 전 비활성화하고 서버에서도 재검증한다.
- delegation 설정을 version 3으로 올리고 다섯 제공자의 관리형 기본 모델·추론 설정을 보존한다.
- consumer Antigravity와 Vertex API 모두 task-scoped 관리 도구를 받을 수 있다. Vertex는 함수 선언 → 관리 MCP 호출 → 함수 응답 → 최종 응답 루프를 사용한다.
- 대화 전용 프로필에는 관리 토큰과 관리 도구를 노출하지 않는다.
- 기본 전체 단위·통합 1,360개, 관련 집중 테스트 120개, 타입/Svelte 검사, 프로덕션 빌드와 SQLite worker 계약은 통과했다.
- Node SQLite 전용 테스트는 현재 설치에 `better-sqlite3` 네이티브 바인딩이 없어 실행 전제 단계에서 실패했다. 기본 Python SQLite 경로와 빌드 시 worker 계약 검사는 통과했다.
- 최신 프로덕션 번들의 모바일 E2E에서 DeepSeek 검토 선택·선택 기억·Google/Gemini 인계 선택·모달 가로 넘침 검증까지 통과했다. 동일 장기 스펙의 후속 기존 브랜드 위치 검사는 별도로 실패하여 전체 스펙 통과로 표시하지 않는다.
- 운영 Workhouse를 최신 번들로 재시작했고 supervisor/server PID 교체, `/api/health/live` 200, 장기 서버 환경의 task-scoped 관리 인증정보 제거를 확인했다.
- 실제 Vertex, DeepSeek, Ollama 작업에서 스트리밍 델타와 완료 결과를 확인했다. 다섯 제공자의 모든 검토·인계 조합을 포괄하는 종단간 회귀 행렬은 아직 실행하지 않았다.

## 1. 목표

작업 상세에서 `검토 요청` 또는 `작업 인계`를 누르면 대상이 즉시 고정되지 않고 공통 대상 선택 UI를 연다. 사용자는 제공자별 탭에서 모델과 지원되는 실행 옵션을 선택한다.

지원 대상은 다음 다섯 제공자다.

| 탭 | 내부 제공자 ID | 모델 원천 |
|---|---|---|
| OpenAI | `codex` | Codex 모델 카탈로그와 전역 활성 모델 |
| Anthropic | `claude` | Claude 모델 카탈로그와 전역 활성 모델 |
| DeepSeek | `deepseek` | DeepSeek 백엔드 카탈로그와 전역 활성 모델 |
| Ollama | `ollama` | Ollama 백엔드 카탈로그와 전역 활성 모델 |
| Google | `antigravity` | Antigravity 또는 Vertex 카탈로그와 전역 활성 모델 |

같은 선택 구조를 관리형 백그라운드 요청에도 적용한다. 최종 목표는 모든 지원 제공자가 다른 제공자의 새 관리 작업을 생성하고 `create/get/wait/resume`으로 추적할 수 있게 하는 것이다.

## 2. 설계 검토 방식

이 계획은 두 검토를 합친 결과다.

- Codex가 현재 UI, API, 오케스트레이터, 제공자 워커와 테스트를 직접 추적했다.
- Claude Code에 별도 관리형 백그라운드 작업을 생성하여 읽기 전용 독립 검토를 요청했다.
  - 작업 ID: `claude:368ed250-cd50-4847-9079-5389893317ef`
  - 스레드 ID: `9864e4e6-f6fb-4bfb-a1f4-a4da9f37b2bf`
  - 협업 ID: `4a6e5a4a-f0f9-4a5e-90b7-b4dd650291a1`
  - 최종 상태: `completed`

Claude Code는 파일을 수정하지 않았으며, 이 문서는 양쪽 검토를 현재 코드와 대조해 정리한 구현 계획이다.

## 3. 구현 전 상태와 해결 범위

### 3.1 검토 요청

- `App.svelte`와 `CodexSessions.svelte`에 버튼과 모달 구현이 중복되어 있다.
- 대상 제공자는 `Codex → Claude`, 그 외 → `Codex`로 고정되어 있다.
- 모달에서는 요청 문장만 편집할 수 있고 제공자·모델·추론 수준을 선택할 수 없다.
- `POST /api/tasks/:provider/:taskId/assist`는 대상 제공자 필드를 받지만 모델·추론·서비스 티어를 받지 않는다.
- `createAssist()`는 원본과 대상 모두 Codex 또는 Claude일 때만 허용한다.
- 검토 결과는 별도 Assist 세션에 남으며 사용자가 명시적으로 전달하기 전에는 원 세션에 자동 반영되지 않는다.

### 3.2 작업 인계

- `HandoffDialog.svelte`는 대상 호스트, 작업공간, 제공자, 인계 종류, 문서 검증과 실행의 3단계 흐름을 이미 제공한다.
- 서버의 `targetProvider` 스키마는 다섯 제공자를 받지만 UI는 Codex와 Claude 버튼만 표시한다.
- 모델·추론 수준은 인계 아티팩트에 저장되지 않고 새 작업 생성에도 전달되지 않는다.
- `review` 인계는 읽기 전용이고, `continue` 인계는 원본 권한과 작업공간 lease 정책을 따른다.

### 3.3 관리형 백그라운드 요청

- 현재 관리 MCP와 Assist는 Codex와 Claude만 허용한다.
- 인증 토큰과 관리 MCP 환경은 Codex 및 Claude 작업에만 주입된다.
- DeepSeek와 Ollama는 `claude-worker`를 공유하지만 관리 MCP 환경은 받지 않는다.
- Antigravity와 Vertex는 별도 워커를 사용하며 관리 도구 호출 연결이 없다.
- DeepSeek, Ollama, Antigravity 작업은 현재 로컬 Workhouse 호스트에서만 생성할 수 있다.

### 3.4 재사용할 기존 자산

- `SessionSettingsFields.svelte`: 다섯 제공자의 모델·추론·Codex 서비스 티어 UI를 이미 표현한다.
- `/api/system-settings/models`: 전역 활성 모델과 제공자별 카탈로그를 제공한다.
- 협업 참가자의 `capabilitySnapshot`: 모델, 추론 수준, 서비스 티어와 자동화 수준을 보존한다.
- `provider-transport.ts`: 참가자 설정을 실제 로컬 또는 원격 작업 생성으로 전달한다.
- 기존 대화 생성 화면: 다섯 제공자 선택과 모델 설정의 선례가 있다.
- 기존 Handoff 3단계 문서·검증 흐름과 workspace lease 정책은 유지한다.

## 4. 제품 결정

### 4.1 공통 대상 선택기

새 공통 컴포넌트 `ProviderExecutionPicker.svelte`를 만든다.

입력:

- 원본 작업 제공자, 작업공간과 실행 호스트
- 관계 종류: `assist-review`, `handoff-continue`, `handoff-review`, `handoff-review-return`, `managed-background`
- 제공자별 모델 카탈로그와 전역 활성 모델
- 호스트별 제공자 실행 가능 여부

출력:

```ts
type TargetExecutionSelection = {
  provider: ProviderId;
  model: string | null;
  reasoningEffort: string | null;
  serviceTier: "priority" | null;
};
```

UI 구성:

1. 회사·제공자별 탭
2. 선택한 탭의 모델 목록
3. 해당 모델이 지원하는 추론 수준
4. Codex에서만 서비스 티어
5. 연결 상태, 모델 없음, 로컬 전용, 원격 호스트 미지원 등의 비활성 사유
6. 실행 관계에서 서버가 결정한 권한을 설명하는 읽기 전용 요약

권한 선택기는 넣지 않는다. 제공자·모델 선택과 권한 정책을 분리하여 이중 진실을 만들지 않는다.

### 4.2 검토와 인계의 권한

| 관계 | 권한 상한 | 결과/연결 정책 |
|---|---|---|
| `assist-review` | 항상 읽기 전용 | 별도 Assist 결과, 자동 원본 전달 금지 |
| `handoff-review` | 항상 읽기 전용 | Handoff 문서와 read lease |
| `handoff-review-return` | 항상 읽기 전용 | 검토 후 반환 관계 기록 |
| `handoff-continue` | 원본 작업의 유효 자동화·권한 상속 | 새 세션과 write lease 정책 유지 |
| `managed-background` | 원본 작업의 유효 자동화·권한 상속 | 별도 추적 작업과 동일 스레드 후속 요청 |

모델 선택이 권한을 높이지 못하게 서버에서 관계별 상한을 강제한다. 유료 크레딧 확인과 전체 자동화 위험 확인도 기존 서버 검증을 우회하지 않는다.

### 4.3 같은 제공자 선택

새 대상은 반드시 새 작업·새 세션이어야 하지만 제공자는 원본과 같아도 허용한다. 이를 통해 예를 들어 Codex 모델 A의 결과를 Codex 모델 B가 검토하거나 같은 제공자의 다른 모델로 인계할 수 있다.

단, 같은 `provider + model` 조합을 선택하면 UI에서 독립성 경고를 표시한다. 검토 요청에서는 다른 제공자 또는 다른 모델을 기본 추천한다.

### 4.4 선택값 우선순위

실행 설정은 다음 순서로 결정한다.

1. 버튼 UI 또는 관리 도구 요청에 포함된 명시적 선택
2. 해당 기능에서 마지막으로 사용한 유효 선택
3. 관리 위임 기본값
4. 전역 활성 모델의 기본값

실행 시점에 카탈로그와 호스트 능력을 다시 검사한다. 저장된 모델이 비활성화되었거나 백엔드에서 사라지면 임의 대체하지 않고 재선택을 요구한다.

## 5. 데이터와 API 계약

### 5.1 공통 실행 선택 타입

서버에 `TargetExecutionSelection`과 정규화·검증 함수를 추가한다. 모든 진입점이 같은 함수로 다음을 검사한다.

- 제공자와 모델의 전역 활성 상태
- 모델별 추론 수준과 서비스 티어
- 선택 호스트의 제공자 지원 여부
- 관계별 자동화·권한 상한
- 연결·API 키·런타임 준비 상태
- 필요한 유료 크레딧 동의

### 5.2 Assist API

`POST /api/tasks/:provider/:taskId/assist` body에 다음을 추가한다.

```json
{
  "targetProvider": "deepseek",
  "model": "deepseek-v4-pro",
  "reasoningEffort": "high",
  "serviceTier": null
}
```

`CreateAssistInput`과 대상 참가자의 `capabilitySnapshot`에 같은 값을 저장한다. `createAssist()`의 두 제공자 제한과 `currentTurnCounts` 하드코딩을 제거한다.

### 5.3 Handoff API와 DB

인계 초안은 생성과 실행 사이에 서버 재시작이 가능하므로 선택값을 DB에 영속화해야 한다.

- `handoff_artifacts.target_execution_json` TEXT 컬럼 추가
- 아티팩트 manifest에도 사람이 읽을 수 있는 실행 선택 요약 추가
- 로컬 및 원격 `provider.task.start`에 모델·추론·서비스 티어 전달
- 실행·재시도 시 저장된 선택값을 다시 검증
- `session_links`에는 실제 생성된 대상 작업의 제공자와 세션을 기존 방식으로 기록

여러 제공자별 컬럼 대신 버전이 포함된 JSON 하나를 사용한다.

### 5.4 관리형 MCP

`managed_provider_task_create`에 선택 필드를 선택적으로 추가한다.

```ts
{
  provider: ProviderId;
  model?: string;
  reasoningEffort?: string;
  serviceTier?: "priority";
  prompt: string;
  title?: string;
  sourceContent?: string;
  idempotencyKey: string;
}
```

`get/wait/resume`의 source-thread 범위, 소유권, idempotency와 작업 링크 복구 규칙은 유지한다. `resume`은 원 작업의 현재 권한과 대상 작업의 고정 모델·백엔드 설정을 함께 검증한다.

### 5.5 관리 위임 설정

`delegation.launch-modes`를 version 3으로 올리고 다섯 제공자의 관리형 기본값을 표현한다.

- Codex와 Claude는 `managed` 또는 기존 `direct` 유지
- DeepSeek, Ollama, Antigravity는 우선 `managed`만 지원
- version 2 설정은 정규화 단계에서 손실 없이 version 3으로 이전
- 전역 모델 카탈로그가 모델 활성화의 최종 권한이며, 위임 설정은 활성 모델 중 기본 선택만 가리킨다

## 6. 호스트와 워커 능력

UI가 제공자 지원 여부를 하드코딩하지 않도록 호스트 능력 응답에 다음을 포함한다.

```ts
type HostProviderCapability = {
  provider: ProviderId;
  create: boolean;
  resume: boolean;
  managedSource: boolean;
  reason?: string;
};
```

초기 정책:

- 로컬 호스트: 다섯 제공자 대상 작업 허용
- 원격/데스크톱 워커: 현재 Codex와 Claude만 허용
- 지원하지 않는 탭은 숨기지 않고 비활성화하여 이유를 표시
- 향후 원격 워커가 제공자를 추가하면 UI 변경 없이 능력 응답만으로 활성화

## 7. 호출 주체 확장

대상 확장과 호출 주체 확장을 분리한다.

### 7.1 DeepSeek와 Ollama

두 제공자는 `claude-worker`를 공유하므로 다음을 추가한다.

- 작업별 관리 capability token과 해시 생성
- `CLAUDEX_WORKHOUSE_MANAGED_PROVIDER_MCP_URL`, 현재 task ID와 bearer token 주입
- 제한 도구 목록에 관리 MCP 네 도구 추가
- 제공자 실제 ID가 인증 및 source-thread 비교에서 보존되는지 검증
- 도구 호출을 지원하지 않는 모델은 `managedSource=false`로 보고

### 7.2 Antigravity와 Vertex

- 각 워커에 task-scoped 관리 MCP 인증 환경 추가
- 런타임별 MCP 도구 선언과 호출 결과 변환 구현
- consumer Antigravity와 Vertex API의 세션 ID·resume 차이를 각각 테스트
- 도구 호출 기능이 없는 백엔드는 대상 작업만 지원하고 호출 주체에서는 비활성화

### 7.3 공통 보안 조건

- endpoint는 loopback 또는 인증된 워커 내부 채널로 제한
- task ID와 bearer token을 함께 검증
- source provider, thread/session, host, workspace가 모두 일치해야 조회·대기·재개 허용
- 임의의 다른 세션 작업 ID로 접근하는 테스트 유지
- Codex 관리 MCP URL의 고정 포트를 제거하고 실제 서버 포트를 환경으로 전달

## 8. 구현 단계

### 단계 0. 계약과 능력 모델 고정

- 공통 실행 선택 타입과 관계별 권한 표를 코드 타입으로 정의
- 호스트별 제공자 능력 응답 추가
- 같은 제공자·다른 모델 허용 정책 반영
- 현재 API·DB 회귀 테스트를 기준선으로 저장

완료 조건: UI 없이도 서버 단위 테스트에서 가능한 선택과 불가능한 선택의 오류 코드가 안정적으로 구분된다.

### 단계 1. 공통 제공자·모델 선택 UI

- `ProviderExecutionPicker.svelte` 구현
- 기존 모델 카탈로그와 `SessionSettingsFields.svelte` 재사용
- `App.svelte`와 `CodexSessions.svelte`의 중복 Assist 모달을 공통 컴포넌트로 교체
- `HandoffDialog.svelte` 1단계에 동일 선택기 삽입
- 모바일에서 탭 가로 스크롤, 키보드 포커스, 긴 모델명과 비활성 사유 검증

완료 조건: 네 곳에 중복된 버튼 경로가 모두 같은 선택기와 상태 계약을 사용한다.

### 단계 2. 모든 제공자를 검토 대상으로 지원

- Assist API 실행 선택 필드 확장
- `createAssist()`의 Codex/Claude 제한 제거
- 전역 모델·호스트 능력·유료 동의 검증
- 검토 대상은 항상 읽기 전용으로 강제
- 결과 자동 전달 금지와 명시적 `relayToPrimary` 유지

완료 조건: 각 원본 제공자에서 가능한 다른 네 제공자 및 같은 제공자의 다른 모델로 검토 세션을 만들 수 있다. 생성된 대상 task의 요청·유효 모델과 권한이 DB 및 이벤트에 일치한다.

### 단계 3. 모든 로컬 제공자를 인계 대상으로 지원

- Handoff DB 마이그레이션과 manifest 확장
- 로컬 작업 생성에 선택 모델 전달
- 원격 워커에서는 능력에 없는 제공자 탭 비활성
- 재시작 후 실행과 retry에서도 같은 선택 유지

완료 조건: 초안 생성 후 서버를 재시작해도 선택한 제공자·모델·추론 수준으로 인계되며 기존 commit, dirty tree, lease 검증이 유지된다.

### 단계 4. 관리형 백그라운드 대상 확장

- 관리 MCP 스키마와 `ManagedProviderBridge.create()`의 제공자 제한 일반화
- delegation settings version 3 도입
- 선택값과 카탈로그·호스트 능력 검증
- 다섯 제공자의 create/get/wait/resume 결과 정규화

완료 조건: Codex 또는 Claude 소스에서 DeepSeek, Ollama, Antigravity 관리 작업을 생성하고 완료·실패·관찰 제한·후속 재개를 정확히 추적한다.

### 단계 5. 모든 가능한 제공자를 호출 주체로 확장

- DeepSeek/Ollama 관리 MCP 주입
- Antigravity/Vertex 관리 도구 연결
- 모델별 tool-use 능력을 capability로 노출
- tool-use 미지원 모델은 명확한 제한을 보고하고 다른 제공자로 대체하지 않음

완료 조건: `managedSource=true`인 각 제공자 모델이 다른 제공자의 관리 작업을 만들고 같은 원본 스레드의 후속 턴에서 조회·대기·재개할 수 있다.

### 단계 6. 과금·다국어·운영 검증

- DeepSeek, Ollama Cloud, Antigravity consumer, Vertex의 비용·동의 정책 명시
- 한국어·영어·일본어 문구와 접근성 이름 정렬
- 배포 빌드, 재시작, health, 실제 UI와 필요한 최소 실모델 조합 검증

완료 조건: 사용자가 어떤 제공자가 선택되었고 어떤 비용·권한·호스트 제약이 적용되는지 실행 전에 알 수 있다.

## 9. 테스트 계획

### 단위 테스트

- 실행 선택 정규화와 provider/model/effort/tier 조합
- delegation settings v2 → v3 이전
- 호스트 능력에 따른 탭 활성화
- relation별 권한 상한과 자동화 지원 여부
- 동일 idempotency key 재사용과 다른 payload 충돌

### 통합 테스트

- 5개 제공자 Assist 참가자 생성과 capability snapshot
- 검토가 항상 읽기 전용인지 확인
- Handoff `target_execution_json` 생성·읽기·재시작·retry 왕복
- 관리 작업 create/get/wait/resume의 source-thread 범위
- provider refresh 중 관리 링크 복구
- 유료 동의 전에는 제공자 작업과 collaboration이 생성되지 않는지 확인
- 원격 호스트 미지원 제공자의 서버 측 거부

### E2E

- 데스크톱과 모바일의 검토 요청 버튼 → 회사 탭 → 모델 선택 → 생성
- 작업 인계 3단계에서 탭 선택값 유지
- 긴 모델명, 빈 카탈로그, 연결 끊김, 로컬 전용 비활성 사유
- 뒤로 가기와 모달 재열기 시 선택값 정책
- 상단 아바타와 작업 목록에 관리 대상 작업 표시
- 읽기 전용 검토에 수정 권한 UI가 나타나지 않는지 확인

### 실모델 검증

모의 테스트 통과 뒤 비용을 통제하여 다음 최소 매트릭스를 실행한다.

1. Codex → Claude 기존 회귀
2. Claude → Codex 기존 회귀
3. Codex → DeepSeek 신규 대상
4. Claude → Ollama 신규 대상
5. Codex 또는 Claude → Antigravity/Vertex 신규 대상
6. DeepSeek/Ollama/Antigravity 중 `managedSource=true`인 모델 → Codex 또는 Claude

실모델 검증을 하지 않은 조합은 완료로 표시하지 않는다.

## 10. 변경 예상 파일

핵심:

- `app/src/web/ProviderExecutionPicker.svelte` 신규
- `app/src/web/AssistRequestDialog.svelte` 신규 또는 공통화
- `app/src/web/App.svelte`
- `app/src/web/CodexSessions.svelte`
- `app/src/web/HandoffDialog.svelte`
- `app/src/web/SessionSettingsFields.svelte`
- `app/src/server/managed-provider-mcp.ts`
- `app/src/server/delegation-settings.ts`
- `app/src/server/collaboration/orchestrator.ts`
- `app/src/server/handoff.ts`
- `app/src/server/index.ts`
- `app/src/server/providers/compatible.ts`
- `app/src/server/providers/antigravity.ts`
- `app/src/server/claude-worker.ts`
- Antigravity 및 Vertex 워커
- SQLite worker의 handoff schema와 migration
- `app/src/web/i18n/ko.ts`, `en.ts`, `ja.ts`

검증:

- `app/tests/integration/collaboration.test.ts`
- `app/tests/integration/handoff.test.ts`
- managed provider와 delegation settings 단위 테스트
- 작업 상세 및 모바일 E2E

## 11. 완료 정의

다음이 모두 충족되어야 “모든 제공자 지원 완료”로 판정한다.

- 검토 요청과 인계 버튼이 공통 회사 탭·모델 선택 UI를 연다.
- 서버가 다섯 제공자 대상 선택을 실제 작업 생성까지 보존한다.
- 검토·인계·백그라운드 요청의 권한과 결과 전달 의미가 섞이지 않는다.
- 로컬·원격 호스트의 지원 차이가 실행 전 UI와 API 오류에 반영된다.
- 관리형 대상 확장과 호출 주체 확장을 별도로 검증한다.
- create/get/wait/resume, idempotency, source-thread 범위와 인증이 모든 지원 조합에서 유지된다.
- 유료 경로는 실행 전에 명시적으로 확인된다.
- 한국어·영어·일본어와 모바일 UI가 일치한다.
- 단위·통합·E2E·빌드·재시작·health 검증을 통과한다.
- 실제 호출하지 않은 유료 제공자 조합을 완료했다고 주장하지 않는다.

## 12. 구현 전 확정된 기본안

- 제공자 탭은 다섯 개 모두 표시하되 불가능한 탭은 이유와 함께 비활성화한다.
- 모델과 추론 수준은 매 요청에서 선택할 수 있고, 마지막 선택은 기능별로 기억한다.
- 검토 요청은 무조건 읽기 전용이다.
- 인계 계속하기와 관리형 백그라운드 실행은 원본의 유효 권한을 상속한다.
- 같은 제공자라도 다른 모델·새 세션이면 대상으로 허용한다.
- DeepSeek/Ollama/Antigravity의 `direct` 위임은 만들지 않고 관리형만 지원한다.
- 원격 워커의 비-Codex/Claude 지원은 별도 능력 확장 전까지 노출만 비활성화한다.
