#!/bin/sh
set -eu
INSTALL_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
cd "$INSTALL_DIR"
ARCHIVE=${1:-}
if [ -z "$ARCHIVE" ]; then for FILE in ./*.docker.tar ./*docker*.tar; do [ -f "$FILE" ] && ARCHIVE=$FILE && break; done; fi
[ -n "$ARCHIVE" ] && [ -f "$ARCHIVE" ] || { printf '%s\n' '새 Docker 이미지 tar 파일을 이 폴더에 넣거나 첫 번째 인수로 지정하세요.' >&2; exit 1; }
OUTPUT=$(docker load -i "$ARCHIVE"); printf '%s\n' "$OUTPUT"
IMAGE=$(printf '%s\n' "$OUTPUT" | sed -n 's/^Loaded image: //p' | tail -n 1)
[ -n "$IMAGE" ] || { printf '%s\n' '로드된 이미지 이름을 확인할 수 없습니다.' >&2; exit 1; }
TMP=.env.new.$$
awk -v image="$IMAGE" 'BEGIN{done=0} /^CLAUDEX_IMAGE=/{print "CLAUDEX_IMAGE=" image;done=1;next}{print} END{if(!done)print "CLAUDEX_IMAGE=" image}' .env > "$TMP"
mv "$TMP" .env
docker compose --env-file .env up -d
printf '%s\n' '업데이트했습니다. 데이터 볼륨은 유지됩니다.'
