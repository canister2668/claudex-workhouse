# Windows PC를 Worker로 연결

> **개발 중 · 배포하지 않음.** 아래 절차는 개발 참고용입니다. Windows Worker는
> 훅 실행, Codex CLI 설치, 세션 진행 표시가 아직 신뢰할 수 있게 동작하지
> 않습니다. 남은 과제는 [Windows 지원 정책](../windows-support-policy.md)을
> 보세요.

Workhouse 메인 서버는 Synology NAS 또는 Linux에 설치합니다. Windows에서는
그 서버에 브라우저로 접속해 사용하세요.

## 준비 사항

- Windows x64
- PowerShell 5.1 이상
- 연결할 기존 Workhouse 서버
- 서버에서 생성한 10분짜리 pairing code
- 작업 폴더에 접근할 수 있는 현재 Windows 사용자

공식 portable 패키지는 검증된 Node runtime을 포함하므로 일반 사용자가
Node.js나 npm을 별도로 조립하지 않게 하는 것이 공개 배포 원칙입니다.

## 연결

1. 서버의 **서버 및 실행 장치 → Worker 추가**를 엽니다.
2. Windows x64를 선택하고 pairing code를 생성합니다.
3. 서버의 전체 설치 명령을 사용하거나 정적 설치 페이지에서 검증
   다운로드 PowerShell 스크립트를 받습니다.
4. PowerShell을 열고 설치 페이지에 표시된 명령을 실행합니다. 예:

   ```powershell
   powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "$env:USERPROFILE\Downloads\download-claudex-workhouse-worker-1.0.0.ps1"
   ```

   `Bypass`는 이 자식 PowerShell 프로세스에만 적용되며 Windows의 전역
   실행 정책을 변경하지 않습니다. `Set-ExecutionPolicy`로 시스템 또는
   사용자 정책을 완화할 필요가 없습니다.
5. PowerShell 스크립트가 내장된 signed manifest를 검증한 뒤 GitHub
   Immutable Release의 ZIP 크기와 SHA-256을 확인하게 합니다.
6. current-user 위치에 설치하고 Worker 설정 화면을 엽니다.
7. 서버 주소와 pairing code를 입력합니다.
8. 작업 폴더 Root를 선택합니다.
9. Claude Code·Codex·Git 상태를 진단하고 테스트 작업을 실행합니다.

기본 사용자 데이터는 `%LOCALAPPDATA%` 아래에 저장합니다. Worker를
SYSTEM 서비스로 실행하지 않으며 현재 사용자의 Provider 로그인과 파일
권한을 그대로 사용합니다.

## 제거

제거 시 다음 항목을 구분합니다.

- 로그인 시 자동 실행 제거
- Worker 프로세스 종료
- 프로그램 파일 제거
- 로컬 설정과 장치 credential 보존 또는 삭제
- 서버의 실행 장치 목록에서 credential 폐기

프로그램 제거가 서버 측 credential 폐기를 자동으로 대신하지 않습니다.
