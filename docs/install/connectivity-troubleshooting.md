# 연결 문제 해결

[가이드북](../guide.ko.md) · [English](connectivity-troubleshooting.en.md) · [日本語](connectivity-troubleshooting.ja.md)

연결 실패는 다음 순서로 좁혀갑니다.

```text
컨테이너
→ 로컬 health
→ 호스트 포트
→ DNS·HTTPS
→ SSE
→ WebSocket
→ 인증
→ WorkerHub
```

## 서버 페이지가 열리지 않음

- `docker compose ps`에서 컨테이너 상태를 확인합니다.
- 호스트에서 `/api/health/live`를 호출합니다.
- 선택한 포트를 다른 프로세스가 사용 중인지 확인합니다.
- 로컬 설치라면 포트가 loopback에만 묶이지 않았는지 확인합니다.

## HTTP는 되지만 SSE가 끊김

- 프록시 buffering과 응답 압축을 확인합니다.
- 프록시와 브라우저의 idle timeout을 확인합니다.
- Cloudflare Access 로그인이 완료된 동일 세션인지 확인합니다.

## WebSocket 연결 실패

- 브라우저 UI는 일반 WebSocket endpoint를 노출하지 않습니다. 이 단계는
  Desktop Worker의 송신 전용 WSS 연결에만 해당합니다.
- HTTP health가 먼저 성공하는지 확인합니다.
- 역방향 프록시가 WebSocket upgrade를 전달하는지 확인합니다.
- cloudflared sidecar라면 origin이 `localhost`가 아닌 Workhouse 서비스
  이름인지 확인합니다.
- Worker가 Access 로그인 페이지로 redirect되지 않는지 확인합니다.

## 진단 정보 공유

글로벌 설정의 **서버 및 실행 장치 → 안전한 진단 꾸러미 다운로드**를
사용하면 계층형 검사 결과를 JSON으로 저장할 수 있습니다. 이 꾸러미는
raw 로그, 호스트 이름·ID, 계정 식별자, 이메일, 절대 경로와 remediation
payload를 애초에 포함하지 않는 allowlist 방식입니다.

화면을 복사하거나 별도 로그를 공유할 때도 다음 값이 제거됐는지
확인합니다.

- owner claim token
- pairing code와 Worker credential
- Authorization·Cookie 헤더
- Provider 인증정보
- Cloudflare Tunnel·Service Token
- 불필요한 전체 로컬 경로와 이메일

이전: [Tailscale](tailscale.md) 또는 [Cloudflare](cloudflare.md) · 다음: [Provider 인증](../provider-authentication.ko.md) · [가이드북](../guide.ko.md)
