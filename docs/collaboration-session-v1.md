# CollaborationSession v1

Claudex Workhouse의 협업 세션은 기존 `DeckTask`와 실제 Claude session/Codex thread 위에 놓이는 orchestration wrapper다. 기존 단독 세션 API와 데이터 의미는 바꾸지 않는다.

## 구조

- `CollaborationSession`: 모드, 전체 단계, 호출 한도, timeout, controller generation과 전체 결과를 관리한다.
- `CollaborationParticipant`: Claude/Codex 각각의 host, workspace, 권한, 실제 provider session ID와 독립 상태를 보관한다.
- `CollaborationRun`: 한 번의 실제 `DeckTask` 실행을 가리킨다. generation이 다른 늦은 이벤트는 상태 전이에 사용하지 않는다.
- `CollaborationMessage`: 사용자 입력, 시스템 상태, relay와 provider task 참조만 저장한다. provider transcript 본문은 복제하지 않는다.
- `RelayArtifact`: 다른 provider에 전달한 정확한 입력의 0600 불변 사본이다. 본문은 audit/SSE에 넣지 않으며 checksum으로 검증한다.
- `collaboration_workspace_leases`: SQLite `BEGIN IMMEDIATE` transaction에서 writer 충돌을 검사하고 획득한다. heartbeat는 run ID와 lease generation이 모두 맞아야 한다.

실행은 `CollaborationTransport`가 기존 `AgentProvider` 또는 Remote Worker의 `provider.task.*` / `provider.session.resume` typed command를 선택한다. orchestrator가 CLI, app-server, shell을 직접 실행하지 않는다.

## 모드

- 독립검토(내부 mode `parallel`): Claude와 Codex가 상대 의견을 받지 않은 채 같은 원본을 읽기 전용으로 동시에 검토하고, 모두 terminal이 될 때 fan-in한다. 총 2회 호출이며 한 공급자 실패는 다른 공급자를 중지하지 않는다.
- 교차검토(내부 mode `review`): 두 모델의 독립검토가 모두 완료된 뒤에만 결과를 교환하고, 각 모델이 상대 지적을 원본과 다시 대조한다. 기본은 검토 4회, 심층은 6회다. `primary` 최종 정리를 선택하면 주 모델의 통합 정리 1회를 더하며, `side-by-side`와 `raw`는 추가 호출이 없다. 모든 참가자는 읽기 전용이다.
- Assist: 기존 완료 단독 세션을 Primary로 연결하고 상대 provider의 새 read-only session을 한 번 실행한다. wrapper는 기본 목록에 올리지 않고 원본 작업에 badge와 내장 타임라인으로 표시한다. 원 세션 전달은 별도 명시 mutation이다.
- Debate: 선택한 첫 발언자부터 Claude와 Codex가 read-only로 교대한다. 모델별 기본 발언 한도는 5회(1~20)이며, UI의 무제한은 사용자 지정 한도를 없애되 서버가 모델별 100회와 전체 8시간을 안전 상한으로 강제한다. 최초 사용자 요청과 최근 6개 발언만 다음 입력에 포함하고, 각 provider session은 공식 follow-up으로 재사용한다.

3명 이상, 자동 retry/fallback, write 검토·Debate, 모델 생성 emotion hint와 공급자 간 직접 MCP 호출은 v1 실행 경로에 없다.

Debate run의 결정적 키는 collaboration, participant, sequence, round, generation 조합이다. 종료 사유는 `turn-limit`, `both-concluded`, `stalled`, `timeout`, `provider-failed`, `cancelled` 중 하나로 보존한다. 결론 제안의 SHA-256 checksum을 다음 참가자가 구조화된 `agree` 신호로 그대로 돌려준 경우만 자동 합의로 인정하며, 모델의 일반 본문은 실행 제어값으로 해석하지 않는다.

## 상태와 복구

run과 collaboration 상태는 별도 컬럼으로 유지한다. 취소는 전체 상태를 먼저 `cancel-requested`로 바꾼 다음 각 transport에 stop을 요청하며, 확인되지 않은 stop은 `stop-unconfirmed`로 남긴다. 완료된 provider task/result 참조는 삭제하지 않는다.

재시작 시 non-terminal wrapper를 읽고 기존 `providerTaskId` 상태를 조회한다. 이미 존재하는 purpose/sequence/round run은 재생성하지 않는다. Remote Worker가 offline이거나 상태가 불확실하면 `waiting-user`/`resume-confirmation`으로 두고 명시적인 resume 확인 전 자동 실행하지 않는다.

## 보안 경계

Relay의 provider 출력은 `<untrusted-provider-output>` 인용 구간에 들어갈 뿐 시스템 지시가 아니다. host, workspace, session ID, permission, reviewer 역할, call limit, timeout, write lease와 다음 실행 여부는 서버 레코드로 강제한다. token/cookie/key/private-key 패턴과 credential 파일 이름, 불필요한 절대 경로를 relay 생성 전에 제거한다.

모든 collaboration mutation은 기존 Access 인증, same-origin/Fetch Metadata, `X-Claudex-Workhouse-Request`, UUID idempotency, rate limit, body limit, `no-store`와 metadata-only audit를 그대로 통과한다. relay/participant/run 조회는 wrapper 소속 관계를 다시 확인한다.

## API

- `POST /api/collaborations`, `GET /api/collaborations`, `GET /api/collaborations/:id`
- `POST /api/collaborations/:id/cancel|archive|accept-partial|resume|relay-to-primary`
- `GET /api/collaborations/:id/events|avatar`
- `GET /api/collaborations/:id/participants/:participantId/session`
- `GET /api/collaborations/:id/relays/:artifactId`
- `POST /api/tasks/:provider/:taskId/assist`

협업 SSE는 안전한 envelope와 provider task/session 참조만 spool한다. 실제 응답은 기존 task/session source에서 읽는다.
