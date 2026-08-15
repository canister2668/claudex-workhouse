# 일반 Linux 설치

## 가장 쉬운 설치: Docker 빠른 설치 꾸러미

- Linux x64 또는 arm64
- Docker Engine
- Docker Compose v2
- Docker 명령을 실행할 수 있는 사용자
- 기본 포트 3410 또는 사용하지 않는 다른 TCP 포트

1. CPU에 맞는 공개 Docker 꾸러미를 받아 압축을 풉니다.
2. Docker 이미지 tar와 `compose.yaml`, `install.sh`가 같은 폴더에 있는지 확인합니다.
3. 그 폴더에서 다음 한 번만 실행합니다.

   ```sh
   chmod +x install.sh
   ./install.sh
   ```

4. 설치기가 이미지를 로드하고 서버 준비를 확인한 뒤 `http://LAN-IP:3410` 주소를 출력합니다.
5. 그 주소를 다른 PC나 휴대폰에서 열어 관리자 등록, Provider 설치·로그인, 작업 폴더와 첫 테스트를 완료합니다.

Compose는 설정, DB, 로그, Provider runtime, Snapshot과 Workspace를 named volume에 영구 보관하고 `restart: unless-stopped`로 재부팅 뒤 자동 시작합니다.

설치 재실행은 기존 데이터 삭제나 컨테이너 강제 재생성을 수행하지
않아야 합니다. 다른 Compose 또는 환경 파일이 이미 있다면 덮어쓰지
않고 중단합니다.

## 운영 확인

```sh
docker compose --env-file .env -f compose.yaml ps
docker compose --env-file .env -f compose.yaml logs --tail 100
```

업데이트는 새 이미지 tar를 같은 폴더에 둔 뒤 `./update.sh`를 실행합니다.
`./uninstall.sh`는 컨테이너만 제거하고 데이터 볼륨은 보존합니다.

## 고급 설치

Node 직접 설치, bind mount 변경, 별도 Worker와 수동 Compose 구성은 운영 구조를 이해하는 사용자를 위한 대체 경로입니다.
