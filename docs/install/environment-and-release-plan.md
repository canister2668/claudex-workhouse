# Claudex Workhouse 실행 환경과 공개 배포 구조

## 지원 실행 환경

공개 설치판은 개인 개발 장비의 버전이나 디렉터리 구조에 의존하지 않습니다.
지원되는 Node.js, 컨테이너 런타임, 플랫폼 요구사항은 설치 문서와 릴리스
매니페스트를 기준으로 확인합니다. 기본 로컬 bind 예시는 `127.0.0.1:3410`이며,
외부 접근은 인증된 reverse proxy 구성을 사용합니다.

## 공개판 구성

공개판은 네 종류의 배포물로 나뉩니다.

1. `linux/amd64`, `linux/arm64`용 메인 서버 컨테이너
2. Windows x64 current-user Worker
3. Linux x64·arm64 current-user Worker
4. 서버가 없어도 열 수 있는 정적 설치 페이지

메인 서버의 공식 대상은 Synology, 일반 Docker NAS, Linux입니다.
Windows는 1차에서 메인 서버가 아니라 Worker로 지원합니다. Windows
Worker는 사용자의 Claude Code·Codex 로그인과 Workspace 접근 권한을
그대로 사용하며 SYSTEM 계정이나 관리자 서비스를 기본으로 삼지 않습니다.

## 배포 위치

```text
Git tag
  ├─ GHCR
  │   └─ amd64/arm64 서버 이미지 · digest 고정
  ├─ GitHub Release
  │   └─ 불변 Worker·SBOM·version manifest 원본
  └─ 정적 설치 사이트
      ├─ 설치 UI
      ├─ releases/stable/release-manifest.json
      └─ releases/stable/release-manifest.json.sig
```

Worker 바이너리는 GitHub Immutable Releases의 버전별 URL에 보관합니다.
GitHub의 최종 asset CDN은 브라우저 `fetch`용 CORS를 보장하지 않으므로
정적 페이지가 ZIP을 읽어 우회하지 않습니다. 대신 페이지가 이미 검증한
manifest·signature·공개키가 결속된 current-user PowerShell downloader를
만들고, Windows 호스트가 실제 파일의 서명·크기·SHA-256을 확인합니다.
Pages에는 작은 stable pointer와 설치 UI만 두므로 Worker 이력을 매
배포마다 복제하거나 1GB Pages 한도에 의존하지 않습니다.

## 릴리스 안전장치

공개 릴리스는 다음 순서를 통과해야 합니다.

```text
타입·Svelte 검사와 전체 테스트
→ 다중 아키텍처 image와 native Worker 빌드
→ SBOM·취약점 검사·artifact attestation
→ archive 내부 경로·runtime·entrypoint·버전·파일 hash 검증
→ image digest와 Worker hash를 unified manifest에 기록
→ 보호된 개인 키로 exact manifest bytes 서명
→ draft Release에서 모든 자산 재다운로드 검증
→ 기존 stable을 유지한 설치 사이트 stage 배포
→ immutable version image tag와 Release 공개
→ 새 stable pointer 배포 및 공개 바이트 재검증
→ GHCR stable과 GitHub latest를 마지막에 승격
```

설치기는 `latest` 단독 tag를 사용하지 않습니다. 서버 이미지는
`version@sha256:digest`로 고정합니다. manifest 서명, 공개키 상태,
만료 시각, release sequence, 플랫폼, 크기 또는 hash가 맞지 않으면
설치를 중단하며 미검증 URL로 우회하지 않습니다.

개인 서명 키는 저장소와 이미지에 넣지 않습니다. 저장소와 설치
페이지에는 검증용 공개키 key ring만 포함합니다.

## 설치 흐름

Synology 또는 Linux 사용자는 정적 설치 페이지에서 장치, 저장 경로,
포트, 접속 방식을 선택합니다. 브라우저가 릴리스를 검증한 뒤 네 파일로
된 꾸러미를 로컬 메모리에서 만듭니다.

```text
compose.yaml
.env
install.sh
README-FIRST.txt
```

대상 장치에서 `install.sh`를 한 번 실행하면 Docker와 Compose, CPU
아키텍처, 저장 경로, 포트, manifest, image digest를 다시 확인합니다.
서버가 정상화되면 10분짜리 owner claim URL과 fingerprint를 출력합니다.
claim 후 Provider·Git·Workspace 설정은 Workhouse UI에서 이어집니다.

Windows와 Linux Worker는 기존 서버의 Infrastructure 화면에서 10분짜리
pairing code를 만든 뒤 연결합니다. Worker challenge와 장치별 credential은
기존 WorkerHub 구조를 그대로 사용합니다.

NAS/Linux 메인 서버에서 직접 Provider를 실행하는 경우 공식 CLI의 사용자
로그인 상태와 Git 사용자 설정은 `runtime/home` 아래에 유지됩니다. 이
경로는 컨테이너의 `HOME`으로 사용되는 영구 볼륨이지만, Workhouse DB가
Provider token을 자체 형식으로 복제하는 것은 아닙니다. `runtime` 내보내기와
지원용 진단에는 인증 파일을 포함하지 않아야 합니다.

Docker가 준비된 Synology 또는 Linux의 목표 설치 난이도는 약 3/10입니다.
최초 한 번은 대상 장치에서 명령을 실행해야 하지만, 이후 장치 상태와
계층형 진단은 UI에서 관리합니다.

## 접속 방식

- 같은 네트워크: NAS 또는 Linux의 사설 주소로 접속
- 개인 원격 접속: 기존 Tailscale HTTPS 주소 사용
- 도메인 브라우저 접속: 기존 Cloudflare Tunnel + Access 사용

브라우저 원격 접속에는 Cloudflare Access를 사용할 수 있지만 Worker는
기본적으로 로컬 네트워크 또는 Tailscale 경로를 권장합니다. Cloudflare
Service Token 자동 발급, Tailscale 계정 자동 로그인, 공유기 포트포워딩은
1차 범위가 아닙니다.

## 공개 전 운영 준비

코드는 다음 운영 자산이 없으면 fail-closed 상태를 유지합니다.

- 프로젝트 배포 라이선스
- production 공개키 key ring
- 보호된 CI 개인 서명 키와 key ID
- GitHub `release` 보호 환경
- GitHub Immutable Releases
- 공개 읽기가 가능한 GHCR와 GitHub Pages 설정
- 실제 Synology, Linux x64·arm64, Windows x64, 휴대폰 외부망 검증

이 준비가 끝나기 전에는 공개 설치 가능 상태로 표시하지 않습니다.
