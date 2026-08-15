# Claudex Workhouse 설치

[가이드북](../guide.ko.md) · [English](index.en.md) · [日本語](index.ja.md)

**메인 서버는 Linux 또는 Linux 기반 NAS의 Docker로 설치합니다.** 현재 배포하는
경로는 이것뿐입니다. **Windows 대상은 모두 개발 중이며 배포하지 않습니다** —
포터블 서버, 네이티브 Worker, Docker Desktop + Worker 구성 모두 해당합니다.
Windows에서는 Linux 호스트나 NAS에 메인 서버를 두고 브라우저(PWA)로 접속하세요.

| 대상 | 메인 서버 | Worker | 기본 방식 |
| --- | --- | --- | --- |
| Synology DSM 7 | 지원 | 선택 | Docker Compose |
| 일반 Linux x64·arm64 | 지원 | 지원 | Docker Compose·current-user Worker |
| QNAP·기타 Docker NAS | 일반 Docker 흐름 | 선택 | Docker Compose |
| Windows 11 x64 | **개발 중** | **개발 중** | 배포하지 않음 · 브라우저로 접속 |

Windows에 남은 과제는 [Windows 지원 정책](../windows-support-policy.md)에
정리되어 있습니다.

기본 설치 흐름은 다음과 같습니다.

```text
장치 선택
→ 저장 위치와 접속 방식 선택
→ 서명된 릴리스 검증
→ Linux/NAS 설치 꾸러미 다운로드
→ install.sh 실행
→ 자동으로 표시된 로컬/LAN 주소 열기
→ Provider 설치·공식 로그인
→ 작업 폴더 등록과 첫 읽기 테스트 성공
```

설치 페이지와 설치기는 NAS 관리자 비밀번호, SSH 개인 키, Provider
자격증명 또는 Docker socket 접근 권한을 요구하지 않습니다.

설치 후 외부 접속은 `설정 → 서버 및 실행 장치 → 메인 서버 → 외부 접속`의
마법사에서 감지, 변경 계획 확인, 적용 보조, 연결 시험과 주소/QR 확인 순서로
진행합니다. DSM·Docker·Windows처럼 권한 경계가 다른 환경에서는 자동화
수준을 숨기지 않고 별도 관리자 작업을 표시합니다.

## 설치 가이드

- [Synology NAS](./synology.md)
- [일반 Linux](./linux.md)
- [Node 설치(npm)](./node.md)
- [Windows 포터블 서버](./windows.md) — 개발 중, 배포하지 않음
- [Windows PC를 Worker로 연결](./windows-worker.md) — 개발 중, 배포하지 않음
- [로컬 네트워크](./local-network.md)
- [Tailscale](./tailscale.md)
- [Cloudflare Tunnel과 Access](./cloudflare.md)
- [연결 문제 해결](./connectivity-troubleshooting.md)
- [신규 환경 설치 검증표](./clean-environment-validation.md)

## 공개 릴리스 검증

공식 설치 꾸러미는 `latest` 태그만으로 이미지를 선택하지 않습니다.
서명된 manifest가 지정한 버전과 이미지 digest를 사용하며 검증 실패,
만료 또는 downgrade가 확인되면 설치를 중단합니다.

자세한 내용은 [릴리스 검증](../release/verification.md)을 참고하세요.

이전: [소개](../introduction.ko.md) · 다음: [Tailscale](tailscale.md) 또는 [Cloudflare Tunnel과 Access](cloudflare.md) · [가이드북](../guide.ko.md)
