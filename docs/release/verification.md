# 공개 릴리스 검증

공식 설치판은 서명된 manifest의 정확한 바이트와 자산 정보를
검증합니다.

```text
release-manifest.json
release-manifest.json.sig
빌드에 포함된 공식 공개키 키링
```

검증 항목:

- schema와 채널
- key ID와 폐기 상태
- detached RSA-SHA256 signature
- 게시·만료 시각
- 단조 증가 release sequence
- 서버 이미지 repository·tag·digest·platform
- Worker filename·URL·크기·SHA-256·platform·architecture
- Windows portable ZIP filename·URL·크기·SHA-256
- Docker/Windows/Worker별 minimum updater protocol
- `SHA256SUMS`에 기록된 모든 최종 공개 파일

manifest와 함께 내려온 임의 공개키를 즉시 신뢰하지 않습니다.
검증 실패, 만료 또는 downgrade가 확인되면 `latest`나 미검증 URL로
우회하지 않습니다.

서명은 파일을 다시 JSON 직렬화한 결과가 아니라 배포된
`release-manifest.json`의 정확한 바이트를 대상으로 합니다.

## 설치본 업데이트 검증

Workhouse 본체 업데이트는 Provider CLI 업데이트와 별도입니다. 본체 적용은
owner 요청, exact target version/manifest SHA 확인, 활성 task·collaboration·
maintenance 차단, SQLite online backup과 설정 allowlist snapshot 성공을 모두
통과해야 합니다.

- Docker/NAS: 컨테이너 밖 host updater가 local key ring으로 manifest를 다시
  검증하고 `repository@sha256:digest`만 적용합니다. Docker socket은 앱
  컨테이너에 제공하지 않습니다.
- Windows portable: launcher가 별도 updater를 시작한 뒤 기존 server process를
  종료합니다. updater는 ZIP traversal, case-insensitive 중복 경로, symlink 또는
  reparse point, 파일 수·확장 크기를 검사하고 새 payload version directory와
  `current.json` pointer만 원자 교체합니다. 직전 payload는 rollback용으로
  보존합니다.
- Desktop Worker: 인증 handshake의 version, package SHA-256, updater protocol을
  signed platform/architecture payload와 대조합니다. 활성 Worker job이 있으면
  시작하지 않으며 credential과 Workspace 설정은 package 밖 Worker home에
  보존합니다.

업데이트 뒤 `/api/health/live`와 `/api/health/ready`가 제한 시간 안에 성공하지
않으면 이전 image digest 또는 pointer를 복원합니다. 결과 파일은 원래 attempt
ID, source/target version, manifest SHA와 일치할 때만 DB에 반영됩니다.

## 모바일 실기기 릴리스 체크리스트

Docker Chromium의 `mobile-360`, `mobile-412`, `tablet-800` 검증은 레이아웃과
브라우저 흐름의 회귀를 찾는 자동 게이트입니다. 아래 항목은 viewport
에뮬레이션으로 증명할 수 없으므로 공개 릴리스 전에 실제 기기와 실제 Access
경로에서 별도로 기록합니다.

- Android: 설치된 PWA에서 알림 권한을 허용하고 작업 완료·승인·사용자 입력
  요청 푸시를 각각 수신한다.
- Android: 시스템 공유 메뉴에서 텍스트, URL, 허용 파일을 Workhouse로 보내고
  편집 가능한 초안만 열리며 작업이 자동 시작되지 않는지 확인한다.
- iOS/iPadOS: 홈 화면에 설치한 PWA를 종료·재실행한 뒤 작업 목록, 승인과 후속
  입력 흐름이 유지되는지 확인한다.
- iOS/iPadOS: 지원되는 공유 항목이 Workhouse 초안에 도착하고 미지원 파일이
  명시적으로 거부되는지 확인한다.
- Cloudflare Access: 인증 만료 뒤 재인증 redirect가 PWA의 원래 작업 또는 승인
  화면으로 안전하게 복귀하고 Access cookie가 API·SSE에 함께 적용되는지 확인한다.
- 네트워크 전환: Wi-Fi와 이동통신을 오갈 때 SSE가 `Last-Event-ID`로 복구되고,
  중복 카드나 거짓 Live 상태가 생기지 않는지 확인한다.

각 항목에는 기기·OS·브라우저/PWA 버전, 실행 시각, 성공/실패, 화면 캡처 또는
서버 이벤트 근거를 남깁니다. 수행하지 않은 항목은 자동 E2E 통과로 대체하지
않고 `실기기 검증 대기`로 보고합니다.
