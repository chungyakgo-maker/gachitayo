#!/usr/bin/env bash
# 예전 지도 버킷 지우기 (사용자 요청 "미국 지도는 없어도 무관하면 없애버려", 한 번만):
# gachitayo-map(미국)은 아시아 버킷 gachitayo-map-apac으로 옮긴 뒤 아무 데서도 안 쓴다. 같은 지도 복사본(약 363 MB).
# 안전장치: 이름이 정확히 gachitayo-map인 버킷만, Worker가 쓰는 버킷이 아닐 때만, 아시아 버킷에 지도 파일이 있을 때만 지운다.
set -euo pipefail
export LC_ALL=C.UTF-8

OLD=gachitayo-map
NEW=gachitayo-map-apac
API=https://api.cloudflare.com/client/v4
ACC="$CLOUDFLARE_ACCOUNT_ID"

# 1. Worker 설정이 새 버킷을 쓰는지 (지울 버킷을 쓰면 멈춘다)
uses=$(awk '/^\[\[r2_buckets\]\]/{b=""} /^binding *= *"MAP"/{b="MAP"} b=="MAP" && /^bucket_name/{gsub(/.*= *"|".*/,""); print; exit}' worker/wrangler.toml)
echo "Worker 지도 버킷: $uses"
[ "$uses" = "$NEW" ] || { echo "::error::Worker가 $NEW 이 아닌 '$uses'를 써서 멈춥니다"; exit 1; }
[ "$OLD" != "$uses" ] || { echo "::error::지울 버킷을 Worker가 쓰고 있어 멈춥니다"; exit 1; }

# S3 열쇠 (map-data.sh와 같은 방법)
tid=$(curl -s -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" "$API/user/tokens/verify" | jq -r '.result.id // empty')
[ -n "$tid" ] || tid=$(curl -s -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" "$API/accounts/$ACC/tokens/verify" | jq -r '.result.id // empty')
[ -n "$tid" ] || { echo "::error::Cloudflare 토큰 ID를 알 수 없습니다"; exit 1; }
secret=$(printf '%s' "$CLOUDFLARE_API_TOKEN" | sha256sum | cut -d' ' -f1)
echo "::add-mask::$secret"
s3() {
  AWS_ACCESS_KEY_ID="$tid" AWS_SECRET_ACCESS_KEY="$secret" AWS_DEFAULT_REGION=auto \
    AWS_REQUEST_CHECKSUM_CALCULATION=when_required AWS_RESPONSE_CHECKSUM_VALIDATION=when_required \
    aws "$@" --endpoint-url "https://$ACC.r2.cloudflarestorage.com"
}

# 2. 새 버킷에 지도 파일이 제대로 있는지 (없으면 멈춘다)
newsize=$(s3 s3api head-object --bucket "$NEW" --key korea.pmtiles --output json | jq -r '.ContentLength // 0')
echo "$NEW/korea.pmtiles: $newsize 바이트"
[ "$newsize" -gt 100000000 ] || { echo "::error::$NEW 에 지도 파일이 없거나 너무 작아 멈춥니다"; exit 1; }

# 3. 예전 버킷 비우기 → 버킷 지우기
before=$(s3 s3api list-objects-v2 --bucket "$OLD" --output json 2>/dev/null | jq '[.Contents[]?] | length' || echo "")
if [ -z "$before" ]; then
  echo "$OLD: 이미 없음"
  exit 0
fi
echo "$OLD: 파일 ${before}개 지우는 중"
s3 s3 rm "s3://$OLD" --recursive --only-show-errors
left=$(s3 s3api list-objects-v2 --bucket "$OLD" --output json | jq '[.Contents[]?] | length')
[ "$left" = 0 ] || { echo "::error::$OLD 에 파일이 ${left}개 남아 버킷을 지우지 못했습니다"; exit 1; }
res=$(curl -s -X DELETE -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" "$API/accounts/$ACC/r2/buckets/$OLD")
if [ "$(printf '%s' "$res" | jq -r '.success')" = true ]; then
  echo "$OLD: 버킷 지움"
else
  echo "::error::버킷 지우기 실패: $(printf '%s' "$res" | jq -c '.errors')"
  exit 1
fi
