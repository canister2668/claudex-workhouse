#!/bin/sh
set -eu
INSTALL_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
cd "$INSTALL_DIR"
command -v docker >/dev/null 2>&1 || { printf '%s\n' 'Docker가 설치되어 있지 않습니다. 먼저 Docker 또는 NAS Container Manager를 설치해 주세요.' >&2; exit 1; }
docker compose version >/dev/null 2>&1 || { printf '%s\n' 'Docker Compose v2를 찾을 수 없습니다.' >&2; exit 1; }

IMAGE=${CLAUDEX_IMAGE:-}
set -- ./*.docker.tar ./*docker*.tar
for ARCHIVE do
  [ -f "$ARCHIVE" ] || continue
  OUTPUT=$(docker load -i "$ARCHIVE")
  printf '%s\n' "$OUTPUT"
  LOADED=$(printf '%s\n' "$OUTPUT" | sed -n 's/^Loaded image: //p' | tail -n 1)
  [ -n "$LOADED" ] && IMAGE=$LOADED
  break
done
IMAGE=${IMAGE:-claudex-workhouse-public-local:1.0.0}
SAVED_PORT=$(sed -n 's/^CLAUDEX_PORT=\([0-9][0-9]*\)$/\1/p' .env 2>/dev/null | tail -n 1 || true)
PORT=${CLAUDEX_PORT:-${SAVED_PORT:-3410}}
LAN_IP=$(hostname -I 2>/dev/null | awk '{for(i=1;i<=NF;i++)if($i !~ /^(127\.|169\.254\.|172\.1[7-9]\.|172\.2[0-9]\.|172\.3[01]\.)/){print $i;exit}}')
[ -n "$LAN_IP" ] || LAN_IP=$(ip route get 1.1.1.1 2>/dev/null | sed -n 's/.* src \([^ ]*\).*/\1/p' | head -n 1)
[ -n "$LAN_IP" ] || LAN_IP=127.0.0.1
ORIGIN="http://$LAN_IP:$PORT"
if [ ! -e .env ]; then
  umask 077
  {
    printf 'CLAUDEX_IMAGE=%s\n' "$IMAGE"
    printf 'CLAUDEX_PORT=%s\n' "$PORT"
    printf 'CLAUDEX_ORIGIN=%s\n' "$ORIGIN"
  } > .env
fi
docker compose --env-file .env up -d
printf '%s' '서버 준비를 기다리는 중'
READY=0
COUNT=0
while [ "$COUNT" -lt 60 ]; do
  if docker compose --env-file .env exec -T workhouse node -e "fetch('http://127.0.0.1:3410/api/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then READY=1; break; fi
  COUNT=$((COUNT+1)); printf '.'; sleep 2
done
printf '\n'
[ "$READY" -eq 1 ] || { printf '%s\n' '서버가 준비되지 않았습니다. docker compose logs --tail 100 으로 상세 내용을 확인하세요.' >&2; exit 1; }
printf '\n%s\n%s\n%s\n' '설치가 완료되었습니다.' "이 PC/NAS: http://127.0.0.1:$PORT" "다른 PC/휴대폰: $ORIGIN"
printf '%s\n' '위 주소를 열어 관리자 등록을 완료한 뒤 화면의 최초 설정 안내를 따라가세요.'
