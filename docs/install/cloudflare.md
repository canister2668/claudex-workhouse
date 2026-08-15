# Cloudflare Tunnel과 Access

[가이드북](../guide.ko.md) · [English](cloudflare.en.md) · [日本語](cloudflare.ja.md)

Cloudflare는 선택 사항입니다. 로컬 네트워크나 Tailscale만 사용하는
설치에는 필요하지 않습니다.

기본 지원 범위는 사용자가 Cloudflare에서 만든 기존 Tunnel과 Access를
Workhouse에 연결하고 진단하는 것입니다. 외부 접속 마법사는 기존 구성
검증과, 선택한 경우 Workhouse 전용 token-file 및 host/sidecar 실행 파일
생성을 보조합니다. Cloudflare 계정 비밀번호나 계정 전체 권한 API token은
요구하지 않습니다.

## 기존 host Tunnel

```text
브라우저
→ Cloudflare Access
→ Cloudflare Tunnel
→ http://127.0.0.1:3410
→ Workhouse 컨테이너
```

이 방식에서는 Compose 포트를 loopback에만 바인딩합니다.

```yaml
ports:
  - "127.0.0.1:3410:3410"
```

Tunnel만 연결하고 Access를 생략하면 관리 UI가 직접 노출될 수 있습니다.
설치 진단에서 Tunnel 도달 여부와 Access 보호 여부를 구분해 확인하세요.

## 동일 Compose의 cloudflared

cloudflared를 Workhouse와 같은 Compose 네트워크에 직접 추가하는 것은
별도 고급 모드입니다. 이때 origin은 `localhost`가 아니라 Docker 서비스
이름을 사용해야 합니다.

```text
http://workhouse:3410
```

마법사의 관리형 모드는 Tunnel token을 명령행에 넣지 않고 데이터 디렉터리
아래 `config/external-access/cloudflared.token`에 `0600`으로 저장합니다.
토큰 원문은 API 응답, SQLite, 작업 로그, 지원 정보에 저장하지 않습니다.
생성되는 Compose 조각은 Docker socket을 사용하지 않으며 운영자가 내용을
확인한 뒤 별도로 시작합니다. Workhouse가 기록하지 않은 기존 service,
route, credential JSON, config 파일은 덮어쓰거나 제거하지 않습니다.

## 마법사와 검증 범위

`설정 → 서버 및 실행 장치 → 메인 서버 → 외부 접속`에서 다음을 진행합니다.

1. host 실행 파일과 안전한 후보 config 감지
2. 기존 Tunnel 또는 관리형 host/sidecar 방식 선택
3. HTTPS hostname, Access team domain, AUD, exact-email 입력
4. 만료되는 변경 계획과 외부 공개·인증 경계 확인
5. Workhouse 전용 파일 생성
6. DNS, TLS, 익명 인증 경계, HTML, manifest 및 로컬 health 검사
7. 최종 주소, 복사 버튼과 QR 표시

익명 진단이 Cloudflare 로그인 redirect를 확인하는 것만으로 특정 Access
정책 내용을 증명할 수는 없습니다. 최종 exact-email 정책과 dashboard의
Tunnel route는 Zero Trust에서 확인해야 하며, 인증된 브라우저에서 SSE와
PWA 동작을 다시 검사해야 합니다. 적용 뒤 변경된 Workhouse 인증 설정을
로드하기 위한 서비스 재시작도 운영자가 수행합니다.

## Worker

브라우저는 Cloudflare Tunnel과 Access를 사용할 수 있지만 Worker는
로컬 네트워크 또는 Tailscale을 권장합니다. Access 뒤에서 Worker를
연결하려면 별도의 Service Token 설계가 필요하며 공개 1차의 자동
설정 범위가 아닙니다.

QR 코드는 주소 전달 수단일 뿐 인증 수단이 아닙니다. Tunnel token,
Cloudflare Access cookie 또는 Worker credential을 QR에 넣지 않습니다.

이전: [설치](index.md) · 다음: [연결 문제 해결](connectivity-troubleshooting.md) · [Tailscale 방식 비교](tailscale.md) · [가이드북](../guide.ko.md)
