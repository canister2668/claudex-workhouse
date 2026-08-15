# Synology NAS 설치

## 준비 사항

- DSM 7 계열
- Container Manager
- x86_64 또는 arm64 CPU
- Docker Compose v2
- Workhouse 데이터를 저장할 공유 폴더
- NAS 내부 IP 또는 확인 가능한 호스트 이름

기본 저장 경로 예시는 다음과 같습니다.

```text
/volume1/docker/claudex-workhouse
```

다른 볼륨을 사용한다면 `/volume2/docker/claudex-workhouse`처럼 실제
공유 폴더 경로를 입력합니다. 시스템 루트나 DSM 운영체제 디렉터리를
데이터 경로로 사용하지 마세요.

## 가장 쉬운 설치

1. CPU에 맞는 공개 Docker 꾸러미를 NAS 공유 폴더에 업로드하고 압축을 풉니다.
2. DSM의 Container Manager가 실행 중인지 확인합니다.
3. DSM 터미널 또는 SSH에서 꾸러미 폴더로 이동해 `./install.sh` 한 번만 실행합니다. SSH를 전혀 사용할 수 없는 DSM 환경에서는 Container Manager의 **프로젝트 생성**에서 동봉된 `compose.yaml`을 선택할 수 있습니다.
4. 스크립트가 이미지 로드, Compose 시작, health 확인 후 NAS의 실제 LAN 주소를 출력합니다.
5. PC나 휴대폰에서 그 주소를 열어 관리자 등록과 최초 설정을 완료합니다.

설정과 DB는 named volume에 보관되고 컨테이너는 `restart: unless-stopped`로 등록됩니다.

설치기는 관리자 비밀번호를 저장하거나 원격 SSH 설치를 수행하지
않습니다. 필요한 호스트 권한은 명령을 실행한 사용자의 현재 권한을
사용합니다.

## Owner claim

owner claim token은 정적 설치 페이지가 아니라 새 서버가 직접
생성합니다. `install.sh`가 출력한 URL, 만료 시각과 fingerprint를
확인한 뒤 claim을 완료하세요. 링크를 잃었거나 만료됐다면 설치
디렉터리에서 기존 owner recovery CLI를 실행해 새 claim을 만듭니다.

## 재부팅 확인

Compose의 restart policy가 설정되어 있어도 DSM에서 Container Manager와
Docker가 정상 시작되는지 실제 재부팅으로 확인해야 합니다. 재부팅 후
다음 항목을 검사하세요.

- Workhouse 컨테이너 상태
- `/api/health/ready`
- `runtime/home`이 영구 저장 경로에 있고 일반 사용자에게 공개되지 않음
- 데이터와 SQLite 상태
- 기존 owner 및 Workspace 정보 유지
- 선택한 외부 접속 경로의 SSE와 WebSocket
