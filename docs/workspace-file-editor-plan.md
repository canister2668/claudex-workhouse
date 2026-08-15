# Claudex Workhouse 작업 파일 뷰어·편집기 도입 계획

상태: 구현·배포 완료 — Claude 최종 승인 반영 (2026-07-22)

## 1. 목표

세션이 바꾼 파일을 대화 화면에서 바로 열어 읽고, 필요한 경우 작은 수정까지 한 뒤 안전하게 저장할 수 있게 한다.

이 기능은 IDE를 새로 만드는 일이 아니다. 기존 `WorkspaceViewer`, Git 변경 목록, 세션 재개 기능을 서로 연결하고, 기존 파일 한 개를 수정하는 최소 저장 경로만 추가한다.

핵심 사용자 흐름은 다음과 같다.

1. 세션 결과의 `변경된 파일`을 누른다.
2. 해당 파일이 작업공간 뷰어에서 바로 열린다.
3. 읽기, diff 확인 또는 편집을 선택한다.
4. 파일이 편집 시작 이후 바뀌지 않았다면 즉시 저장한다.
5. 다른 주체가 같은 파일을 바꿨다면 덮어쓰지 않고 비교 화면을 보여준다.
6. 사용자가 최신본 유지, 내 편집본으로 덮어쓰기, 직접 합치기 또는 관련 세션 열기 중 하나를 고른다.

## 2. 제품 원칙

- 알잘딱 우선: 정상적인 기존 파일 저장에는 추가 승인, 권한 선택, 저장 위치 질문을 끼워 넣지 않는다.
- 최소 권한: 새 전역 권한, 별도 파일 편집 권한, 에이전트 권한 승격, 작업공간 쓰기 lease를 만들지 않는다.
- 사람 편집과 에이전트 실행 권한은 분리한다. 로그인한 사용자의 UI 저장은 현재 Claudex Workhouse 인증과 등록된 작업공간 경계만 따른다.
- 충돌은 권한 문제가 아니라 버전 문제로 처리한다. 활성 세션이 있다는 이유만으로 편집이나 저장을 막지 않는다.
- 자동 덮어쓰기는 하지 않는다. 충돌 때만 손실 내용을 보여주고 사용자 판단을 받는다.
- 관련 세션을 열 수는 있지만 메시지를 자동 전송하거나 세션 권한을 바꾸지 않는다.
- 첫 버전은 기존 UTF-8 텍스트 파일 한 개의 수정에 집중한다. 파일 생성, 이름 변경, 이동, 삭제, 폴더 조작은 넣지 않는다.
- 로컬 NAS와 Desktop Worker가 같은 계약으로 동작해야 한다.

### 확정 선택

- 편집 상한은 256 KiB로 한다. 1 MiB Worker 메시지 상한을 키우거나 별도 전송 프로토콜을 만들지 않는다.
- 충돌 응답은 최신 파일 본문이나 revision을 싣지 않고 `FILE_VERSION_CONFLICT` 코드만 반환한다. 클라이언트가 편집용 읽기를 다시 호출한다.
- `.git/**`은 resolve와 쓰기 양쪽에서 차단한다. 작업공간 루트의 일반 파일인 `.gitignore`는 허용한다.
- 민감 파일은 MVP에서 읽기 전용으로 유지한다.
- 초안은 브라우저 메모리에만 유지하며 새로고침 뒤까지 저장하지 않는다.
- 원본의 CRLF/LF, UTF-8 BOM, 파일 끝 개행 유무를 저장 때 복원한다.

## 3. 현재 자산과 재사용 범위

이미 있는 기능을 그대로 기반으로 삼는다.

- `WorkspaceViewer.svelte`: 작업공간 탐색, 파일 읽기, 민감 파일 확인, 바이너리 거부, Git diff 표시, 모바일 전체 화면 UI
- `Conversation.svelte`: 세션 이벤트에서 변경 파일 경로와 추가·삭제 줄 수 집계
- `GitWorkspacePanel.svelte`: 현재 Git 변경 파일과 파일별 diff
- `host-workspaces.ts`와 Desktop Worker의 `workspaces.ts`: 서명된 파일 ID, 작업공간 포함 관계 확인, 심볼릭 링크 차단, 파일 크기 제한
- `App.svelte`: 현재 세션 열기·재개와 작업공간 뷰어 열기

새 기능은 이 경계를 우회하지 않고 확장한다.

## 4. 화면 흐름

### 4.1 세션에서 파일 열기

`Conversation`의 변경 파일 칩을 버튼으로 바꾼다. 클릭하면 `App`이 현재 세션의 `workspaceId`, `taskId`, 이벤트 경로와 경로 기준 정보를 함께 넘겨 `WorkspaceViewer`를 연다.

현재 변경 파일 이벤트의 경로는 작업공간 루트가 아니라 세션 cwd 기준일 수 있다. 새 이벤트에는 절대 경로 대신 `pathBase: "task-cwd" | "workspace" | "unresolved"`를 함께 기록한다. 실제 보정은 로컬 경로 숨김 설정의 영향을 받지 않도록 브라우저가 아니라 서버가 수행한다.

세션 칩의 resolve 요청은 `sourceTaskId`를 함께 보내고, 서버가 task·workspace·host 관계를 먼저 확인한다. 로컬 경로는 NAS가 해석하고 원격 경로는 Desktop Worker가 해당 task의 cwd와 네이티브 경로 규칙으로 해석한다. NAS에서 Windows 경로를 임의 변환하지 않는다. task가 다른 workspace에 속하거나 cwd·경로가 workspace 밖이면 거부한다. 기존 이벤트가 basename만 보존했거나 `pathBase`가 없어 정확히 해석할 수 없으면 같은 이름의 파일을 추측하지 않는다. 해당 칩은 비활성화하고 작업공간 루트를 여는 동작만 제공한다.

중첩 폴더 파일을 바로 열 수 있도록 작업공간 내부 상대 경로를 서명된 파일 ID로 바꾸는 resolve API를 추가한다. 클라이언트가 임의의 절대 경로를 만들거나 서버 경로를 받지 않는다.

세션에서 연 뷰어에는 `관련 세션 열기` 버튼을 표시한다. 이 버튼은 뷰어를 닫고 원래 세션으로 돌아간다. 실행 중인 세션이어도 단순히 화면만 열며 메시지를 큐에 넣지 않는다.

작업공간 설정이나 Git 패널에서 직접 연 경우에는 같은 `workspaceId`를 가진 세션 목록을 보여주되 자동으로 하나를 고르지 않는다. 사용자가 선택한 세션만 연다.

### 4.2 보기와 편집

기본은 지금과 같은 읽기 모드다. 편집 가능한 파일에만 `편집` 버튼을 표시한다.

편집 모드는 새 대형 IDE 라이브러리 없이 지연 없이 뜨는 기본 `<textarea>`로 시작한다.

- 고정폭 글꼴, 줄 바꿈 선택, Tab 들여쓰기, 저장/취소 제공
- 편집 중인 파일명과 `저장되지 않음` 상태를 항상 표시
- 닫기, 다른 파일 선택, 뒤로 가기 시 초안이 바뀌었으면 한 번만 확인
- 모바일에서는 파일 목록을 접고 편집 영역과 저장 버튼을 우선 표시
- 저장 성공 후 읽기 모드와 Git 상태/diff를 새로 고침

Monaco 같은 무거운 편집기는 도입하지 않는다. 실제 사용에서 다중 커서, 코드 완성 같은 요구가 확인되면 CodeMirror 계열을 별도 단계로 검토한다.

### 4.3 편집 가능 범위

첫 버전의 편집 조건은 다음과 같다.

- 이미 존재하는 일반 파일
- 유효한 UTF-8 텍스트
- 최대 256 KiB
- 작업공간 내부의 실제 경로이며 심볼릭 링크가 아님
- 민감 파일명 규칙에 걸리지 않음
- `.git/**` 경로가 아님

바이너리, 256 KiB 초과 파일, 디코딩이 불완전한 파일, 민감 파일은 계속 읽기 전용이다. 민감 파일은 기존 확인 후 열람 흐름은 유지하지만 첫 버전에서 편집하지 않는다. 이는 별도 권한을 추가하기 위한 것이 아니라 실수로 비밀 값을 덮어쓰는 범위를 MVP에서 제외하기 위한 제한이다.

`.git/**`은 파일 목록에서 숨기는 데 그치지 않고 resolve와 write에서 명시적으로 거부한다. `.git/hooks`를 편집해 이후 Git 실행에 코드를 끼우는 경로를 막기 위한 기존 작업공간 경계의 보강이다.

## 5. 저장과 충돌 처리

### 5.1 버전 토큰

편집용 읽기 응답은 다음 값을 돌려준다.

```ts
type EditableWorkspaceFile = {
  fileId: string;
  relativePath: string;
  content: string;
  byteLength: number;
  modifiedAt: string;
  revision: string; // 전체 원본 바이트의 SHA-256
  lineEnding: "lf" | "crlf";
  hasUtf8Bom: boolean;
  endsWithNewline: boolean;
};
```

브라우저는 편집 시작 시의 `content`, 작업공간 상대 경로와 `revision`을 메모리에 보관한다. 서명된 `fileId`는 서버 프로세스가 재시작되면 무효가 될 수 있으므로 초안의 영구 식별자로 쓰지 않는다. 서버는 저장 시 파일 전체를 다시 읽어 현재 SHA-256을 계산한다.

`<textarea>`가 줄바꿈을 LF로 정규화하므로, 저장 직전에 원본 `lineEnding`, BOM, 파일 끝 개행 유무를 다시 적용한다. 혼합 개행처럼 손실 없이 왕복할 수 없는 파일은 MVP에서 읽기 전용으로 처리한다.

### 5.2 정상 저장

```ts
type WorkspaceFileWriteRequest = {
  fileId: string;
  content: string;
  expectedRevision: string;
  expectedCurrentRevision?: string;
};
```

- 클라이언트는 저장 직전에 workspace ID와 상대 경로로 resolve를 다시 호출해 현재 프로세스에서 유효한 `fileId`를 발급받는다.
- 현재 파일 revision이 `expectedRevision`과 같으면 저장한다.
- 같은 디렉터리에 사용자 전용 임시 파일을 만들고 원래 파일 모드를 유지해 쓴다.
- 임시 파일 쓰기와 flush가 끝난 뒤 원자적으로 교체한다.
- 교체 직전 파일 ID, 작업공간 포함 관계, 일반 파일 여부, 심볼릭 링크 여부와 revision을 다시 확인한다.
- 성공하면 새 revision과 modified time을 반환하고 Git 상태를 갱신한다.
- 저장 행위는 기존 감사 로그에 작업공간 ID, 상대 경로, 이전/이후 revision, 바이트 수만 남긴다. 파일 내용은 로그에 남기지 않는다.

Idempotency-Key는 기존 mutation API처럼 사용한다. 동일 네트워크 요청의 재시도에는 같은 키를 쓰고, 충돌 확인 뒤 사용자가 다시 저장하는 새 시도에는 새 키를 발급한다. 재시도 때문에 같은 내용이 중복 저장되거나 이전 409 결과가 새 저장에 재사용되지 않게 한다.

### 5.3 충돌 응답

현재 revision이 다르면 서버는 `409 FILE_VERSION_CONFLICT`를 반환한다. 응답에 최신 본문이나 revision을 싣지 않고, 브라우저는 Idempotency-Key가 필요 없는 편집용 읽기 API를 다시 호출해 최신 내용을 가져온다.

충돌 화면에는 다음 세 자료를 구분해 보여준다.

- 편집 시작본
- 디스크 최신본
- 사용자의 현재 편집본

단순한 예/아니오 확인창으로 끝내지 않는다. 최소한 변경 줄 수와 각 본문의 비교 탭을 보여줘 무엇이 사라질지 확인할 수 있게 한다.

사용자 선택은 다음과 같다.

1. `최신본 사용`: 내 초안을 버리고 최신본을 편집기에 적용한다.
2. `직접 합치기`: 최신본과 내 편집본을 나란히 보면서 편집을 계속한다.
3. `관련 세션 열기`: 초안을 브라우저에 유지한 채 해당 세션 화면을 연다. 메시지는 자동 전송하지 않는다.
4. `내 편집본으로 덮어쓰기`: 마지막 선택지로 배치하고, 손실 대상을 다시 명시한 뒤 저장한다.

덮어쓰기도 무조건 force하지 않는다. 충돌 화면에서 확인한 최신 revision을 `expectedCurrentRevision`으로 함께 보내고, 서버가 그 revision과 아직 같을 때만 교체한다. 그 사이 파일이 또 바뀌었으면 다시 409를 반환해 최신 상태를 재확인하게 한다.

### 5.4 활성 세션과의 관계

같은 작업공간에 에이전트가 실행 중이면 편집기 상단에 `세션이 이 작업공간을 수정 중`이라는 정보만 표시한다.

- 편집 진입을 막지 않는다.
- 별도 승인이나 권한 변경을 요구하지 않는다.
- Claudex Workhouse workspace lease를 사람이 가져오지 않는다.
- 실제 경합은 revision 비교로만 판정한다.

이렇게 해야 에이전트가 다른 파일을 수정 중인 상황까지 불필요하게 충돌로 취급하지 않는다.

## 6. API 계약

추가할 API는 세 개로 제한한다.

### 경로 확인

`POST /api/workspaces/:workspaceId/files/resolve`

```json
{ "path": "app/src/web/App.svelte", "pathBase": "workspace" }
```

세션 이벤트에서 여는 경우:

```json
{ "path": "src/web/App.svelte", "pathBase": "task-cwd", "sourceTaskId": "task-id" }
```

상대 경로만 받고, `task-cwd` 기준이면 source task가 해당 workspace에 속하는지 먼저 확인한다. 그 뒤 기존 `localWorkspacePath`와 동일한 포함 관계·심볼릭 링크 검증 후 서명된 파일 ID와 workspace 기준 상대 경로를 반환한다. `.git/**`은 거부하고 존재하지 않는 경로는 구조화된 404로 반환한다.

### 편집용 전체 읽기

`POST /api/workspaces/:workspaceId/files/edit/read`

```json
{ "fileId": "signed-entry-id" }
```

UTF-8과 256 KiB 제한을 확인하고 전체 내용과 revision, 개행/BOM/끝 개행 정보를 반환한다. 기존 chunk viewer API는 바꾸지 않는다. 최신 내용 조회가 캐시에 막히지 않도록 이 읽기 API에는 idempotency 캐시를 적용하지 않는다.

### 저장

`PUT /api/workspaces/:workspaceId/files/write`

정상 저장과 재확인 덮어쓰기에 동일한 CAS 계약을 사용한다. 256 KiB 본문의 JSON 이스케이프 여유만큼 라우트 body limit를 제한적으로 올리고 전역 body limit와 1 MiB Worker 메시지 상한은 바꾸지 않는다. 쓰기 API에만 Idempotency-Key를 요구한다.

세 API 모두 로컬 구현과 Worker command를 같은 입력·응답 형태로 제공한다. Worker는 `FILE_VERSION_CONFLICT` 같은 오류 코드를 그대로 전송하고, Claudex Workhouse 서버는 해당 코드를 409로 매핑한다. 원격 오류가 일반 500이나 `WORKSPACE_OPERATION_FAILED`로 뭉개지지 않게 프로토콜의 허용 오류 코드를 명시한다.

## 7. 세션 연결 설계

새로운 파일-세션 추적 테이블은 첫 버전에 만들지 않는다.

- 세션 대화의 변경 파일 이벤트에서 열면 현재 `taskId`가 정확한 출처다. 이벤트의 `pathBase`와 source task의 서버 저장 cwd로 workspace 상대 경로를 보정 가능한 경우에만 파일을 바로 연다.
- Git 패널이나 작업공간 설정에서 열면 이미 로드된 task 목록을 `workspaceId`로 필터링해 선택지를 만든다.
- 동일 thread의 여러 task가 있으면 현재 세션 브라우저와 같은 규칙으로 최신 대표 항목을 보여준다.
- 출처가 불분명할 때 최근 항목 하나를 임의 선택하지 않는다.

향후 여러 에이전트가 같은 파일을 연속 수정한 주체까지 표시할 필요가 생기면 감사 로그와 파일 변경 이벤트를 바탕으로 provenance 저장을 별도 설계한다. MVP 저장 경로에 이 데이터 모델을 억지로 넣지 않는다.

## 8. 권한과 보안 경계

추가하지 않는 것:

- 파일 편집 전용 글로벌 permission
- 매 저장 시 승인 팝업
- 에이전트의 `permissionProfile` 변경
- danger/full-access 요구
- OS 전체 경로 접근
- 작업공간 write lease 획득
- 세션 자동 재개 또는 메시지 자동 전송

필요한 기존 경계만 사용한다.

- Claudex Workhouse API 인증을 통과한 사용자
- 등록된 workspace ID
- HMAC으로 서명된 파일 ID
- 작업공간 내부 realpath 확인
- 심볼릭 링크와 바이너리 차단
- 파일 크기와 UTF-8 검증
- 저장 직전 revision 재확인
- mutation rate limit, Idempotency-Key, 감사 로그
- `.git/**` 쓰기 차단과 원격 오류 코드 보존

즉, 사용자는 정상 저장을 자연스럽게 수행하고 서버는 경로 이탈과 경합만 막는다.

## 9. 예상 코드 변경

### 서버

- `app/src/server/host-workspaces.ts`
  - 상대 경로 resolve
  - UTF-8 편집용 전체 읽기와 revision 계산
  - CAS 및 원자 교체 저장
- `app/src/server/diff.ts`와 파일 변경 이벤트 생성부
  - 새 이벤트에 절대 경로 없이 `pathBase`와 해석 가능 여부 기록
  - 기존 basename 폴백을 파일 열기 근거로 사용하지 않도록 구분
- `app/src/server/desktop-worker/workspaces.ts`
  - 로컬과 동일한 resolve/read/write Worker command
- `app/src/server/index.ts`
  - 세 API, Zod 입력 제한, route body limit, 오류 코드, 감사 로그
- `app/src/server/worker-protocol.ts`
  - 새 Worker command 계약, 허용 목록, 충돌 오류 코드 전달
- `app/src/server/worker-hub.ts`
  - Worker 충돌 코드의 HTTP 409 매핑
- `app/src/server/desktop-worker/client.ts`
  - 파일 충돌 코드를 일반 workspace 오류로 뭉개지 않고 전달

### 웹

- `app/src/web/WorkspaceViewer.svelte`
  - initial path 열기, 편집 모드, dirty guard, 저장, 충돌 화면, 관련 세션 버튼
- `app/src/web/Conversation.svelte`
  - 변경 파일 칩을 열기 동작이 있는 버튼으로 변경
- `app/src/web/GitWorkspacePanel.svelte`
  - 변경 파일에서 뷰어로 이동하는 연결 제공
- `app/src/web/App.svelte`
  - 뷰어 컨텍스트에 workspace/event path/path base/source task/관련 세션 전달
  - 뷰어에서 세션 열기 이벤트 처리
- `app/src/web/workspace-viewer-state.ts`
  - 편집 가능 판정, dirty 상태, CAS 충돌 상태를 순수 함수로 분리
- `app/src/web/i18n/{ko,en,ja}.ts`
  - 보기·편집·충돌·세션 이동 문구 다국어화

`api-client.ts`는 이미 오류의 `code`, HTTP status와 details를 보존하므로 변경 대상에서 제외한다. 새 편집기 패키지와 새 데이터베이스 테이블은 추가하지 않는다.

## 10. 구현 순서

### 1단계 — 서버 저장 기반

- resolve, 편집용 읽기, revision, 원자 저장 구현
- `.git/**`, invalid UTF-8, 혼합 개행 차단과 BOM/개행 보존 구현
- 로컬/Worker parity와 Worker 오류 code→HTTP 409 매핑 구현
- 경로, 링크, UTF-8, 크기, CAS 단위·통합 테스트

### 2단계 — 뷰어 편집

- 읽기 모드에서 편집 진입
- 저장/취소/dirty guard
- 충돌 비교와 재확인 덮어쓰기
- 모바일 편집 레이아웃

### 3단계 — 세션과 Git 연결

- 대화 변경 파일 칩에서 바로 열기
- Git 변경 파일에서 열기
- 원래 세션 복귀와 작업공간 관련 세션 선택
- 활성 세션 안내와 초안 유지

### 4단계 — 검증과 배포

- 전체 단위·통합 테스트
- `pnpm run check`
- `pnpm run build`
- 모바일 Playwright로 파일 열기, 편집, 충돌, 세션 복귀 확인
- Web만 재시작하고 health endpoint 확인

## 11. 필수 테스트

### 서버

- 정상 revision 저장과 새 revision 반환
- 편집 시작 후 외부 변경 시 409
- 확인한 최신 revision 이후 다시 변경되면 덮어쓰기 재거부
- 같은 Idempotency-Key 재시도 안정성
- 충돌 뒤 새 저장 시도는 새 Idempotency-Key를 사용해 이전 실패 캐시가 재사용되지 않음
- `..`, 절대 경로, 다른 workspace의 file ID, 변조된 file ID 거부
- 존재하지 않는 resolve 경로는 404, `.git/**`은 거부
- 파일과 상위 경로의 심볼릭 링크 거부
- 저장 확인과 교체 사이 identity/revision 변경 거부
- 바이너리, invalid UTF-8, 256 KiB 초과, 민감 파일 쓰기 거부
- 파일 모드, CRLF/LF, UTF-8 BOM, 파일 끝 개행 유지
- 서버 재시작으로 이전 file ID가 무효가 되어도 상대 경로 재-resolve 후 저장 가능
- Worker의 1 MiB 프레임 상한을 넘지 않고 충돌이 로컬과 동일한 409로 전달됨
- 임시 파일 실패 시 원본 유지 및 임시 파일 정리
- 원격 Worker에서 동일 결과

### 웹

- 세션 변경 파일 클릭 시 중첩 경로 파일이 바로 열림
- 세션 cwd와 workspace 루트가 다를 때 서버 경로 보정, 로컬 경로 숨김 상태에서도 동일 동작
- source task와 workspace 불일치 또는 해석 불가 이벤트는 추측 없이 폴백
- 변경 없는 저장은 추가 질문 없이 완료
- dirty 상태에서 닫기/파일 이동만 확인
- 충돌 시 세 본문과 네 선택지가 표시됨
- 덮어쓰기 직전 재경합이 생기면 다시 비교 상태로 돌아감
- 관련 세션을 열어도 메시지가 전송되지 않음
- 세션에서 돌아와도 브라우저 메모리의 초안 유지
- 모바일에서 저장·취소·충돌 선택지가 가려지지 않음
- 한국어·영어·일본어 문구 누락 없음

## 12. 완료 기준

- 세션 변경 파일을 두 번 이내의 동작으로 열 수 있다.
- 충돌이 없으면 별도 승인 없이 저장된다.
- 외부 변경을 조용히 덮어쓰는 경로가 없다.
- 명시적 덮어쓰기도 사용자가 확인한 최신 revision에 대해서만 성공한다.
- 활성 세션 때문에 무관한 파일 편집이 막히지 않는다.
- 세션 열기 기능이 화면 이동만 수행하고 자동 메시지·권한 변경을 하지 않는다.
- 로컬과 원격 Worker의 편집 계약과 오류 코드가 같다.
- 새 전역 권한, full-access 요구, workspace lease, 대형 편집기 의존성이 없다.

## 13. Claude 검토 결과

Claude의 첫 판단은 `조건부 승인`이었다. 새 권한 축을 만들지 않고 기존 인증·workspace 경계와 CAS만 사용하는 방향, 활성 세션을 이유로 편집을 차단하지 않는 방향, 재확인 덮어쓰기의 이중 CAS와 세션 화면 이동만 제공하는 방향은 유지 판정을 받았다.

조건은 모두 이 최종본에 반영했다.

- Worker 1 MiB 메시지 한도를 건드리지 않도록 편집 상한을 256 KiB로 축소
- Worker 충돌 오류 code→HTTP 409 parity 명시
- 재시작 후 무효가 되는 서명 file ID 대신 상대 경로를 초안 식별자로 유지하고 저장 직전 재-resolve
- 세션 cwd 기준 변경 경로를 서버에서 workspace 기준으로 보정하고 해석 불가 시 추측 금지
- `.git/**` resolve/write 차단
- 충돌 후 읽기에 idempotency 캐시 미적용
- 원본 개행, UTF-8 BOM과 파일 끝 개행 보존
- 존재하지 않는 resolve 경로의 404 처리
- 이미 구조화된 오류를 보존하는 `api-client.ts` 변경 제거

반영 요약을 같은 Claude 스레드에서 다시 확인한 결과 `최종 승인`을 받았다. Claude는 9개 필수 항목이 모두 대응됐고, 새 permission·매 저장 승인·full-access·workspace lease 없이 기존 인증·workspace 경계·CAS만 쓰는 설계가 유지됐다고 판단했다.

## 14. 구현 결과

- 로컬 NAS와 Desktop Worker에 동일한 resolve/read/write 계약과 오류 매핑을 구현했다.
- UTF-8 텍스트 256 KiB 상한, 민감 파일·`.git/**`·심볼릭 링크 차단, CAS 충돌 재확인, 원본 BOM·개행 형식 보존을 적용했다.
- 세션 변경 파일과 Git 변경 파일에서 뷰어를 열고, 기본 textarea 편집·메모리 초안·충돌 비교·관련 세션 이동을 제공한다.
- Codex 전용 세션 화면에도 source task와 workspace 문맥을 전달해 task-cwd 경로를 안전하게 연다.
- 전체 Vitest 88개 파일·437개 테스트, 최종 관련 테스트 5개 파일·13개 테스트, Svelte/TypeScript check, production build, mobile-360 Playwright를 통과했다.
- Claudex Workhouse Web을 재시작했고 Worker는 건드리지 않았다. health 응답에서 앱, WAL DB, Codex, Claude가 모두 정상임을 확인했다.
