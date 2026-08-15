# 개인용 Claudex Workhouse 신뢰성·편의성 구현 계획

## 1. 목적

Claudex Workhouse를 다중 사용자 제품이 아닌 **한 사람이 NAS, PC,
휴대폰, 태블릿에서 Codex와 Claude Code를 운용하는 자가 호스팅
관제소**로 완성한다.

이번 계획의 중심은 기능 수를 늘리는 것이 아니라 다음 세 가지다.

1. 에이전트가 멈추거나 질문했을 때 사용자가 놓치지 않는다.
2. 사용량 한도를 낭비하지 않고 큰 작업을 적절한 시점에 시작한다.
3. 서버나 Worker가 중단돼도 사용자가 기존 작업을 쉽게 이어간다.

이 문서는 현재 `main`의 기준 커밋 `3d911bf` 이후 작업을 위한
상위 로드맵이다. Windows 단일 EXE의 상세 설계는
`docs/windows-portable-server-plan.md`를 정본으로 사용한다.

## 2. 명시적 범위

### 포함

- `user-input` Web Push 누락 수정
- 브라우저 승인 왕복 검증과 오래된 문서 정리
- Provider 사용량 회복 후 한 번 실행하는 지연 작업
- 죽은 작업을 사용자가 확인 후 이어서 실행하는 복구 UX
- Codex와 Claude의 전체 이력 통합 검색
- 프롬프트 프리셋의 기기 간 동기화
- 모바일 공유 대상 등록
- 완료된 Git 작업의 명시적 PR 생성
- Windows 단일 EXE 계획의 후속 구현

### 제외

- 다중 사용자, RBAC, 조직·팀 관리
- 사용자별 Workspace 또는 credential 분리
- 매일·매주 cron 형태의 반복 작업
- 대화, API, transcript의 완전한 오프라인 캐시
- 죽은 작업의 무조건적인 자동 재실행
- 자동 PR 병합 또는 자동 force push
- 현재 사용자가 명시적으로 요청하지 않은 다른 톤·Provider 동작 변경

개인용이라는 이유로 기존 실행 권한, 승인, Workspace 경계, 경로 검증을
완화하지 않는다. “다중 사용자 권한 체계는 만들지 않는다”와 “작업 실행
안전장치를 제거한다”는 서로 다른 결정이다.

## 3. 현재 코드에서 확인된 사실

### 3.1 즉시 수정할 결함

- `app/src/server/push.ts`는 `user_input_required`를 `user-input`으로
  분류하고 실제 Push payload를 만든다.
- `app/public/sw.js`의 Push 허용 목록에는 `approval`, `completed`,
  `failed`, `host-offline`, `handoff`만 있고 `user-input`이 없다.
- 따라서 서버가 보낸 사용자 답변 요청을 Service Worker가 표시하지
  않고 버린다.
- 현재 `app/tests/unit/push-events.test.ts`는 서버 분류만 검사하며,
  서버 종류와 Service Worker 허용 목록의 일치를 검사하지 않는다.

### 3.2 이미 있는 기반

- Codex와 Claude의 5시간·주간 사용률과 `resetsAt`을 정규화한다.
- `creditResumePump`가 15초마다 한도 대기 중인 메시지와 협업 작업을
  재검사한다.
- 한도 조회 실패는 소진으로 단정하지 않으며, 실제로 관측된 소진만
  유료 크레딧 동의 흐름을 차단한다.
- 브라우저 승인 UI에는 `accept`, `acceptForSession`, `decline` 경로가
  구현돼 있다.
- Provider 공식 resume 경로, 메시지 큐, SQLite 시스템 설정 저장소,
  Codex 서버 검색, Git 작업과 `gh` 로그인 기반이 존재한다.

### 3.3 문서와 코드의 불일치

- `docs/known-limitations.md`는 승인 버튼이 비활성이라고 적지만 현재
  UI와 서버 코드에는 승인 버튼과 전달 경로가 있다.
- 이 차이는 문서를 즉시 “동작함”으로 바꾸라는 뜻이 아니다. 실제
  브라우저 → 서버 → Worker → Provider 왕복을 검증한 뒤, 확인된 범위와
  남은 제한을 정확히 다시 써야 한다.
- HTML 미리보기는 실제 컴포넌트와 테스트가 있으므로 관련 계획 문서의
  상태를 현재 구현과 대조해야 한다.

## 4. 구현 원칙

1. 완료된 Provider 응답과 실제 외부 변경만 완료로 기록한다.
2. 서버 재시작 후에도 예약과 복구 후보를 DB에서 재구성한다.
3. 시간 도달만으로 실행하지 않고 Provider 사용량을 다시 확인한다.
4. 조회 불가를 “회복됨” 또는 “소진됨”으로 추측하지 않는다.
5. 예약·재개·PR 생성은 idempotency key와 DB 상태 전이로 중복을 막는다.
6. 원 작업의 실행 권한보다 높은 권한으로 예약 또는 재개하지 않는다.
7. 외부 상태를 바꾸는 PR 생성과 죽은 작업 재개는 사용자 확인 후 실행한다.
8. Provider별 기능 차이를 숨기지 말고 UI에서 정확히 표시한다.
9. 기존 Linux/NAS 및 원격 Desktop Worker 경로를 유지한다.
10. `package.json`이 `private: true`인 동안 버전은 `1.0.0`을 넘기지 않는다.

## 5. 단계별 구현

### 현재 구현·검증 현황 (2026-07-30)

| 단계 | 현재 상태 | 자동화로 확인한 범위 | 남은 실환경 검증·제한 |
| --- | --- | --- | --- |
| C1 Push·승인 | 구현 및 자동화 검증 완료 | 서버/Service Worker Push 종류 계약, `user-input` deep link, `accept`·`acceptForSession`·`decline`, 만료·중복·Worker 연결 실패 | 향후 Codex app-server 버전과 아직 광고되지 않은 승인 method |
| C2 한도 회복 후 한 번 실행 | 구현 및 자동화 검증 완료 | quota 미회복·unknown·주간 소진 대기, 원자 claim, 동시 pump, 취소, 즉시 시작 경합, 재시작 reconciliation, 권한·Provider 경계, 브라우저 예약 카드 | Provider dispatch 시작 직후 서버가 죽은 불확실 구간은 자동 재시도하지 않으며 사용자 확인 필요 |
| C3 죽은 작업 이어서 실행 | 구현 및 자동화 검증 완료 | 복구 가능 중단 분류, 원 thread/host/Workspace/권한 고정, 동시 클릭, 재시작 reconciliation, 원격 경계 거부, 브라우저 확인 UI | 실제 NAS 전원 차단 후 Codex·Claude 양쪽 Provider 복구 훈련 |
| C4 통합 전체 검색 | 구현 및 자동화 검증 완료 | bounded DB 검색, Codex 결과 병합, 필터·한국어·특수문자·커서·정확한 결과 카드 이동 | NAS SQLite에 FTS5가 없어 bounded scan 사용, 외부 Claude transcript 제외 |
| C5 프롬프트 프리셋 동기화 | 구현 및 자동화 검증 완료 | CAS, 최초 이전, 충돌 병합, 삭제 보존, 손상값 복구, 독립 데스크톱·휴대폰·태블릿 브라우저 context | 실제 Safari·Android 기기 검증 |
| C6 모바일 공유·PR | 구현 및 자동화 검증 완료 | 1회용 공유 token, draft 프리필, 첨부 수명주기, GitHub preflight, 명시적 확인, 중복 방지, 모바일 fixture | 실제 Android/iOS 공유 시트·Cloudflare Access, 실제 외부 PR 1회, 원격 Worker PR 실기 |
| C7 Windows 단일 EXE | 단계 1~8 코드 및 Linux-hosted 계약 검증 완료, 지원 완료 아님 | 경로·SQLite·loopback 인증·managed local Worker·Provider 발견·런처·패키징·롤백·manifest/workflow 계약과 교차 컴파일 | 단계 0의 실제 signing identity/timestamp 선택, GitHub Windows runner, 깨끗한 Windows 11 x64 VM의 설치·실행·업데이트·롤백·Defender/SmartScreen 검증 |

이 표의 “자동화 검증 완료”는 실제 기기나 외부 서비스 검증을 대신하지
않는다. 세부 제한은 `docs/known-limitations.md`, Windows 릴리스 게이트는
`docs/windows-portable-server-plan.md`와 `docs/windows-support-policy.md`를
정본으로 사용한다.

## C1. Push 계약 수정과 승인 검증

### C1-1. `user-input` Push 수정

- `app/public/sw.js`의 허용 목록에 정확한 `user-input` 식별자를 추가한다.
- 서버 Push 종류와 Service Worker 허용 종류를 가능한 한 하나의
  계약에서 파생한다.
- 빌드 결과의 Service Worker에도 동일한 종류가 포함되는지 검사한다.
- 알림 클릭 시 해당 task/session과 질문 카드로 이동하는지 확인한다.
- foreground, quiet hours, 사용자 설정이 기존대로 적용되는지 보존한다.

### C1-2. 승인 왕복 검증

다음 각 경로를 fixture 또는 통합 테스트에서 확인한다.

- 한 번 허용
- 세션 동안 허용
- 거절
- 만료된 승인
- 동일 결정을 두 번 전송한 경우
- Worker 연결이 끊긴 경우
- 사용자에게 표시되는 위험도와 실제 요청의 일치

검증이 끝난 범위만 `docs/known-limitations.md`에 반영한다. 아직
검증하지 못한 Provider 버전이나 transport는 제한사항으로 남긴다.

### C1 완료 조건

- `user-input` Push가 Service Worker에서 폐기되지 않는다.
- 서버와 Service Worker 종류 불일치 테스트가 실패를 잡는다.
- 승인 관련 문서가 실제 검증 결과와 일치한다.

## C2. 사용량 회복 후 한 번 실행

### 사용자 경험

새 작업 작성 화면에서 다음 두 실행 방식을 제공한다.

```text
[지금 시작]
[한도 초기화 후 시작]
```

두 번째 방식은 Provider별 현재 사용률, 다음 5시간 초기화 예상 시각,
주간 사용률을 보여준다.

예약 카드에는 다음을 표시한다.

- Provider
- Workspace와 실행 host
- 예상 확인 시각
- 마지막 사용량 확인 시각과 상태
- `지금 시작`
- `예약 취소`

### 상태 모델

기존 DB migration 방식에 맞춰 지연 실행 레코드를 저장한다. 정확한
테이블 이름은 현재 schema와 repository 계층을 먼저 조사한 뒤 결정한다.
최소 상태는 다음과 동등해야 한다.

```text
waiting-quota
claiming
starting
started
cancelled
failed
```

필수 저장 값:

- 고유 예약 ID
- 생성할 Provider와 Workspace/host
- 원 요청과 첨부 참조
- 모델, reasoning, service tier
- 요청 및 유효 실행 권한 snapshot
- 생성 시각과 다음 확인 시각
- 선택한 기준(`next-five-hour-reset`)
- 실제 생성된 task ID
- 오류의 안전한 요약
- idempotency key

### 실행 규칙

1. 예약 생성 시 원 요청을 즉시 Provider에 보내지 않는다.
2. `resetsAt`은 예상 시각일 뿐 실행 허가로 사용하지 않는다.
3. 예상 시각 이후 최신 quota를 다시 조회한다.
4. 선택한 5시간 창이 회복되고 관측된 다른 소진 창이 없을 때만 claim한다.
5. quota가 unknown이면 제한된 backoff로 재조회하고 실행하지 않는다.
6. 주간 사용률이 높지만 소진은 아니면 경고를 남기되 정책에 따라 실행한다.
7. DB에서 `waiting-quota → claiming`을 원자적으로 전환한 한 인스턴스만
   Provider 작업을 생성한다.
8. 서버 재시작 시 `waiting-quota`를 복구하고, 오래된 `claiming`은 실제
   task 생성 여부를 대조한 뒤 한 번만 정리한다.
9. `지금 시작`은 사용자 확인 후 같은 claim 경로를 사용한다.
10. 시작·취소·실패 및 이후 질문을 Push로 알린다.

현재 `creditResumePump`와 quota cache를 재사용하되, 기존 협업·메시지
대기 의미를 바꾸지 않는다. 별도 타이머를 추가해야 한다면 하나의
bounded pump로 통합하고 중첩 실행 guard를 둔다.

### 테스트

- 미래 초기화 시각 전에는 시작하지 않음
- 시각 도달 후에도 quota가 회복되지 않으면 대기
- quota unknown이면 대기
- 실제 회복 후 한 번만 시작
- 5시간 회복, 주간 소진이면 시작하지 않음
- 서버 재시작 후 예약 복구
- 동시에 두 pump가 실행돼도 작업 하나만 생성
- 취소된 예약은 실행되지 않음
- `지금 시작`과 자동 claim 경합에서도 중복 없음
- 원래 실행 권한보다 승격되지 않음
- 다른 Provider 예약과 섞이지 않음

## C3. 죽은 작업 이어서 실행

### 대상

정상 완료, 사용자 중지, 명시적 실패 전체에 버튼을 노출하지 않는다.
Worker 프로세스 소멸, host 재부팅, 연결 단절 후 terminal reconciliation
등 **재개 가능한 중단 원인**만 분류한다.

### UX

- 상세 화면에 `이어서 실행` 버튼을 표시한다.
- 재개 전 Provider, thread ID, Workspace, 모델, 권한을 미리 보여준다.
- 기본 후속 요청에는 중단 사실과 마지막 확인 지점을 간단히 프리필한다.
- 사용자가 수정하고 확인한 뒤 공식 resume 경로를 호출한다.
- resume이 불가능하면 새 세션 생성으로 몰래 대체하지 않는다.

### 안전 규칙

- 자동 재개하지 않는다.
- 외부 소유 세션을 Claudex Workhouse 소유로 위장하지 않는다.
- 공식 Provider resume이 확인된 경우에만 제공한다.
- 원 Workspace가 없거나 다른 source task에 속하면 차단한다.
- 원 권한 snapshot을 복원하되 현재 host capability 때문에 강등되는 것은
  허용하고 UI에 표시한다.
- 중복 클릭은 같은 재개 작업 하나로 귀결돼야 한다.

### 테스트

- Worker 소멸에는 버튼 표시
- 정상 완료·사용자 중지에는 표시하지 않음
- 재시작 후에도 복구 후보 유지
- 원 thread와 Workspace를 정확히 사용
- 외부 세션 및 불명확한 thread는 차단
- idempotent resume

## C4. Codex·Claude 통합 전체 검색

구현 상태: 2026-07-29 구현. 현재 NAS SQLite 3.40.0은 FTS5가
비활성화되어 있어 `updated_at, id` 커서와 기존 task 인덱스를 사용하는
bounded candidate scan을 적용했다. 검색 경로는 제목·요청·결과·오류
열만 읽고 `log` 및 Provider transcript는 읽지 않는다. Codex 공식
`thread/search` 결과는 같은 UI 결과 모델에서 Workhouse 소유 task
결과와 병합한다.

### 검색 범위

- 세션 제목
- 최초 및 후속 사용자 요청
- 최종 결과
- 안전하게 저장된 오류
- Provider, Workspace, 상태, 날짜 필터

현재 화면에 로드된 카드만 검색하지 말고 서버의 전체 저장 이력을
검색한다. Codex 공식 검색 결과와 Workhouse 소유 task DB 검색을 하나의
UI 결과 모델로 합친다.

### 구현 원칙

- 먼저 현재 SQLite 버전과 FTS5 사용 가능 여부를 확인한다.
- FTS5가 모든 지원 환경에서 확실하지 않으면 인덱스가 있는 bounded
  LIKE 검색으로 시작한다.
- 결과에 source, provider, task/thread ID와 match snippet을 포함한다.
- 검색어가 있는 출력 카드 또는 해당 turn으로 바로 이동한다.
- 커서 페이지네이션과 최대 결과 수를 둔다.
- transcript 전체를 매 검색마다 모두 읽지 않는다.

### 테스트

- 페이지에 로드되지 않은 오래된 Claude 작업 검색
- Codex와 Claude 결과 병합 및 안정된 정렬
- Workspace/Provider 필터
- 특수문자와 한국어 검색
- 검색 결과에서 정확한 출력 카드로 이동
- 대량 이력에서 bounded query 유지

위 항목은 단위·SQLite 통합·브라우저 fixture로 고정한다. 실제 FTS5
경로는 현재 지원 환경에서 사용할 수 없으므로 구현하지 않았다.

## C5. 프롬프트 프리셋 서버 동기화

- `deck-prompt-presets` localStorage 구조를 조사한다.
- 기존 `system_settings` 저장소를 사용해 단일 사용자 프리셋을 저장한다.
- GET/PUT API에 schema validation, 크기·개수 제한, idempotency를 둔다.
- 최초 접속 시 localStorage 프리셋을 서버로 한 번 이전한다.
- 서버와 로컬 양쪽에 값이 있으면 자동 덮어쓰지 말고 병합 미리보기 또는
  명확한 최신값 규칙을 사용한다.
- 내장 프리셋과 사용자 프리셋을 분리한다.
- PC, 휴대폰, 태블릿에서 같은 값이 보이는지 테스트한다.

구현 상태 (2026-07-29):

- 사용자 프리셋은 `system_settings`의 version 1 값으로 저장하며, 최대
  20개, 이름 40 Unicode 문자, 요청 4,000 Unicode 문자로 제한한다.
- 최초 서버 값이 비어 있고 서버 snapshot이 없는 기기는 기존
  `deck-prompt-presets`를 한 번 업로드한다. 서버와 로컬이 모두 변경된
  경우에는 compare-and-swap이 자동 덮어쓰기를 막고 병합 미리보기를
  표시한다.
- 병합은 마지막 서버 snapshot을 기준으로 양쪽 삭제를 보존하고, 같은
  ID가 양쪽에서 수정된 경우 서버 값을 유지한다. 20개를 넘는 병합
  제외 항목과 삭제로 제외되는 항목 수를 저장 전에 표시한다.
- 응답이 유실된 PUT만 같은 idempotency key로 한 번 재전송한다. 서버가
  이미 저장했다면 GET으로 결과를 회수하며, HTTP 실패 key는 다음
  시도에 재사용하지 않는다.
- 손상된 저장값은 schema에 맞는 고유 항목만 CAS로 복구하고 audit에
  기록한다. 덮어쓰기 전 원본과 원래 revision은 별도 system setting에
  백업한다. 내장 프리셋은 서버 사용자 값과 계속 분리한다.
- 4,000 Unicode 문자를 넘는 요청은 무음 절단하지 않고 저장을 거절해
  안내한다. 실패한 자동 업로드는 충돌 선택 중에는 반복하지 않고 짧은
  cooldown을 둔다.
- 독립 브라우저 컨텍스트의 데스크톱, 휴대폰, 태블릿 fixture에서 최초
  이전 1회, 충돌 병합, 열린 기기 재동기화, HTTP 500의 새 key 재시도,
  PUT 응답 유실의 동일 key 회수를 검증한다.

## C6. 모바일 공유와 PR 생성

### C6-1. 모바일 공유 대상

- PWA manifest에 지원 가능한 `share_target`과 새 작업 shortcut을 추가한다.
- 링크와 짧은 텍스트를 새 작업 작성 화면에 프리필한다.
- 이미지·파일은 기존 업로드 제한과 저장 정책을 그대로 사용한다.
- 공유를 받았다는 이유만으로 작업을 자동 실행하지 않는다.
- entry URL과 임시 payload가 로그나 외부 referrer에 민감정보를 남기지
  않게 한다.

### C6-2. PR 생성

- GitHub CLI의 기존 인증 및 현재 Workspace Git 상태를 재사용한다.
- 현재 branch, base branch, upstream, push 상태를 먼저 검증한다.
- `TaskOutcomeSummary`를 제목과 본문 초안으로 사용하되 사용자가 편집할
  수 있게 한다.
- 실제 `gh pr create` 직전 명시적 확인을 받는다.
- 성공 시 PR URL을 저장하고 바로 열 수 있게 한다.
- PR 수정, 리뷰, 병합, force push는 이번 범위에서 제외한다.

구현 상태 (2026-07-29):

- manifest의 `share_target`은 OS의 multipart POST를 `/api/share-target`에서
  받고, 서버가 생성한 불투명한 1회용 token만 entry URL에 남긴다. 제목,
  텍스트, URL, 기존 허용 형식의 첨부 파일은 새 작업 작성 화면에
  프리필되며 자동 실행하지 않는다.
- share POST는 same-origin 요청 또는 브라우저가 OS 공유 탐색으로
  표시하는 document navigation만 허용한다. 소비되지 않은 payload가
  만료되면 첨부 파일도 제거하고, 소비된 첨부는 기존 7일 정리 정책을
  따른다.
- 완료된 Workhouse 작업에만 PR 동작을 노출한다. 현재 branch와 upstream,
  push 상태, GitHub CLI 인증, GitHub remote, open PR, 사용자가 편집한
  base branch를 실행 호스트에서 다시 검증한다.
- PR 제목과 본문은 완료 요약으로 초안을 만들지만 편집 가능하다. 별도
  확인 checkbox와 서버의 literal confirmation을 모두 통과해야
  `gh pr create`를 호출한다. 같은 작업의 동시 생성은 서버 lock과
  idempotency key로 막고 성공 URL을 task metadata와 audit에 저장한다.
- 숫자로만 된 branch도 PR 번호로 오인하지 않도록 기존 PR 탐색은
  `gh pr list --head ... --state open` 계약으로 고정했다. PR 생성 자체가
  push, merge, review, force push를 수행하지 않는다.
- 단위 fixture는 OS 공유 탐색 분류, manifest 계약, 공유 초안 변환,
  가짜 `gh` 실행 파일을 사용한 GitHub preflight/생성 인자와 Worker
  command 등록을 검증한다. 모바일 Playwright fixture는 공유 초안과
  명시적 PR 확인 UI를 검증한다.

## C7. Windows 단일 EXE

`docs/windows-portable-server-plan.md`의 단계 0부터 순서대로 진행한다.
앞 단계의 신뢰성 기능을 Windows에서도 동일하게 유지해야 한다.

현재 단계 1~8의 구현 코드와 Linux-hosted 계약 fixture는 준비됐지만,
단계 0의 실제 서명 수단과 Windows 실기 릴리스 gate가 충족되지 않았다.
따라서 Windows main server는 아직 supported/stable로 표시하지 않는다.

특히 다음을 선행 조건으로 취급한다.

- `private: true` 버전 상한 `1.0.0`
- 지원 Windows와 CPU 범위 확정
- Authenticode와 release manifest 결속
- 앱 코드와 변경 가능한 data root 분리
- Python SQLite worker 대체
- `/proc`, `flock`, `bwrap`, Unix 경로 전제 제거
- 로컬 실행기 자동 등록
- 단일 인스턴스와 포트 충돌 진단
- Provider 설치·로그인 상태 진단

Windows 작업은 위 계획서의 커밋 경계와 검증 기준을 중복 작성하지 않고
그 문서를 따른다.

## 6. 권장 작업 순서와 커밋 경계

각 단계는 독립적으로 검증 가능한 작은 커밋 후보로 유지한다. 실제
commit과 push는 사용자의 명시적 요청이 있을 때만 수행한다.

1. `fix: deliver user-input push notifications`
2. `test: verify browser approval round trips`
3. `docs: align implemented feature limitations`
4. `feat: defer tasks until provider quota resets`
5. `feat: resume tasks interrupted by worker loss`
6. `feat: search Codex and Claude history together`
7. `feat: sync prompt presets across devices`
8. `feat: accept mobile shares as task drafts`
9. `feat: create pull requests from completed work`
10. Windows 계획서의 C0~C7 커밋 경계

한 세션에서 전부 구현하려 하지 않는다. 최소한 C1, C2, C3은 각각
별도의 구현·검증 단위로 취급한다.

## 7. 공통 검증

각 단계에서 관련 단위·통합 테스트를 먼저 실행하고, 단계 완료 전 다음을
실행한다.

```sh
cd /srv/claudex-workhouse/app
pnpm run check
pnpm test
pnpm run build
```

UI, Push, PWA, 모바일 동작을 바꾼 단계에서는 관련 Playwright 테스트를
추가한다. NAS에 필요한 브라우저 라이브러리가 없으면
`docs/testing.md`의 Docker E2E 경로를 사용하고, 실행하지 못한 검사를
통과했다고 보고하지 않는다.

추가 확인:

- `git diff --check`
- 기존 dirty worktree 보존
- Linux/NAS 부팅과 `/api/health/live`, `/api/health/ready`
- SSE 재연결과 진행 중 작업 보존
- Provider별 실행 정책 snapshot
- 원격 Desktop Worker 경로의 프로토콜 호환
- 서비스 재시작이 외부 작업을 잘못 중지하지 않는지 확인

## 8. 완료 보고 형식

각 단계의 최종 보고에는 다음을 포함한다.

1. 구현한 단계와 제외한 단계
2. 수정 파일 목록
3. 상태 저장 방식과 재시작 복구 방식
4. 중복 실행 방지 방식
5. 권한과 Provider 경계 보존 방식
6. 추가·수정한 테스트
7. 실제 실행한 검증과 결과
8. 남은 제한과 다음 권장 단계
9. commit/push를 요청받았다면 branch, SHA, remote와 남은 변경

## 9. 첫 구현 세션 기록

이 절은 로드맵 작성 당시의 첫 구현 범위를 보존한 기록이다. C1은 이후
구현·검증됐으며 현재 상태는 5절의 구현 현황 표를 따른다.

1. `user-input` Push 누락을 고친다.
2. 서버와 Service Worker Push 종류 계약 테스트를 추가한다.
3. 승인 왕복의 현재 검증 범위를 조사하고 가능한 fixture 테스트를 보강한다.
4. 검증 결과에 맞게 `known-limitations.md`와 HTML 미리보기 계획 상태를
   정리한다.
5. 전체 unit test, typecheck, build를 실행한다.

C2 이후 기능은 C1 검증이 끝난 뒤 각각 별도 구현·검증 단위로 진행됐고,
현재 C2~C6 자동화 범위와 C7 잔여 gate는 5절에 기록한다.
