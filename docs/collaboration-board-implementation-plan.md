# 협업 게시판 끝까지 구현 계획서

## 1. 결정

- 사용자 표시 이름은 **협업 게시판**으로 한다.
- 영어 키와 내부 기능명은 `Collaboration Board` / `collaborationBoard`로 통일한다.
- 협업 게시판은 홈의 기존 `LIVE WORK`를 대체하지 않는다. 홈 왼쪽에서 `LIVE WORK` 바로 아래에 배치한다.
- `LIVE WORK` 카드는 현재 실행 중인 세션을 감독하는 일시적인 실행 카드다.
- 협업 게시판 카드는 사람이 관리하는 영속적인 작업 단위이며 여러 실제 세션을 포함할 수 있다.
- 기존 세션 화면의 `협업 작업` 탭은 실제 구현·검토 협업 세션을 찾는 실행 이력 화면으로 유지한다.
- 짧은 대화·브라우저 연결 세션은 기존 `연결 세션` 탭에 남긴다.
- 단독 세션을 시작했다고 자동으로 게시판 카드를 만들지 않는다. 필요할 때 `협업 게시판에 추가`로 승격한다.
- 게시판에서 시작한 구현·검토·수정 세션은 처음부터 해당 카드에 연결한다.
- 완전 자율 오케스트레이터를 새로 만들지 않는다. 기존 단독 작업, 협업, 인계, 재개 로직을 게시판에서 호출한다.

## 2. 구현 목적과 완료 상태

목표는 시안만 붙이는 것이 아니라 다음 사용자 흐름을 실제 저장·실행·복구까지 완성하는 것이다.

1. 홈에서 협업 게시판 카드를 생성한다.
2. 제목, 설명, 상태, 우선순위, 작업공간, 목표 브랜치, 구현자와 검토자를 지정한다.
3. 카드에서 Codex·Claude·Gemini 등 현재 지원 공급자의 실제 작업 세션을 시작한다.
4. 세션이 시작되면 홈 `LIVE WORK`에는 실행 카드가, 협업 게시판에는 영속 카드가 동시에 나타난다.
5. 실행 카드에는 실시간 상태를 표시하고, 게시판 카드에는 `위에서 실행 중`과 연결 세션 수를 표시한다.
6. 구현 완료 후 카드에서 검토 요청을 만들고 실제 검토 세션을 연결한다.
7. 검토 결과를 보고 수정 세션을 생성하거나 사용자 승인 후 완료 처리한다.
8. 서버 재시작, 세션 compact/resume, 공급자 세션 교체 후에도 카드와 타임라인이 유지된다.
9. 데스크톱·모바일에서 생성, 상태 변경, 세션 열기, 재개, 검토 요청을 모두 수행할 수 있다.

아래 항목이 모두 검증돼야 완료로 판정한다.

- 데이터베이스 마이그레이션과 기존 데이터 호환성
- 카드 CRUD와 보관 처리
- 기존 세션 또는 기존 WorkChain을 카드로 승격·연결하는 기능
- 카드에서 단독 작업·검토·수정·재개 세션을 시작하는 기능
- 홈 요약 패널과 전체 게시판
- 카드 상세와 자동 활동 타임라인
- 세션 화면과의 상호 이동
- 한국어·영어·일본어 번역
- 단위·API·브라우저 E2E·빌드
- 안전한 서비스 재시작과 실제 배포 화면 확인

커밋, 푸시, 공개 릴리스는 구현 완료와 별도 작업이며 사용자 요청 없이는 수행하지 않는다.

## 3. 화면 정보 구조

### 3.1 홈

```text
홈
├─ 왼쪽 메인
│  ├─ LIVE WORK
│  │  └─ 현재 실행 중인 TaskLivenessPanel
│  └─ 협업 게시판
│     ├─ 진행 / 검토 / 대기 / 완료 요약 필터
│     ├─ 주의가 필요한 카드와 최근 활동 카드 3~5개
│     ├─ 새 카드
│     └─ 게시판 전체 보기
└─ 오른쪽
   ├─ 워커 상태
   ├─ 최근 완료
   └─ 빠른 작업 시작
```

- 실행 중인 세션이 없을 때 `LIVE WORK` 빈 상태 높이를 현재 270px에서 약 120~150px로 줄여 협업 게시판이 첫 화면에 보이게 한다.
- 실행 중인 세션이 있으면 현재 `TaskLivenessPanel`의 밀도 규칙을 유지한다.
- 같은 카드에 연결된 활성 세션이 있으면 게시판 카드에 `위에서 실행 중`, 공급자, 활성 세션 수를 표시한다.
- 홈에는 전체 칸반을 넣지 않는다. 카드 수를 제한하고 `게시판 전체 보기`로 이동한다.

### 3.2 전체 협업 게시판

- 데스크톱은 `대기 | 작업 중 | 검토 | 승인 대기 | 완료` 열을 사용한다.
- 모바일은 가로 칸반 대신 상태 탭과 세로 목록을 사용한다.
- 첫 버전은 드래그앤드롭을 필수로 하지 않는다. 카드 메뉴 또는 상세 화면에서 상태를 변경해 접근성과 모바일 안정성을 우선한다.
- 검색 조건은 제목, 설명, 작업공간, 브랜치와 연결 세션 제목이다.
- 필터는 상태, 우선순위, 담당 공급자, 작업공간을 제공한다.
- 완료 카드는 기본 접힘 또는 제한 표시하며 보관된 카드는 별도 필터에서만 보인다.

### 3.3 카드 상세

- 기본 정보: 제목, 설명, 상태, 우선순위, 작업공간, 목표 브랜치, 마지막 활동
- 역할: 구현자, 검토자, 보조 검토자. 역할마다 공급자, 모델 선택, 권한 프로필을 저장한다.
- 실제 세션: 공급자, 역할, 상태, 실행 호스트, 권한, 시작·마지막 활동 시간
- 최근 결과: 실제로 저장된 task 상태·result·error와 collaboration outcome을 요약한다.
- 타임라인: 카드 생성, 정보 변경, 상태 변경, 세션 연결, 실행 시작·종료, 검토 요청, 승인, 보관
- 동작: `새 작업 세션`, `검토 요청`, `수정 세션`, `재개`, `기존 세션 연결`, `완료`, `보관`

## 4. 상태와 자동화 규칙

게시판 상태는 공급자 프로세스 상태와 분리한다.

| 게시판 상태 | 의미 | 기본 전환 |
|---|---|---|
| `queued` | 아직 실행을 시작하지 않은 작업 | 작업 시작 |
| `in_progress` | 구현 또는 수정이 진행 중 | 검토 요청 |
| `review` | 검토 세션이 실행 중이거나 검토 결과를 확인 중 | 수정 또는 승인 요청 |
| `approval` | 사용자의 최종 결정을 기다림 | 완료 또는 작업 재개 |
| `completed` | 사용자가 작업 완료를 확정 | 필요 시 다시 열기 |

- 카드에서 첫 작업 세션을 시작하면 `queued`를 `in_progress`로 바꿀 수 있다.
- 카드에서 검토 요청을 시작하면 `review`로 전환한다.
- 공급자 세션의 `completed`만으로 게시판 카드를 자동 완료하지 않는다.
- 모델의 응답 문구만 보고 테스트 통과나 승인 완료를 확정하지 않는다.
- `completed` 전환은 사용자 동작 또는 사용자가 명시적으로 활성화한 후속 자동화만 허용한다.
- 실패·사용자 입력·승인 대기 세션이 있으면 카드에 주의 배지를 표시하되 게시판 상태 자체를 임의 변경하지 않는다.

## 5. 데이터 설계

### 5.1 기존 구조 활용

현재 `work_chains`가 세션 묶음 ID 역할을 하고 `tasks.work_chain_id`, `collaboration_sessions.work_chain_id`, `session_links.chain_id`가 이미 존재한다. 새 그룹 ID를 하나 더 만들지 않고 `work_chains`를 게시판 카드의 기반으로 확장한다.

이것은 V1의 의도적인 결합이다. `work_chains`는 실행 관계 그래프와 사람이 관리하는 카드라는 두 역할을 겸한다. 향후 하나의 실행 체인에 여러 독립 카드가 필요해지거나, 카드가 체인 없이 존재해야 하거나, 역할별 이력·복수 검토자·조직 워크플로가 핵심이 되면 `work_items`와 실행 체인을 분리하는 마이그레이션을 다시 검토한다. V1에서는 이미 널리 연결된 WorkChain ID를 재사용해 중복 관계와 동기화 비용을 줄인다.

기존 인계로 자동 생성된 WorkChain이 갑자기 게시판에 노출되지 않도록 `board_visible` 기본값은 `0`으로 둔다. 새 게시판 카드 또는 사용자가 승격한 체인만 `1`이 된다.

`work_chains` 추가 필드:

- `board_visible INTEGER NOT NULL DEFAULT 0`
- `description TEXT NOT NULL DEFAULT ''`
- `board_status TEXT NOT NULL DEFAULT 'queued'`
- `priority TEXT NOT NULL DEFAULT 'normal'`
- `workspace_id TEXT`
- `target_branch TEXT`
- `roles_json TEXT NOT NULL DEFAULT '{}'`
- `last_activity_at TEXT`
- `completed_at TEXT`
- `revision INTEGER NOT NULL DEFAULT 1`

기존 `work_chains.archived_at`은 그대로 사용한다. `completed_at`은 사용자가 완료를 확정한 시간이고, `archived_at`은 완료 여부와 무관하게 기본 목록에서 감춘 시간이므로 서로 대체하지 않는다.

`roles_json`에는 역할별 공급자·모델·권한 선택만 저장하고 비밀정보, 프롬프트 전문, 공급자 인증정보는 저장하지 않는다. 이 JSON은 구현자·검토자·보조 검토자 정도를 저장하는 V1 형식일 뿐 영구적인 도메인 구조로 고정하지 않는다. 복수 검토자, 역할별 변경 이력, 개별 할당 상태가 필요해지면 별도 역할 테이블로 이관한다.

### 5.2 타임라인 테이블

`work_chain_events`를 추가한다.

- `id`, `chain_id`, `event_type`, `task_id`, `collaboration_session_id`
- `actor_type`, `actor_id`
- `dedupe_key`, `payload_json`, `created_at`
- `(chain_id, created_at)` 인덱스
- 자동 이벤트에 대한 `UNIQUE(chain_id, dedupe_key)` 제약. 수동 이벤트처럼 dedupe가 필요 없는 행의 `dedupe_key`는 `NULL`로 둔다.

이벤트는 사람이 읽을 문장을 그대로 저장하지 않고 구조화된 종류와 최소 payload를 저장한다. UI에서 현재 언어로 문장을 만든다.

자동 이벤트의 dedupe key는 안정적인 원본 ID와 전이를 사용한다. 예: `task:<id>:completed`, `collaboration:<id>:started`, `chain:<id>:status:review:r7`. 서버 재시작, watcher 재동기화, 동일 idempotent 요청이 같은 사건을 다시 관찰해도 타임라인 행을 중복 생성하지 않는다. 이벤트 삽입과 카드 `last_activity_at` 갱신은 같은 트랜잭션에서 처리한다.

### 5.3 마이그레이션 안전성

- Python SQLite worker와 TypeScript SQLite worker의 스키마·연산을 동시에 수정한다.
- 신규 설치 CREATE TABLE과 기존 설치 additive migration을 모두 지원한다.
- 기존 WorkChain은 `board_visible=0`으로 보존하고 인계 타임라인 기능이 그대로 작동하는지 회귀 검사한다.
- 라이브 데이터 마이그레이션 전 WAL 일관성이 보장되는 지원 경로로 백업하고 백업 파일 존재와 SQLite 무결성을 검증한다.
- 마이그레이션 후 `PRAGMA quick_check`, 대상 테이블 컬럼·인덱스, 기존·신규 행 수를 확인한다.

## 6. 서버와 API

전용 서비스 모듈을 만들고 기존 `handoff.ts`에 게시판 CRUD를 계속 붙이지 않는다. 서비스는 카드, 세션 연결, 이벤트 생성을 하나의 트랜잭션 경계로 처리한다.

예정 API:

- `GET /api/collaboration-board/cards`
- `POST /api/collaboration-board/cards`
- `GET /api/collaboration-board/cards/:id`
- `PATCH /api/collaboration-board/cards/:id`
- `POST /api/collaboration-board/cards/:id/archive`
- `POST /api/collaboration-board/cards/:id/reopen`
- `POST /api/collaboration-board/cards/:id/sessions/attach`
- `POST /api/collaboration-board/cards/:id/actions/start-work`
- `POST /api/collaboration-board/cards/:id/actions/request-review`
- `POST /api/collaboration-board/cards/:id/actions/start-revision`
- `GET /api/collaboration-board/cards/:id/events`

서버 규칙:

- 입력은 Zod로 상태, 우선순위, UUID, 공급자, 작업공간, 브랜치 길이와 형식을 검증한다.
- 변경 API는 기존 인증, CSRF, Idempotency-Key 규칙을 따른다.
- `revision`을 이용해 오래 열린 편집 화면의 덮어쓰기를 거절한다.
- 연결하려는 task/collaboration session이 같은 프로젝트·허용된 작업공간 범위인지 검증한다.
- 이미 다른 게시판 카드에 속한 세션은 묵시적으로 이동하지 않고 충돌을 반환한다.
- 기존 세션에 WorkChain이 없으면 해당 세션을 root로 하는 체인을 만들고 게시판 카드로 승격한다. 이미 WorkChain이 있으면 세션 하나만 떼어 새 카드에 넣지 않고 체인 전체를 승격한다.
- V1은 세션 `detach` API와 UI를 제공하지 않는다. `tasks.work_chain_id=NULL`, `collaboration_sessions.work_chain_id=NULL` 또는 `session_links` 삭제로 기존 handoff/resume 그래프를 끊지 않는다.
- 게시판에서 제거한다는 동작은 카드 보관 또는 `board_visible=0`이며 실행 그래프는 그대로 보존한다. 잘못 연결된 그래프를 실제로 분리하는 기능은 관계 재작성 규칙과 전용 마이그레이션이 설계될 때까지 범위에서 제외한다.
- 카드 시작 동작은 기존 공급자 작업 생성 로직을 호출하고 생성된 task에 같은 `workChainId`를 기록한다.
- 검토 요청은 기존 collaboration review/parallel 생성 경로를 사용하며 `collaboration_sessions.work_chain_id`를 생성 시점부터 기록한다.
- 인계, 재개, 수정 세션은 기존 체인 ID를 이어받는다.
- 세션 상태 변화는 기존 persisted task/collaboration 데이터를 기준으로 이벤트와 `last_activity_at`을 갱신한다. 모델 자기보고만을 실행 증거로 사용하지 않는다.

## 7. 웹 구현

예정 구성:

- `CollaborationBoardPanel.svelte`: 홈 요약
- `CollaborationBoardPage.svelte`: 전체 게시판과 모바일 상태 목록
- `CollaborationBoardCard.svelte`: 공통 카드
- `CollaborationBoardDetail.svelte`: 상세·역할·세션·타임라인·동작
- `CollaborationBoardEditor.svelte`: 생성·편집
- `collaboration-board.ts`: 타입, API 상태, 정렬·주의 상태 파생 로직

`App.svelte` 변경은 내비게이션과 화면 연결에 한정하고 카드 내부 상태를 거대 컴포넌트에 추가하지 않는다.

홈 배치:

- 현재 `.overview-grid`의 왼쪽을 `.overview-main`으로 감싼다.
- `.overview-main` 안에 기존 `.overview-active`와 새 협업 게시판 패널을 순서대로 둔다.
- 오른쪽 `.overview-side`는 유지한다.
- 빠른 작업 시작에 `새 작업 카드`를 추가한다. `새 Codex`, `새 Claude`는 카드 없는 즉시 실행임을 유지한다.

세션 화면 연결:

- 단독 작업 상세 메뉴에 `협업 게시판에 추가` 또는 `기존 카드에 연결`을 제공한다.
- `협업 작업` 탭은 실제 장시간 협업 세션을 계속 표시한다.
- 카드 상세에서 세션을 누르면 해당 공급자 세션 상세를 연다.
- 세션 상세에서는 연결된 협업 게시판 카드로 돌아가는 링크를 제공한다.
- 대화·브라우저 단기 연결 세션은 카드에 자동 연결하지 않는다.

반응형:

- 데스크톱: 현재 2열 홈을 유지하고 왼쪽에 패널을 세로로 추가한다.
- 모바일: `LIVE WORK → 협업 게시판 → 워커 상태 → 최근 완료 → 빠른 작업 시작` 순서다.
- 360px, 412px, 800px에서 가로 스크롤, 하단 내비게이션 충돌, 플로팅 아바타 가림을 검사한다.
- 모바일 전체 게시판은 한 상태씩 보여주며 카드 상세는 전체 화면 sheet 또는 현재 앱의 모바일 상세 패턴을 따른다.

번역:

- `ko.ts`, `en.ts`, `ja.ts`에 동일 키를 추가한다.
- WorkChain은 내부 용어로 남길 수 있지만 사용자 화면에서는 `협업 게시판`, `작업 연결`, `연결된 세션`으로 표시한다.

## 8. 단계별 구현 순서

### 단계 A — 도메인과 마이그레이션

1. 공유 타입과 상태 전환 검증을 추가한다.
2. 두 SQLite worker에 additive schema와 CRUD/event 연산을 구현한다.
3. 기존 체인이 숨겨지고 명시적으로 승격한 체인만 노출되는 회귀 테스트를 작성한다.
4. DB client 메서드와 전용 서버 서비스를 추가한다.

완료 기준: 새 DB와 기존 DB 양쪽에서 카드 저장·재조회·수정 충돌·보관·이벤트 순서가 단위 테스트로 확인된다.

### 단계 B — API와 실제 세션 연결

1. 카드 CRUD와 타임라인 API를 추가한다.
2. 기존 task/collaboration session의 신규 체인 생성 또는 기존 체인 전체 승격을 구현한다.
3. 카드에서 단독 작업을 시작하고 `tasks.work_chain_id`가 저장되는지 검증한다.
4. 카드에서 검토를 시작하고 `collaboration_sessions.work_chain_id`가 저장되는지 검증한다.
5. 인계·재개·수정 경로가 같은 체인을 유지하는지 검증한다.

완료 기준: API 응답뿐 아니라 DB 재조회 후에도 카드와 모든 실제 세션의 연결이 일치한다.

### 단계 C — 홈 협업 게시판

1. 시안대로 기존 `LIVE WORK` 아래에 요약 패널을 배치한다.
2. 활성 세션이 0개일 때 빈 영역을 축소한다.
3. 카드 생성, 상태 필터, 카드 상세 진입, 활성 세션 배지를 구현한다.
4. `LIVE WORK` 카드와 게시판 카드의 클릭 목적을 분리한다.

완료 기준: 같은 실행이 LIVE WORK에서는 세션 감독으로, 협업 게시판에서는 영속 작업 관리로 구분되어 보인다.

### 단계 D — 전체 게시판과 카드 동작

1. 전체 상태 보드와 모바일 상태 목록을 구현한다.
2. 편집, 역할 지정, 기존 세션 연결, 작업·검토·수정·재개 버튼을 연결한다.
3. 타임라인과 최근 결과를 실제 persisted 데이터에서 표시한다.
4. 완료, 다시 열기, 보관 흐름을 구현한다.

완료 기준: 새 카드에서 구현 세션 생성 → 검토 생성 → 수정 생성 → 사용자 완료까지 UI만으로 수행할 수 있다.

### 단계 E — 회귀·배포·실사용 검증

1. 번역과 접근성 이름, 키보드 포커스, 모바일 터치 타깃을 검사한다.
2. 기존 `협업 작업`, `연결 세션`, 일반 공급자 탭 분리를 재검증한다.
3. 플로팅 아바타가 카드·상세와 중복 또는 겹침을 만들지 않는지 검사한다.
4. 전체 check/test/build 후 안전한 DB 백업과 서비스 재시작을 수행한다.
5. 실제 서비스에서 카드를 하나 생성하고 작업 세션과 검토 세션을 연결한 뒤 재시작 후 복구를 확인한다.

완료 기준: 아래 검증표가 모두 실제 실행 결과로 채워지고 미검증 항목이 남지 않는다.

## 9. 테스트 계획

### 단위·통합

- 상태 전환과 잘못된 상태·우선순위 거절
- 새 설치와 기존 DB additive migration
- Python/TypeScript SQLite worker 스키마와 직렬화 parity
- legacy WorkChain 비노출, 승격 후 노출
- 카드 생성·수정 revision 충돌·완료·다시 열기·보관
- 구조화 이벤트 생성과 시간순 조회
- 기존 task/collaboration 연결, 기존 체인 전체 승격, 중복 연결, 다른 카드 충돌
- 게시판 보관·비노출이 task workChainId와 session_links 그래프를 변경하지 않음
- watcher 재동기화와 동일 idempotent 요청에서 자동 이벤트 dedupe
- 시작된 task와 collaboration에 동일한 workChainId 저장
- handoff/resume/revision에서 체인 유지
- 완료 세션이 카드 상태를 임의로 완료하지 않음
- 사용자 입력·승인·실패가 주의 상태로 파생됨
- 세션 탭 scope와 연결 세션 분리 회귀

### 브라우저 E2E

- 실행 0개 홈: 축소된 LIVE WORK 아래 협업 게시판이 첫 화면에 보임
- 실행 1개 홈: 실행 카드와 같은 작업의 게시판 카드가 함께 보이고 의미가 구분됨
- 카드 생성 → 새로고침 → 데이터 유지
- 카드에서 Codex/Claude 작업 시작 → LIVE WORK와 세션 탭 양쪽에 표시
- 검토 요청 → 협업 작업 탭에 표시 → 카드로 복귀
- 기존 단독 세션을 카드로 승격
- 단독 빠른 시작은 카드를 자동 생성하지 않음
- 상태 변경, 완료, 다시 열기, 보관
- 360·412·800 viewport에서 순서, 가로 overflow, 하단 내비게이션, 상세 sheet
- 플로팅 아바타 단일 렌더링과 카드 가림 방지

### 전체 검증 명령

```sh
cd app
pnpm check
pnpm test
pnpm build
pnpm test:e2e:docker -- --project=mobile-360 <관련 spec>
pnpm test:e2e:docker -- --project=mobile-412 <관련 spec>
pnpm test:e2e:docker -- --project=tablet-800 <관련 spec>
```

공개판에 포함되는 공통 기능이므로 기존 public release scrub 단위 테스트를 약화하지 않고 통과시킨다. 브라우저 전용 비공개 경로를 새 기능에 섞지 않는다.

## 10. 배포와 직접 확인

런타임 코드와 DB 스키마가 바뀌므로 문서·빌드만으로 끝내지 않는다.

1. 의도한 파일과 기존 dirty worktree를 구분한다.
2. 활성 작업을 확인해 재시작이 안전한지 판단한다.
3. 지원되는 SQLite snapshot/maintenance 경로로 라이브 DB를 백업하고 검증한다.
4. `pnpm check`, `pnpm test`, `pnpm build` 성공 후 재시작한다.
5. 재시작 전후 supervisor PID를 기록한다.
6. live/ready health를 확인하되 이것을 기능 검증으로 간주하지 않는다.
7. 실제 UI/API에서 다음을 직접 확인한다.
   - 카드 생성과 새로고침 후 유지
   - 카드에서 실제 작업 세션 시작
   - LIVE WORK와 게시판 동시 표시
   - 실제 검토 세션 생성과 협업 작업 탭 표시
   - 완료 처리와 보관
   - 재시작 후 카드·세션·타임라인 복구
8. 변경 파일, 테스트 결과, 빌드, PID, health, 직접 검증, 미커밋 상태를 각각 보고한다.

## 11. 범위에서 제외하는 것

- AI가 임의로 대기 카드를 가져가는 완전자율 scheduler
- 공급자 응답 문구만으로 자동 승인·자동 완료
- 멀티 사용자 RBAC, 조직용 담당자 계정, 알림 에스컬레이션
- 외부 Jira·Linear·Trello 동기화
- 첫 버전의 필수 드래그앤드롭
- WorkChain root·handoff·resume 관계를 끊는 세션 detach
- nginx, Cloudflare, 외부 포트, Docker 인프라 변경
- 공식 VS Code 확장이나 Codex SQLite 저장소 변경

이 항목들은 협업 게시판의 핵심 흐름이 실사용 검증된 뒤 별도 기능으로 판단한다.

## 12. 구현 중 중단 조건

다음은 조용히 우회하지 않고 사용자에게 보고한다.

- 기존 dirty 변경과 같은 파일·같은 코드 구간에서 안전하게 병합할 수 없는 충돌
- 라이브 DB 백업 또는 무결성 검사가 실패함
- 활성 작업 때문에 서버 재시작이 안전하지 않음
- 기존 공급자 세션 생성 경로가 workChainId를 보존하지 못해 새 엔진 설계가 필요해짐
- 기존 공개판 scrub 경계를 위반할 가능성이 생김

그 외 일반적인 구현 오류와 테스트 실패는 원인을 고치고 계획의 완료 기준까지 계속 진행한다.
