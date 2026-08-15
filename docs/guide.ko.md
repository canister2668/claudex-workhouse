# Claudex Workhouse 가이드북

[README](../README.md) · [English](guide.en.md) · [日本語](guide.ja.md)

아래 순서대로 읽으면 설치부터 외부 접속, 운영과 문제 해결까지 끊기지 않고
이어집니다. 장치별 문서는 주 경로에서 갈라졌다가 다시 이 가이드로 돌아옵니다.

1. [소개](introduction.ko.md) — 제품 목적과 개인 운영자 경계를 확인합니다.
2. [설치](install/index.md) — 권장 Linux/NAS Docker 호스트를 우선 검토하고 최초 실행을 완료합니다.
3. 외부 접속 선택: [Tailscale](install/tailscale.md) 또는 [Cloudflare Tunnel과 Access](install/cloudflare.md).
4. [연결 문제 해결](install/connectivity-troubleshooting.md) — health, DNS, TLS, 인증, 실시간 연결을 확인합니다.
5. [Provider 인증](provider-authentication.ko.md) — Codex, Claude, Gemini, DeepSeek, Ollama, Grok을 안전하게 연결합니다.
6. [보안](security.ko.md) — 신뢰 경계, 비밀값과 외부 접속 전제를 확인합니다.
7. [영속 작업 관리](#영속-작업-관리) — 협업 게시판에서 구현·검토·수정·승인을 조율합니다.
8. [작업 생성과 파일 이동](#작업-생성과-파일-이동) — 재설계된 작업 패널과 Proton Drive를 안전하게 사용합니다.
9. [배포와 운영](deployment.ko.md) — 빌드, 시작, 재시작, 업데이트와 복구 절차입니다.
10. [테스트](testing.ko.md) — 정적 검사, 회귀 및 브라우저 검증을 실행합니다.
11. [알려진 제한](known-limitations.ko.md) — 수동 단계와 미지원 범위를 확인합니다.
12. [라이선스](license.ko.md) — 라이선스와 소스 제공 정보를 확인합니다.

## 영속 작업 관리

**협업 게시판**은 작업 단위를 개별 Provider 세션과 분리해 보존합니다. 카드를 만들고 Workspace와 목표 브랜치, 구현자·검토자 역할을 정한 뒤 새 세션을 시작하거나 기존 세션을 연결할 수 있습니다. 카드 상태, 연결 세션과 타임라인은 재시작 뒤에도 유지됩니다. 수동 동작으로 구현, 검토, 수정, 재개, 완료, 다시 열기와 보관을 처리합니다.

선택적 게시판 자동화는 설정한 구현·검토 단계 안에서만 진행합니다. 단계 뒤에 일시정지할 수 있고, 검토자가 수정을 요구하면 멈추며, 최종 승인은 항상 소유자에게 남깁니다. Provider 세션이 완료되거나 모델이 완료됐다고 말한 것만으로 카드를 승인하지 않습니다.

작업 상세는 모든 Provider에 공통된 최종 결과 카드를 사용합니다. Claude 대화는 최근 구간을 제한적으로 먼저 읽고 더 오래된 기록이 있으면 이전 턴 불러오기를 명시적으로 표시하므로, 처음 부분이 조용히 사라지지 않습니다.

## 작업 생성과 파일 이동

새 작업 패널에는 **단일**, **검토**, **대화** 탭이 있습니다. 각 컨트롤 위의
라벨을 읽고, 시작하기 전에 채워진 요약 블록에서 선택값을 확인합니다. 검토와
대화에서는 선택한 참여자가 액센트 레일에 표시됩니다. 전체 권한을 선택하면
해저드 배너도 나타나므로, 되돌리기 어려운 변경을 허용한다는 마지막 경고로
확인합니다. 대화에서는 참여자별 시트를 열어 그 참여자의 전역 말투를 유지하거나
이 세션에서만 쓸 말투를 고릅니다. 세션 전용 선택은 전역 프리셋을 바꾸지 않습니다.

Proton Drive는 글로벌 설정에서 한 번 구성합니다. 기능을 켜고 공식 CLI로
로그인한 다음 원격 루트를 지정합니다. 탐색, 가져오기, 업로드 대상은 모두 그
루트 아래로 제한됩니다.

- Drive에 이미 있는 파일을 첨부하려면 작업 프롬프트 옆의 **Proton Drive에서
  첨부**를 열고 설정된 루트를 탐색한 뒤 파일을 고릅니다. 프롬프트에 파일명이나
  경로를 적는 것만으로는 다운로드가 시작되지 않습니다. 이 명시적 선택만
  `GET /api/proton-drive/inbox`에 이어 `POST /api/proton-drive/imports`를
  호출합니다. 서버가 브라우저 multipart 데이터를 받지 않고 첨부 저장소로 직접
  다운로드하므로 브라우저의 요청 전체 90MiB 업로드 제한이 적용되지 않습니다
  (60,379,017바이트 파일로 검증). 다운로드 크기와 SHA-1이 Proton 메타데이터와
  모두 일치해야 첨부됩니다.
- 원격 경로는 Proton이 실제로 저장한 철자로 해석됩니다. 따라서 요청 경로의
  대소문자나 유니코드 조합이 달라도 저장된 항목과 매칭될 수 있습니다. 대소문자만
  다른 항목이 둘이면 Workhouse는 모호성을 오류로 보고하고 추측하지 않습니다.
- 완료된 로컬 작업의 산출물을 Drive로 보내려면 완료된 작업에서 **Proton으로
  업로드**를 선택하고 Workspace 기준 일반 파일을 고른 뒤 검토 정보를 준비합니다.
  표시된 원본 경로, 크기, SHA-256, 목적지를 확인하고 업로드를 명시적으로
  승인합니다. 작업 완료만으로 자동 업로드되지 않으며 공개 공유 링크도 만들지
  않습니다.

## 장치별 분기

- [Synology NAS](install/synology.md)
- [일반 Linux](install/linux.md)
- [Node 설치(npm)](install/node.md)
- [Windows Docker Desktop 메인 서버 + Worker](install/windows.md) — 개발 중, 배포하지 않음
- [Windows Desktop Worker](install/windows-worker.md) — 개발 중, 배포하지 않음
- [Docker](docker.ko.md)
- [로컬 네트워크](install/local-network.md)
- [멀티 호스트 구조](multi-host.ko.md)

다음: [소개 →](introduction.ko.md)
