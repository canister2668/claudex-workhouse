#!/bin/sh
set -eu
INSTALL_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
cd "$INSTALL_DIR"
docker compose --env-file .env down
printf '%s\n' 'Workhouse를 중지하고 컨테이너를 제거했습니다. 설정, 작업 기록과 Workspace 볼륨은 보존했습니다.'
printf '%s\n' '데이터까지 영구 삭제하는 작업은 이 스크립트가 수행하지 않습니다.'
