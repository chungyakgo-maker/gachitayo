#!/usr/bin/env bash
# 선 지도 데이터 (사양서 8.9): Protomaps의 최신 전 세계 지도 파일(OpenStreetMap 기반)에서 한국 범위만 잘라
# R2 버킷 gachitayo-map에 korea.pmtiles로 올린다. 지도 글자 조각(Noto Sans, 라틴·숫자·기호 범위)도 함께 올린다.
# 한글 지명은 앱이 폰 글꼴로 그리므로 한글 글자 조각은 올리지 않는다.
# 같이타요 전용 버킷만 만들고 쓴다 (다른 앱의 Cloudflare 자원은 건드리지 않는다).
set -euo pipefail

BBOX="124.5,33.0,131.0,38.7"   # 남한 + 제주 + 울릉 (서경, 남위, 동경, 북위)
MAXZOOM=14                     # 그 위는 앱이 늘려 그린다 (도로 정밀도 약 0.6 m)
LIMIT_MB=295                   # wrangler 한 번 올리기 한도 300 MiB

# pmtiles 명령 (Protomaps 공식, Go)
GOBIN="$PWD/.bin" go install github.com/protomaps/go-pmtiles@latest
PM="$PWD/.bin/go-pmtiles"
"$PM" version || true

# 오늘부터 10일 전까지 중 가장 최근 빌드
BUILD=""
for i in $(seq 0 10); do
  d=$(date -u -d "-$i day" +%Y%m%d)
  if curl -sfI "https://build.protomaps.com/$d.pmtiles" >/dev/null; then BUILD=$d; break; fi
done
[ -n "$BUILD" ] || { echo "::error::최근 10일 안의 Protomaps 지도 빌드를 찾지 못했습니다"; exit 1; }
echo "지도 빌드: $BUILD"

"$PM" extract "https://build.protomaps.com/$BUILD.pmtiles" korea.pmtiles --bbox="$BBOX" --maxzoom="$MAXZOOM" --download-threads=8
size=$(stat -c %s korea.pmtiles)
echo "한국 지도 파일: $((size / 1024 / 1024)) MB"
"$PM" show korea.pmtiles | head -25
if [ "$size" -gt $((LIMIT_MB * 1024 * 1024)) ]; then
  echo "::error::지도 파일이 ${LIMIT_MB}MB를 넘어 한 번에 올릴 수 없습니다 (MAXZOOM을 줄이거나 나눠 올려야 함)"
  exit 1
fi

# 글자 조각: protomaps/basemaps-assets 저장소에서 필요한 범위만
rm -rf assets
git clone --depth 1 --filter=blob:none --sparse https://github.com/protomaps/basemaps-assets.git assets
git -C assets sparse-checkout set "fonts/Noto Sans Regular" "fonts/Noto Sans Medium"

cd worker
if npx wrangler r2 bucket list | grep -q 'gachitayo-map'; then
  echo "R2 버킷 gachitayo-map 있음"
else
  # 배포 작업이 같은 때 만들 수도 있어, 만들기가 실패해도 이미 있으면 괜찮다
  npx wrangler r2 bucket create gachitayo-map || npx wrangler r2 bucket list | grep -q 'gachitayo-map'
fi

uploaded=0
for fs in "Noto Sans Regular" "Noto Sans Medium"; do
  # 라틴·숫자, 라틴 확장, 일반 문장부호, 기호(→ 등), 도형(▲ 등), CJK 기호(· 「」 등), 전각
  for r in 0-255 256-511 8192-8447 8448-8703 9472-9727 12288-12543 65280-65535; do
    f="../assets/fonts/$fs/$r.pbf"
    if [ -f "$f" ]; then
      npx wrangler r2 object put "gachitayo-map/fonts/$fs/$r.pbf" --file "$f" --content-type application/x-protobuf --remote >/dev/null
      uploaded=$((uploaded + 1))
    fi
  done
done
echo "글자 조각 ${uploaded}개 올림"
[ "$uploaded" -ge 2 ] || { echo "::error::글자 조각을 찾지 못했습니다 (basemaps-assets 구조가 바뀌었을 수 있음)"; exit 1; }

# 마지막에 지도 파일 (올리기가 끝나야 바뀐다. 앱은 바뀐 파일을 알아서 다시 읽는다)
npx wrangler r2 object put gachitayo-map/korea.pmtiles --file ../korea.pmtiles --content-type application/octet-stream --remote
echo "올림: gachitayo-map/korea.pmtiles (빌드 $BUILD)"
