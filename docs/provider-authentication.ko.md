# Provider 인증 방식

[언어 안내](provider-authentication.md) · [English](provider-authentication.en.md) · [日本語](provider-authentication.ja.md)

이전: [연결 문제 해결](install/connectivity-troubleshooting.md) · [가이드북](guide.ko.md) · 다음: [보안 →](security.ko.md)

Claudex Workhouse는 서로 다른 실행 백엔드로 여섯 Provider를 지원합니다.
Codex와 Claude는 공식 런타임, Gemini는 Antigravity 에이전트 또는 Vertex AI,
DeepSeek와 Ollama는 설정한 API 엔드포인트, Grok은 설정한 CLI 런타임과 xAI 로그인을 사용합니다. Workhouse는 이 인증
경계를 하나의 공용 자격증명 체계로 합치지 않습니다.

## Claude Code 로그인

Claude 구독, Console 또는 조직 SSO 로그인 시 Workhouse는 설정된 공식
`claude` 바이너리를 가상 터미널에서 다음 중 하나로 실행합니다.

```text
claude auth login
claude auth login --console
claude auth login --sso
```

Workhouse에 표시되는 로그인 URL은 CLI가 출력한 값이며, HTTPS를 사용하는
허용된 Claude 호스트만 받아들입니다. 공식 페이지에서 일회성 인증 코드를
보여주는 경우, 해당 코드는 CLI의 터미널 입력으로 전달하기 위해 로컬
Workhouse 서버를 한 번 통과합니다. 코드 원문은 Workhouse 데이터베이스나
감사 로그에 기록되지 않습니다. 인증 멱등성 정보는 요청 해시 형태로 메모리에만
유지되며, 인증 정보가 포함될 수 있는 터미널 원문도 helper 밖으로 노출하지
않습니다.

OAuth 교환과 그 결과로 생성된 자격증명의 저장·관리는 공식 Claude Code CLI가
담당합니다. Workhouse는 `claude auth status`로 연결 상태를 확인하고
`claude auth logout`으로 로그아웃할 뿐, Claude Code 자격증명 파일을 읽지
않습니다. 기존 세션을 찾기 위해 `~/.claude/projects` 아래의 프로젝트 대화
기록을 읽을 수 있지만 이는 자격증명 접근과 별개입니다.

## 인증된 요청

Claude 작업은 `claude -p`, `--output-format stream-json`, `--resume` 같은
공식 CLI 옵션으로 실행됩니다. Provider 네트워크 요청을 구성하고 인증하는
주체는 Workhouse 웹 서비스가 아니라 CLI입니다. Workhouse는 Anthropic API
인증 헤더를 직접 추가하거나 Claude Code OAuth 토큰을 자체 HTTP 클라이언트에서
재사용하지 않습니다.

운영자가 실행 환경에 이미 설정한 자격증명에는 Claude Code 자체의 인증 우선순위가
적용됩니다. 기존 `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, 클라우드
Provider 설정 또는 사용자 지정 credential helper가 구독 로그인보다 우선할 수
있습니다. Workhouse는 이 값을 생성하지 않으며 CLI의 우선순위를 변경하지
않습니다.

Codex도 같은 Provider 고유 경계를 따릅니다. 로그인과 인증된 호출은 자격증명을
추출해 OpenAI API를 직접 호출하는 방식이 아니라 공식 Codex app-server
런타임을 통해 수행됩니다.

## Gemini, DeepSeek, Ollama, Grok

Gemini의 Antigravity 모드는 `agy` 런타임이 관리하는 Google 계정 세션을
사용합니다. Workhouse는 런타임이 제공하는 승인된 Google 로그인 흐름을 중계할
수 있지만 생성된 OAuth 정보를 노출하거나 다른 요청에 재사용하지 않습니다.
Gemini의 Vertex Direct 모드는 별도의 직접 응답 백엔드입니다. 운영자가 Google Cloud
서비스 계정 JSON을 업로드하면 Workhouse가 비공개 파일 권한으로 저장하고 선택한
프로젝트와 리전의 Vertex 호출에만 사용합니다.

Gemini의 Vertex Agent 모드는 같은 서비스 계정과 프로젝트로 공식 Gemini CLI를
실행합니다. 새로운 자격증명 저장소를 만들지 않고 Vertex Direct에 이미 저장된 키를
그대로 사용하며, CLI 자체 상태(세션 기록 등)는 Antigravity OAuth 홈과 물리적으로
분리된 별도 홈 디렉터리에 보관합니다. Vertex Agent 실행 중에는 Antigravity Google
로그인이 필요하지 않으며, 나타난다면 그것은 설정 오류입니다.

DeepSeek는 설정한 호환 API 주소와 비밀값을 사용합니다. Ollama는 설정한 로컬 또는
원격 엔드포인트와 선택적 계정 설정을 사용합니다. 모델 카탈로그는 각 엔드포인트에서
동적으로 읽으며 두 Provider를 Codex나 Claude CLI 로그인으로 표시하지 않습니다.

Grok은 설정한 Grok CLI를 사용합니다. Workhouse는 device 또는 Google OAuth 로그인 흐름을 시작하고 허용된 HTTPS 로그인 호스트만 받으며, 런타임의 모델 카탈로그로 준비 상태를 확인합니다. OAuth 정보를 추출하지 않고 CLI를 실행하며 현재 Grok 런타임에는 외부 MCP 서버 설정을 전달하지 않습니다.

## 단일 사용자 경계

Claudex Workhouse는 신뢰할 수 있는 개인의 단일 사용자 셀프 호스팅 환경을
대상으로 합니다. Provider 자격증명은 Provider CLI를 실행하는 운영체제 사용자에게
속합니다. 여러 사람이 하나의 Provider 계정을 함께 사용하도록 한 설치본을
다중 사용자 서비스로 공개하지 마세요. Cloudflare Access는 원격 접속을 보호할
수 있지만 Workhouse를 사용자별 계정 격리 시스템으로 바꾸지는 않습니다.

이 문서는 구현 경계를 설명하며 법률 의견이나 Provider 약관에 대한 보증이
아닙니다. 운영자는 자신의 Provider 계정과 배포에 적용되는 약관을 준수할
책임이 있습니다.

## 공식 참고 자료

- [Claude Code 인증](https://code.claude.com/docs/en/authentication)
- [Claude Code 프로그래밍 실행](https://code.claude.com/docs/en/headless)
- [Anthropic 소비자 약관](https://www.anthropic.com/legal/consumer-terms)
