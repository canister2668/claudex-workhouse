# Docker 설치

[English](docker.en.md) · [한국어](docker.ko.md) · [日本語](docker.ja.md)

메인 서버는 Linux 또는 Linux 기반 NAS의 Docker 호스트를 권장합니다. 아래
Windows 절차는 Linux 호스트를 사용할 수 없는 운영자를 위한 대안입니다.

Windows 11 x64에서는 Docker Desktop 메인 서버와 current-user Windows
Worker의 조합이 기본 경로입니다. 설치 페이지의 **Windows + Docker
Desktop** 탭에서 서명된 manifest와 정확한 image digest가 내장된 PowerShell
스크립트를 받으세요. 컨테이너는 웹·DB를 실행하고 Worker는 Windows 사용자의
Claude Code·Codex 로그인과 로컬 Workspace 접근을 유지합니다. 자세한 순서는
[Windows 설치](install/windows.md)를 참고하세요.

1. `.env.example`을 `.env`로 복사하고 외부 주소를 설정합니다.
2. `docker compose up -d --build`로 시작합니다.
3. 기본 포트는 보안을 위해 `127.0.0.1`에만 바인딩되고 `local` 인증 모드는 loopback origin에서만 동작합니다. 외부 공개 전에 Cloudflare Access를 구성하고 `cloudflare` 모드로 바꿉니다.
4. Claude Code와 Codex runtime은 이미지에 자격증명과 함께 넣지 않습니다. `claudex-workhouse-runtime` 볼륨에 공식 설치본을 두거나 Desktop Worker를 연결합니다.

컨테이너는 UID/GID 10001, capability 없음, `no-new-privileges`로 실행됩니다. 공급자 인증은 해당 실행 호스트별로 별도이며 다른 호스트로 복사되지 않습니다.

설정·DB·runtime·workspace는 각각 named volume에 유지됩니다. 컨테이너 시작 시 `umask 077`이 적용되어 설정, Push 키, SQLite와 WAL은 `0600`으로 생성됩니다. 기본 Compose 포트는 loopback에만 열리며 `local` 인증 모드는 loopback origin에서만 허용됩니다. LAN 또는 인터넷에 공개할 때는 `CLAUDEX_WORKHOUSE_EXTERNAL_ORIGIN`과 Cloudflare Access(또는 검증된 reverse proxy 인증)를 먼저 구성하세요.

릴리스 워크플로는 amd64/arm64 이미지를 빌드하고 OCI provenance, SBOM, digest를 게시합니다. 로컬 빌드는 `docker compose build`, 기동 검증은 `docker compose up -d`와 `/api/health/live`로 수행합니다.
