# 신규 환경 설치 검증표

이 문서는 이미 Claude Code·Codex가 설치된 개발 장비의 성공을 신규 설치 성공으로 오인하지 않기 위한 공개 베타 점검표입니다.

## Windows 11 x64

Windows는 Linux/NAS Docker 메인 서버를 사용할 수 없을 때의 호환성 대안입니다.

| 단계 | 자동 검증 | 실제 신규 PC 확인 |
| --- | --- | --- |
| 포터블 ZIP 구조·무결성 | Windows 패키징 검사와 payload manifest 검사 | 필요 |
| 압축 해제·launcher 실행·Workhouse 열기 | Windows CI launcher test 대상 | 필요 |
| Claude Code 미설치 감지·공식 설치 | Windows 경로·공식 manifest·설치 스크립트 단위 검사 | 필요 |
| Codex 미설치 감지·공식 설치 | 공식 release metadata·checksum 이중 검증, 일반 파일 설치 경로, reparse-point 거부 검사 | 필요 |
| 공식 로그인 | Codex app-server와 Claude 로그인 창 코드 검사 | 실제 계정으로 필요 |
| Workspace 선택·첫 읽기 테스트 | 서버/UI 빌드 및 API 경계 검사 | 실제 계정으로 필요 |

빈 Windows PC에서 남을 수 있는 주요 장벽은 포터블 ZIP 안의 서명되지 않은 launcher에 대한 SmartScreen 경고, 회사 PC의 PowerShell·다운로드 정책, Provider 웹 로그인 정책과 네트워크 차단입니다. 실행 실패 화면은 짧은 일반 안내와 접을 수 있는 진단을 분리합니다.

## Linux·NAS

| 단계 | 자동 검증 | 실제 NAS 확인 |
| --- | --- | --- |
| 공개 스크럽 트리 빌드 | 필수 | 완료 |
| Docker 이미지 빌드 | 필수 | 릴리스마다 완료 필요 |
| Compose 문법·영구 볼륨·재시작 정책 | 필수 | 완료 |
| install.sh 서버 시작·health·LAN URL | 격리된 프로젝트/포트 | 릴리스마다 완료 필요 |
| 관리자 등록 | 브라우저 E2E | 신규 브라우저 확인 필요 |
| Provider 설치·로그인·첫 읽기 테스트 | 실제 계정 필요 | 신규 계정 환경 확인 필요 |

NAS에 Docker Compose v2가 없거나 DSM 터미널 권한이 없는 경우에는 Container Manager의 프로젝트 생성 화면에서 동봉된 `compose.yaml`을 여는 대체 경로가 필요합니다. 자동으로 고른 LAN 주소가 여러 NIC·VLAN·VPN 중 틀릴 수 있으므로 설치기는 localhost와 LAN 주소를 함께 보여줍니다.

## 공개 베타 출고 기준

- 공개 스크럽 검사, 공개 트리 build/check, Docker clean-start, Windows payload manifest 검사가 모두 성공해야 합니다.
- Windows 실제 신규 PC에서 설치·두 Provider 감지·최소 한 Provider 로그인·첫 작업 성공을 확인하기 전에는 정식판으로 판정하지 않습니다.
- Linux/NAS는 최소 한 x64 Docker 호스트에서 새 named volume으로 관리자 등록과 첫 작업까지 확인해야 합니다.
- 실제 계정을 쓰지 않은 검사는 로그인과 Provider 응답 성공의 증거로 기록하지 않습니다.
