# Codex↔Claude 캐주얼 대화모드 토큰 절감 구조 설계 리뷰

- 작성: Claude Code (claude-opus-5), 리뷰 전용 · 구현 없음
- 기준 commit: 8c46d251c77f4314022676801428625b20ef0797 (작업 트리 변경 1건: `docs/conversation-4c2e15d1-conclusion.md`)
- 실측 대상 세션: `4c2e15d1-7714-4f7a-8bb8-20a19f9b5b87`
- 근거 등급 표기: **[실측]** = 이 리뷰에서 직접 실행/DB 조회로 얻은 수치, **[코드]** = 저장소 코드로 확인한 사실, **[추측]** = 검증되지 않은 판단

---

## 0. 결론 요약

1. **제안 우선순위가 실제 비용 구조와 역순이다.** 이 세션의 명목 토큰 약 30만 중 **약 89.5%가 대화 내용이 아니라 매 호출마다 재지불되는 provider 기저 컨텍스트**다 **[실측]**. 반면 4,917자 캐릭터 directive를 900자로 줄여도 명목 절감은 **약 2.6%**에 그친다 **[실측 기반 산출]**.
2. **제안 1(conversation-lite 실행 프로필)이 압도적 1순위다.** Claude 측은 이번 리뷰에서 직접 실행해 확인했다: 현재 대화 설정의 기저가 19,175 토큰인데, `--safe-mode --tools ""` 조합은 **5,274 토큰**으로 떨어지며 **현재 OAuth 구독 인증에서 그대로 동작한다** **[실측]**.
3. **제안 4(5라운드 세션 회전)는 현재 측정치에서 토큰을 늘린다.** 라운드당 컨텍스트 증가는 Codex 약 902 / Claude 약 1,472 토큰인데, 세션 회전 1회 비용은 신규 기저 15k~20k 토큰이다. **손익분기는 라운드 20~25 부근**이며, 5라운드 회전은 4~5배 이른 회전이다 **[실측 기반 산출]**.
4. **제안 3(ConversationCapsule)은 importantFacts 항목만 진짜 어렵다.** locale·nickname·roleplay state·tone은 이미 서버가 결정론적으로 보유하고 있다 **[코드]**. 사실 요약만이 추가 모델 판단을 요구하며, 이것이 이 설계의 단일 최대 리스크다.
5. **제안 5는 절반만 맞다.** 서버는 마커 개수 상한과 문법 정규화는 보증할 수 있으나(이미 shorthand를 관용 파싱함 **[코드]**), 하한(rich 모드의 2~3개)은 보증할 수 없다.
6. **제안 6은 즉시 해도 되는 저위험 작업**이며, 데이터는 이미 수집되고 있다 **[코드]**.

---

## 1. 실측: 토큰이 실제로 어디로 가는가

### 1.1 대상 세션의 호출별 컨텍스트 **[실측 · DB 조회]**

`tasks.metadata_json.contextUsage`에서 추출.

| # | provider | purpose | prompt 문자수 | 호출 컨텍스트(토큰) |
|---|---|---|---|---|
| 1 | codex | conversation-turn (R1) | 10,235 | 25,736 |
| 2 | claude | conversation-turn (R1) | 10,430 | 19,175 |
| 3 | codex | R2 | 2,594 | 26,429 |
| 4 | claude | R2 | 2,565 | 20,294 |
| 5 | codex | R3 | 2,596 | 27,122 |
| 6 | claude | R3 | 2,557 | 21,475 |
| 7 | codex | R4 | 2,694 | 27,894 |
| 8 | claude | R4 | 2,711 | 22,740 |
| 9 | codex | R5 | 4,099 | 28,933 |
| 10 | claude | R5 | 4,054 | 24,410 |
| 11 | codex | conclusion-draft | 1,783 | 30,246 |
| 12 | claude | conclusion-revision | 2,083 | 26,535 |

합계 = **300,989** (사용자 보고 명목 302,732와 정합).

### 1.2 핵심 분해

- 라운드당 증가분: Codex `(30,246-25,736)/5 = 902`, Claude `(26,535-19,175)/5 = 1,472` **[실측]**
- 기저 재지불: `6×25,736 + 6×19,175 = 269,466` = 명목의 **89.5%** **[실측]**
- 즉 **대화 5라운드가 실제로 만든 신규 컨텍스트는 약 31.5k뿐**이고, 나머지 269k는 "같은 서두를 12번 다시 읽은 비용"이다.

### 1.3 5라운드 prompt가 2.6k → 4.1k로 튄 이유 **[코드]**

`babyTalkCycleDirective(position=5)`가 burnout break 지시를 통째로 붙인다 (`character-settings.ts:96-143`). 이 세션은 양측 모두 `baby-talk-cutesy` 프리셋이었다 **[실측]**. 즉 5의 배수 라운드마다 프롬프트가 구조적으로 부풀며, 이는 제안 2(persona kernel 축약)가 반드시 함께 다뤄야 할 대상이다.

### 1.4 캐릭터 directive의 실제 비중 **[실측 + 산출]**

- 이 세션 directive 길이: provider별 정확히 **4,917자** (= `universalAudienceDirective` + `baby-talk-cutesy` 3,863자 + guardrails) **[실측 · DB]**
- 참고: `lewd-guardian-comedy` 프리셋은 **claude 11,328자 / codex 10,788자**로 2.3배 더 크다 **[실측 · 소스 측정]**. 최악 케이스 설계 시 이 값을 기준선으로 삼아야 한다.
- 4,917자 ≈ 1,600토큰 **[추측: 문자→토큰 환산]**. 900자로 줄이면 회당 약 1,300토큰 절감이고, 12호출 전부에 재지불되므로 명목 약 7.8k = **2.6%**.

> 판정: 제안 2는 **가치는 있으나 단독으로는 오차 수준**이다. 1순위로 두면 품질 리스크(말투 붕괴)만 지고 절감은 못 얻는다.

---

## 2. Claude 측 실행 프로필 — 실행해서 확인함

### 2.1 현재 코드가 무엇을 붙이는가 **[코드]**

`app/src/server/claude-worker.ts:71-86`:

- `--tools Read Glob Grep WebSearch WebFetch` (대화는 `:read-only` 프로필 → `PROFILES[":read-only"]`, `claude-worker.ts:38`)
- `--setting-sources user,project,local` — **무조건**. 사용자 전역 `CLAUDE.md` 체인(4,725바이트 **[실측]**), project/local settings, 플러그인·스킬이 전부 로드된다.
- `--strict-mcp-config`는 **저장소 어디에도 없다** **[코드 · grep 확인]**. 따라서 `--mcp-config`로 주입한 emotion/managed 서버 외에 **사용자 전역 MCP 설정도 함께 로드**된다.
- `--append-system-prompt`로 delegation + execution policy 지시를 추가.
- `--safe-mode`는 대화 경로에 없다. 유일한 사용처는 모델 프로브 `index.ts:527`.

### 2.2 실측 프로브 **[실측 · 이번 리뷰에서 직접 실행]**

인증 상태: `ANTHROPIC_API_KEY` 미설정, `~/.claude/.credentials.json` 존재 → **OAuth 구독 인증** **[실측]**.

| 구성 | 입력 토큰(캐시 쓰기 포함) |
|---|---|
| `--safe-mode --tools ""` | **5,274** |
| `--safe-mode --tools Read Glob Grep WebSearch WebFetch` | 8,334 |
| `--tools "" --setting-sources user,project,local` (safe-mode 없음) | 8,174 |
| (참조) 현재 대화 1라운드 실제 호출 | 19,175 |

분해 **[실측 기반 산출]**:
- 내장 read-only 도구 스키마 = **약 3,060토큰**
- 사용자 커스터마이즈(CLAUDE.md·스킬·플러그인·MCP·훅) = **약 2,900토큰**
- 나머지 ≈ 5,300 = 축소 불가능한 Claude Code 기저

19,175 − 11,234(= normal+5tools 추정) ≈ 7,900은 `--append-system-prompt` + `--mcp-config` 스키마 + 10,430자 대화 프롬프트로 설명된다 **[추측: 개별 항목은 미분리]**.

### 2.3 질문 답변 — OAuth 구독에서 경량 옵션이 실제로 가능한가

| 옵션 | 판정 | 근거 |
|---|---|---|
| `--safe-mode` | **가능** | help: "Auth, model selection, built-in tools, and permissions work normally" **[코드/help]**. 실제로 OAuth 인증 상태에서 실행 성공 **[실측]** |
| `--tools ""` | **가능** | help가 명시하고, 실행 성공 **[실측]**. `index.ts:527`이 이미 프로덕션에서 사용 중 **[코드]** |
| `--strict-mcp-config` | **가능(미검증)** | help에 존재 **[코드/help]**. 인증과 무관 **[추측]** |
| `--system-prompt` | **문법상 가능, 미검증** | help에 API key 제한 문구 없음. 단 help가 `--exclude-dynamic-system-prompt-sections`는 `--system-prompt`와 함께 무시된다고 명시 → **둘은 상호 배타** **[코드/help]** |
| `--bare` | **불가** | help: "Anthropic auth is strictly ANTHROPIC_API_KEY or apiKeyHelper... OAuth and keychain are never read" **[코드/help]**. 사용자 판단이 정확함 |
| `--no-session-persistence` | **대화에 사용 불가** | help: "sessions... cannot be resumed". 대화는 `--resume`로 followUp한다 **[코드: claude-worker.ts:84, provider-transport.ts:47]**. 모델 프로브에서 이 플래그를 봤다고 대화 프로필에 복사하면 followUp이 깨진다 |

### 2.4 반드시 게이팅해야 하는 조건 **[코드 근거]**

- `--tools ""`는 **`conversationKind==="casual"`에서만** 안전하다. `artifact-review` 대화는 `reviewRules()`가 실제 파일 확인을 요구한다 (`orchestrator.ts:248`).
- `--safe-mode`가 명시적 `--mcp-config`까지 무력화하는지는 **미검증** **[추측]**. 다만 `conversationTurnLength`가 compact/rich이면 프롬프트가 `inlineEmotionPrompt`를 쓰고 MCP emotion 경로를 아예 타지 않는다 (`orchestrator.ts:298`) **[코드]** → 이 경우 emotion MCP 상실은 무해하다. 레거시 MCP emotion 모드에서만 위험.
- `--exclude-dynamic-system-prompt-sections`는 회전 설계와 상성이 좋다(cwd/env/git status를 시스템 프롬프트 밖으로 빼 캐시 재사용을 높임) **[코드/help]**. 단 `--system-prompt`와 병용 불가.

**예상 효과 [실측 기반 산출]**: casual 대화에서 `--safe-mode --tools "" --strict-mcp-config` 적용 시 Claude 호출당 기저 19,175 → 약 8,700(5,274 + 프롬프트 약 3,400). 이 세션 기준 Claude 6호출 명목 115,050 → 약 52,000 (**−55%**).

---

## 3. Codex 측 — 줄일 수 있는 것과 없는 것

### 3.1 구조적 제약 **[코드 · 결정적]**

대화는 `codex exec`가 아니라 **`codex app-server --stdio` JSON-RPC**로 실행된다 (`codex/app-server.ts:188`, `codex-worker.ts:191-194`). 그런데 `codex app-server --help`에는 **`--ephemeral`, `--ignore-user-config`, `--ignore-rules`가 없다** **[실측 · help 확인]**. 이 플래그들은 `codex exec` 전용이며, 저장소에서도 모델 프로브(`index.ts:527`)에서만 쓰인다.

→ **제안 1의 Codex 항목("대화 전용 격리 설정, user config/rules/MCP/web search 제외")은 현재 전송 계층에서는 그대로 실현 불가능하다.**

### 3.2 그 격리가 실제로 얼마짜리인가 **[실측 · 이번 리뷰에서 직접 실행]**

| `codex exec` 구성 | 입력 토큰 | 캐시 읽기 |
|---|---|---|
| 기본(사용자 config + AGENTS.md + rules + MCP) | **19,996** | 0 |
| `--ephemeral --ignore-user-config --ignore-rules` | **15,064** | 12,032 |
| `-c 'mcp_servers={}'` (기본 대비) | 19,788 | 0 |

- 사용자 config/rules/AGENTS.md 격리 가치 = **약 4,932토큰 (24.7%)**
- MCP 서버 제거만으로는 **208토큰 (약 1%)** — 제안이 기대한 "MCP 제외" 효과는 **거의 없다**. (이 호스트의 MCP는 원격 URL 2개이고 스키마가 프롬프트에 크게 실리지 않는 것으로 보인다 **[추측]**)
- 참고 자산: `~/.codex/AGENTS.md` 3,738바이트 **[실측]**
- **약 15,064토큰은 Codex의 축소 불가능한 기저**(시스템 프롬프트 + 내장 도구 스키마)다 **[실측]**.

### 3.3 실현 경로 **[추측 — 설계 제안, 미검증]**

app-server를 유지하면서 4.9k를 회수하려면 플래그가 아니라 **환경 격리**로 접근해야 한다:

- **대화 전용 `CODEX_HOME`**: AGENTS.md 없음 + 최소 `config.toml`. `codex exec --help`가 "auth still uses `CODEX_HOME`"이라 명시하므로 **auth.json을 함께 두어야 하며, 토큰 갱신이 두 홈으로 갈라지는 위험**이 있다 **[코드/help + 추측]**.
- 이 방식은 `app-server.ts:198`의 주석이 지적한 "모든 app-server가 하나의 CODEX_HOME과 sqlite 상태를 공유"한다는 전제를 바꾸므로, **cold-start 직렬화 락과 풀링 로직을 다시 검토해야 한다** **[코드]**. 메모리에 기록된 콜드스타트 38~81초 문제와 직결된다.

**요약**: Codex에서 실질적으로 줄일 수 있는 것 = 사용자 config/AGENTS.md/rules 약 4.9k(단, 별도 CODEX_HOME이라는 비용을 지불해야 함) + Workhouse 프롬프트 자체. **줄일 수 없는 것** = 약 15k 기저, `developerInstructions`(정책상 필요), MCP 제거(효과 없음), web search(별도 스위치 없음 **[실측 · help 확인]**).

---

## 4. 필수 질문 답변

### Q1. 이 구조가 캐릭터 일관성·상호 참조·사용자 개입 경험을 유지할 수 있는가?

**부분적으로만.** 항목별로 나뉜다.

| 요소 | 회전+capsule로 유지 가능? | 근거 |
|---|---|---|
| 닉네임/역할/사용자 호칭 | **가능** | 이미 `session.metadata.participantNicknames`, `userNickname`에서 매 턴 재생성 **[코드: orchestrator.ts:282-285]** |
| 언어/locale | **가능** | `conversationLanguageDirective`가 매 턴 삽입 **[코드:62]** |
| roleplay on/off, 전환 고지 | **가능** | `roleplayActive`, `roleplayTransition`이 서버 상태 **[코드:283-284]** |
| baby-talk 5주기, lewd-guardian 단계 | **가능** | 완료된 run 개수로 결정론적 계산 **[코드: 273-279, 292-293]** |
| 말투 품질 | **위험** | 현재 compact 프롬프트는 directive를 다시 넣지 않고 "이미 세션에 있다"고 가정한다 **[코드:299]**. 세션을 회전하면 **이 가정이 깨진다** — 회전 직후 턴은 반드시 full directive를 다시 실어야 하므로, 회전 주기가 짧을수록 4,917자를 더 자주 재지불한다 |
| 상호 참조("아까 네가 말한") | **최근 3턴 밖은 소실** | capsule의 importantFacts 품질에 전적으로 의존 |
| 사용자 개입 | **가능** | 개입은 `executeGuidedRound`/`automaticUserFollowup` 경로로 매번 새 프롬프트를 만든다 **[코드:286]** |

**가장 큰 모순**: 제안 4(짧은 회전)와 제안 2(짧은 persona kernel)는 **서로를 상쇄한다**. 회전이 잦을수록 persona를 다시 실어야 하고, kernel을 줄이면 회전 후 말투 복원력이 떨어진다.

### Q2. 5라운드 회전이 오히려 토큰/할당량을 늘리는 조건은?

**현재 측정치에서는 조건부가 아니라 거의 항상 늘어난다.**

- 회전이 이득이려면 **회전 시점의 누적 대화 히스토리 H > 신규 기저 B**여야 한다.
- 실측: Codex `B ≈ 15k~20k`, 라운드당 증가 902 → `H`가 `B`에 도달하는 시점은 **라운드 약 20~22**. Claude는 `B ≈ 5.3k~19k`, 증가 1,472 → **라운드 약 4~13** (프로필 경량화 여부에 크게 좌우).
- 5라운드 시점의 `H`는 Codex 약 4.5k, Claude 약 7.4k뿐이다. 이걸 버리려고 15k~20k를 새로 사는 거래다.

**추가로 명목이 아니라 과금/할당량 기준에서 더 나빠지는 조건 [실측 + 추측]**:
- Claude는 캐시가 실제로 동작한다: 첫 호출 캐시 쓰기 12,892 / 캐시 읽기 6,281(사용자 보고), 이번 프로브에서도 `ephemeral_1h_input_tokens` 사용 확인 **[실측]**. 회전은 **저렴한 캐시 읽기를 비싼 캐시 쓰기로 되돌린다.** Anthropic 요금 구조상 캐시 읽기가 기본 입력의 0.1배, 캐시 쓰기가 1.25배라는 통상 비율을 가정하면 **회전 1회는 약 12배 비싼 토큰으로 기저를 다시 사는 것** **[추측: 이 설치의 구독 할당량 산정식은 확인 불가]**.
- Codex `thread/start`는 캐시 읽기 0에서 출발한다(사용자 보고 및 프로브 일치) **[실측]** → 회전마다 기저 15k~20k를 **캐시 할인 없이** 전액 재지불.

**회전이 실제로 이득이 되는 조건**은 다음 중 하나가 성립할 때다 **[추측]**:
1. 라운드당 컨텍스트 증가가 크다 — 긴 턴, artifact snapshot 재삽입, 도구 출력 누적 (casual 대화는 해당 없음)
2. 컨텍스트 창 임계(Codex 258,400 / Claude 1,000,000 **[실측]**)에 근접 — 현재 사용률은 Codex 11.7%, Claude 2.7%로 **한참 멀다**
3. provider가 캐시 할인 없이 명목 입력으로만 과금

**권고**: 고정 5라운드 회전은 폐기하고, **임계 기반 회전**으로 바꿀 것. 예: `usedTokens > windowTokens × 0.5` 또는 `H > B_measured` 중 먼저 오는 쪽. `contextUsage`는 이미 매 호출 저장되므로 추가 계측 없이 판정 가능 **[코드/실측]**.

### Q3. 최근 3턴으로 부족한 장기 연속성을 capsule이 어떻게 보존하는가? 추가 모델 호출 없이 가능한가?

**항목을 두 부류로 나눠야 한다.**

**(A) 추가 호출 없이 결정론적으로 재생 가능 — capsule에 "저장"할 필요조차 없음 [코드]**
locale, nicknames, userNickname, tone/relationship preset, roleplayActive, roleplayTransition, baby-talk cycle position, lewd-guardian stage, 라운드 카운터. 이들은 전부 `session.metadata` + 완료 run 개수에서 매 턴 재계산된다. capsule 설계에서 이 항목들을 "저장 필드"로 넣으면 **동일 상태의 두 번째 진실 원본을 만드는 것**이고, 회전 시 불일치 버그가 생긴다. **파생 필드로 유지할 것.**

**(B) 진짜 어려운 항목 — importantFacts, 최근 감정 상태**
이것만이 의미 판단을 요구한다. 추가 모델 호출 없는 선택지:

1. **piggyback 방식 (권장)** — 현재 턴 출력 끝에 기계 판독 가능한 사실 라인을 함께 내게 한다. 선례가 이미 있다: `[CLAUDEX_WORKHOUSE_CONVERSATION:continue|yield|end]` 마커를 서버가 파싱하고 UI에서 제거한다 **[코드: orchestrator.ts:56,65,297]**. 비용은 출력 토큰 수십 개뿐, 추가 호출 0.
   - **리스크(실증 있음)**: 같은 마커 계약이 이미 불안정하다. `inline-emotion.ts`가 "Never use shorthand such as `[[pout]]`"를 두 번 경고하고 파서가 shorthand를 관용 처리한다 **[코드: inline-emotion-contract.ts:8,26]** — 이는 모델이 계약을 어긴 관측이 있었다는 뜻이다. 사실 추출 마커도 같은 방식으로 누락·왜곡될 것으로 본다 **[추측]**.
2. **규칙 기반 추출** — 이름·숫자·고유명사만 뽑기. 저비용이지만 "치즈를 먹지 말자고 합의했다" 같은 **관계적 사실을 못 잡는다** **[추측]**. 이번 세션의 결론 문서가 정확히 그런 종류의 사실로 구성되어 있다.
3. **사용자 고정(pin)** — 가장 정확하나 사용자 노동을 요구.

**답**: 추가 모델 호출 없이 **(A)는 완전히 가능**하고, **(B)는 piggyback으로만 가능하되 신뢰성이 보증되지 않는다**. 따라서 **importantFacts 실패를 전제로 한 설계**가 필요하다 — capsule은 "완전한 기억"이 아니라 "best-effort 힌트"로 취급하고, 실패해도 대화가 깨지지 않는 지점(= 회전을 아주 늦게)에서만 쓰는 것이 안전하다. 이는 다시 Q2의 임계 기반 회전 권고와 같은 결론으로 수렴한다.

### Q4. Claude Code OAuth 구독에서 위 경량 옵션 조합이 실제로 가능한가?

§2.3 표 참조. 요약: **`--safe-mode` + `--tools ""` + `--strict-mcp-config`는 가능**(앞 둘은 이번에 OAuth 상태로 실행 성공 **[실측]**), **`--bare`는 불가**(help 명시 **[코드/help]**), **`--no-session-persistence`는 대화에 쓰면 안 됨**(followUp이 `--resume`에 의존 **[코드]**), **`--system-prompt`는 문법상 가능하나 이 리뷰에서 미검증이며 `--exclude-dynamic-system-prompt-sections`와 배타** **[코드/help]**.

### Q5. Codex에서 줄일 수 있는 것 / 없는 것

§3.3 요약 참조. 핵심은 **MCP 제외는 208토큰짜리 헛수고**이고 **user config/AGENTS.md/rules가 4,932토큰짜리 진짜 표적**이지만, **현재 app-server 전송에는 그것을 끄는 플래그가 없다**는 점이다 **[실측 · help 확인]**.

---

## 5. 제안별 판정표

| 제안 | 판정 | 예상 명목 절감 | 근거 |
|---|---|---|---|
| 1. conversation-lite (Claude) | **채택 · 1순위** | Claude 호출당 −55% (세션 −21%) | [실측] |
| 1. conversation-lite (Codex) | **수정 후 채택** | 최대 −4.9k/호출, 단 별도 CODEX_HOME 필요 | [실측+코드] |
| 2. persona kernel 축약 | **채택 · 3순위** | 약 −2.6% | [실측 기반 산출] |
| 3. ConversationCapsule | **범위 축소 후 채택** | 직접 절감 없음(회전의 전제조건) | [코드] |
| 4. 5라운드 고정 회전 | **거부 · 임계 기반으로 대체** | 현재 조건에서 **증가** | [실측 기반 산출] |
| 5. `[[e:...]]` 서버 검증 | **부분 채택** | 프롬프트 약 2~4줄 감소 | [코드] |
| 6. UI 분리 표시 | **채택 · 0순위(무위험)** | 0 (오해 제거) | [코드] |

**제안 5 상세 [코드]**: `parseInlineEmotionMarker`가 이미 shorthand `[[pout]]`을 정상 파싱한다(`inline-emotion-contract.ts:8,23-26`). 따라서 compact/rich 프롬프트의 "Never use shorthand" 경고 2줄은 **파서 동작과 중복이며 지금 당장 제거해도 동작이 바뀌지 않는다**. 반면 rich 모드의 "정확히 2~3개"는 서버가 **상한만 강제 가능**(초과분 strip)하고 하한은 강제 불가하므로, 해당 지시는 프롬프트에 남아야 한다.

**제안 6 상세 [코드]**: `turnUsageBreakdown`이 input/output/reasoning/cached/cacheWrite를 이미 분리해 반환한다(`web/conversation.ts:34-42`). 반면 헤더의 `totalConversationTokens`는 `usage.tokens`를 단순 합산한다(`CollaborationTimeline.svelte:129`) — 즉 **명목 처리량을 "총 토큰"으로 표시**하고 있고, 이것이 30만이라는 수치가 놀라워 보이는 직접 원인이다. 데이터는 이미 있으므로 표시만 바꾸면 된다.

---

## 6. 단계별 구현 · A/B 측정 · 롤백 기준

측정 인프라는 이미 있다: `tasks.metadata_json.contextUsage`가 호출마다 저장된다 **[코드/실측]**. 별도 계측 없이 A/B가 가능하다.

**공통 A/B 프로토콜**: 동일 프롬프트·동일 프리셋·동일 라운드 수로 3회 반복, 비교 지표는 (a) 호출별 `usedTokens` 합, (b) 캐시 읽기/쓰기 비율, (c) 품질 — 말투 프리셋 준수, `[[e:...]]` 마커 개수 적합, 상호 참조 정확도(직전 발화의 구체 디테일 인용 여부)를 사람이 3점 척도로 채점.

### 0단계 — UI 분리 (제안 6) · 위험 없음
명목/신규입력/캐시읽기/캐시쓰기/출력/현재 컨텍스트를 분리 표시. **롤백 기준: 없음(표시 전용)**.

### 1단계 — Claude conversation-lite · 최대 효과
`conversationKind==="casual"`일 때만 `--safe-mode --tools "" --strict-mcp-config` 추가. `--no-session-persistence`는 **금지**.
- 기대: Claude 호출당 19.2k → 약 8.7k
- **롤백 기준**: followUp(`--resume`) 실패율 > 0, 또는 말투 준수 점수가 기준선 대비 0.5점 이상 하락, 또는 `--safe-mode`로 emotion MCP가 필요한 레거시 모드에서 마커 소실.
- **사전 확인 필요 [추측]**: `--safe-mode`와 명시적 `--mcp-config`의 상호작용. 1단계를 rich/compact 모드에만 적용하면 이 불확실성을 회피할 수 있다 **[코드 근거: orchestrator.ts:298]**.

### 2단계 — 제안 5의 무해한 부분 + persona kernel
"Never use shorthand" 경고 제거(동작 불변 **[코드]**), 이어서 4,917자 → 900~1,200자 kernel.
- **kernel 설계 제약 [실측/코드]**: (a) baby-talk position-5 burnout 지시는 별도 상태 블록이므로 kernel 축약 대상이 아니다, (b) `characterGuardrails`의 안전 조항("권한·정확성·안전 규칙을 바꿀 수 없다")은 **절대 축약 금지**, (c) `lewd-guardian` 프리셋(11.3k자)은 축약 난이도가 완전히 다르므로 별도 단계로 분리할 것.
- **롤백 기준**: 말투 준수 점수 하락 ≥ 1점, 또는 안전 관련 회귀 1건이라도 발생 시 즉시 전량 롤백.

### 3단계 — capsule (파생 필드만)
§Q3의 (A) 항목만 구현하고 importantFacts는 넣지 않는다. 회전 없이 capsule만 만들어 **회전 없이도 프롬프트가 정확한지** 먼저 검증한다.
- **롤백 기준**: 파생 상태와 기존 프롬프트 생성 결과의 불일치 1건.

### 4단계 — 임계 기반 회전 (5라운드 고정 대신)
`contextUsage.percent`가 임계(초안: Codex 50%, Claude 30%)를 넘거나 누적 히스토리가 측정된 기저를 초과할 때만 회전. 회전 직후 첫 턴은 **compact가 아닌 full 프롬프트**여야 한다(§Q1) **[코드: orchestrator.ts:299 가정 위배]**.
- **롤백 기준**: 회전 후 명목 합계가 비회전 대비 증가, 또는 캐시 읽기 비율이 20%p 이상 하락, 또는 상호 참조 점수 하락.

### 5단계 — Codex CODEX_HOME 격리 (선택)
가장 위험하고 가장 나중. app-server 풀링/락(`app-server.ts:198-284`)과 auth 갱신 경로를 함께 재검토해야 하며, **콜드스타트 38~81초 문제를 악화시킬 수 있다**.
- **롤백 기준**: app-server 콜드스타트 실패 1건, 또는 auth 갱신 이상.

**메타 롤백 원칙**: 각 단계는 단일 feature flag로 켜고 끌 수 있어야 하며, 1단계(Claude)와 5단계(Codex)를 동시에 켜지 말 것 — 효과 귀속이 불가능해진다.

---

## 7. 남은 불확실성 (전부 **[추측]** 또는 미검증)

1. `--safe-mode` + 명시적 `--mcp-config` 병용 시 MCP 서버가 살아남는지 — **미실행**.
2. `--system-prompt`가 OAuth에서 동작하는지 — **미실행**. help에 금지 문구는 없다.
3. 이 구독의 할당량이 캐시 읽기/쓰기를 어떻게 가중하는지 — **확인 불가**. Q2의 "약 12배" 산출은 통상 API 요금비를 가정한 것이며, 구독 할당량 산정식이 다르면 회전 손익분기가 이동한다.
4. 문자→토큰 환산비(한국어 혼용 프롬프트 기준 약 3.1자/토큰으로 가정).
5. §2.2 프로브는 `/srv/claudex-workhouse`(루트에 `CLAUDE.md` 없음 **[실측]**)에서 실행됐다. 실제 대화 워크스페이스에 `CLAUDE.md`/`AGENTS.md`가 있으면 커스터마이즈 비용이 더 크고, **conversation-lite의 절감폭은 여기서 측정한 값보다 커진다**.
6. `metadata.contextWindowTurns=6`은 `orchestrator.ts:125`에서 저장될 뿐 **읽는 곳이 없다** **[코드 · grep 전수 확인]**. 사용자 관찰이 정확하다. 이 필드는 제거하거나 4단계에서 실제 임계값으로 재정의해야 한다.
