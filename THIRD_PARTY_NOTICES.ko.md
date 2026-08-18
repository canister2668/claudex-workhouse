# 제3자 고지

이 문서는 [영문 THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)의 한국어 참고
번역입니다. 번역과 영문 원문이 다를 경우 영문 원문이 우선합니다.

Claudex Workhouse 자체에는 `AGPL-3.0-only`가 적용됩니다. 아래 구성요소는 별도의
제3자 저작물이며 각각의 라이선스와 저작권 고지가 계속 적용됩니다.

정확한 설치 버전은 `app/pnpm-lock.yaml`과 릴리스 SBOM에 기록됩니다.
`node_modules`를 포함하는 바이너리 패키지는 각 패키지가 제공한 라이선스와 고지
파일을 보존합니다. 번들 Worker 패키지는 번들러가 실제로 포함한 의존성의 라이선스
파일과 재배포되는 Node.js 런타임 라이선스를 `licenses/third-party/`에 복사합니다.

## 프로덕션 JavaScript 의존성

| 구성요소 | 라이선스 |
| --- | --- |
| `@fastify/multipart` | MIT |
| `@fastify/rate-limit` | MIT |
| `@fastify/static` | MIT |
| `@fastify/websocket` | MIT |
| `@lucide/svelte` | ISC |
| `@modelcontextprotocol/sdk` | MIT |
| `better-sqlite3` | MIT |
| `dompurify` | MPL-2.0 OR Apache-2.0 |
| `fastify` | MIT |
| `jose` | MIT |
| `marked` | MIT |
| `qrcode` | MIT |
| `web-push` | MPL-2.0 |
| `ws` | MIT |
| `zod` | MIT |

전이 런타임 의존성에도 패키지 디렉터리에 포함된 라이선스 메타데이터와 고지 파일,
그리고 릴리스 SBOM에 열거된 조건이 각각 적용됩니다.

## 번들 런타임

- Node.js는 Node.js 라이선스와 Node.js에 포함된 구성요소의 라이선스에 따라 Docker
  이미지와 휴대용 Windows 패키지에 재배포됩니다. 런타임 자체의 라이선스 파일과
  릴리스 SBOM이 기준입니다.
- Windows 런처는 Windows 시스템 API를 사용하며 외부 런처 프레임워크를 포함하지
  않습니다.

## Provider 인터페이스

Claudex Workhouse는 별도로 설치된 Codex 및 Claude Code 런타임과 연동됩니다. 해당
제품과 명칭에는 각 소유자의 약관이 적용됩니다. Claudex Workhouse가 이들과 연결되는
인터페이스를 구현한다는 이유만으로 해당 제품의 소스 코드나 모델 에셋이 이 저장소에
포함되는 것은 아닙니다.

## 프로젝트 아트워크

`app/public` 아래의 감정 아바타와 애플리케이션 아이콘은 Canister가 Claudex
Workhouse를 위해 만든 원저작물입니다. 제3자 구성요소가 아닙니다.

이 아트워크는 프로젝트 소스에 적용되는 AGPL-3.0-only와 별개로 크리에이티브 커먼즈
저작자표시 4.0 국제 라이선스(CC BY 4.0)로 제공됩니다. Canister를 출처로 표시하면
누구나 상업적 이용을 포함해 자유롭게 사용, 수정, 재배포할 수 있습니다.
<https://creativecommons.org/licenses/by/4.0/deed.ko>

`@lucide/svelte`가 제공하는 인터페이스 아이콘은 위 표의 ISC 라이선스가 적용되는
제3자 저작물입니다.
