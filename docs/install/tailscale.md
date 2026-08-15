# Tailscale 연결

[가이드북](../guide.ko.md) · [English](tailscale.en.md) · [日本語](tailscale.ja.md)

Tailscale은 개인 휴대폰과 PC에서 Workhouse에 접속할 때 선택할 수 있는
방식입니다. Workhouse는 Tailscale 계정 비밀번호, 장기 인증 키, ACL
또는 장치 승인을 대신 관리하지 않습니다.

## 권장 브라우저 경로

현재 공식 설치 계획은 외부 origin에 HTTPS를 요구하므로 브라우저
접속은 Tailscale Serve HTTPS를 권장합니다.

```text
브라우저
→ Tailscale Serve HTTPS
→ 호스트 loopback Workhouse 포트
```

직접 `http://100.x.y.z:3410`을 사용하는 방식은 Tailscale CGNAT
바인딩과 origin 검증 정책이 함께 구성되어야 합니다. 설치 생성기가
해당 모드를 명시적으로 지원한다고 표시하기 전에는 HTTPS 모드를
선택하세요.

## Worker 연결

Windows 또는 Linux Worker는 메인 서버와 같은 Tailnet에 로그인한 뒤
서버의 승인된 Tailscale 주소로 연결합니다. Cloudflare Access 로그인
페이지를 Worker 연결 경로로 사용하지 않는 것이 기본 권장입니다.

## Workhouse 외부 접속 마법사

`설정 → 서버 및 실행 장치 → 메인 서버 → 외부 접속`에서 설치, daemon,
로그인, MagicDNS, Serve와 Funnel 상태를 읽기 전용으로 감지할 수 있습니다.
적용 전 화면에는 고정된 `tailscale serve` 작업, loopback 대상, 공개 범위,
재시작 필요 여부와 되돌리기 절차가 표시됩니다. 적용 요청은 브라우저가
실행 파일이나 argv를 전달하지 않으며, 짧게 만료되는 digest·revision 고정
계획을 승인하는 방식입니다.

Tailscale 인증 모드는 Serve가 백엔드로 전달하는 공식
`Tailscale-User-Login` 신원과 설정된 이메일을 정확히 비교합니다. 백엔드는
loopback, Host와 Origin은 설정된 HTTPS 주소여야 합니다. Serve는 들어온
동명 신원 헤더를 제거한 뒤 채우지만, 로컬 OS의 다른 프로세스는 같은 신뢰
경계 안에 있다는 전제가 남습니다. Funnel은 이 신원 헤더를 제공하지 않고
공개 인터넷에 노출되므로 Workhouse 인증에는 허용하지 않습니다.

이미 존재하지만 Workhouse가 만든 것으로 기록되지 않은 Serve 설정은
덮어쓰거나 제거하지 않습니다. 계정 생성, 로그인, 장치 승인, ACL 변경은
계속 Tailscale 앱이나 관리 화면에서 수행합니다. 적용 뒤 Workhouse 인증
설정이 로드되도록 서비스 재시작은 운영자가 별도로 수행합니다.

이전: [설치](index.md) · 다음: [연결 문제 해결](connectivity-troubleshooting.md) · [Cloudflare 방식 비교](cloudflare.md) · [가이드북](../guide.ko.md)
