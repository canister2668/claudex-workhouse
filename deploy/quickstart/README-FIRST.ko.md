# Linux/NAS 가장 쉬운 설치

1. Docker 또는 Synology Container Manager가 실행 중인지 확인합니다.
2. 이 폴더에 받은 Workhouse Docker 이미지 `*.docker.tar`를 함께 둡니다.
3. Linux/NAS에서는 `install.sh`를 한 번 실행합니다. Windows Docker Desktop을 대체 경로로 쓸 때는 `install.ps1`을 실행합니다.
4. 마지막에 출력되는 `http://내부-IP:3410` 주소를 PC나 휴대폰에서 엽니다.
5. 관리자 등록 후 화면의 최초 설정에서 Provider 설치, 로그인, 작업 폴더 등록, 첫 테스트까지 진행합니다.

`update.sh`는 새 이미지로 교체하면서 데이터를 보존합니다. `uninstall.sh`는 컨테이너만 내리고 데이터 볼륨은 삭제하지 않습니다.
