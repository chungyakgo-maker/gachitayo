#!/usr/bin/env bash
# 서버 저장 용량 확인 (사용자 질문 "지금 용량 얼만큼 썼냐"): 같이타요가 쓰는 Cloudflare 저장소만 읽어서 크기를 알린다.
# 읽기만 한다 (지우거나 바꾸지 않는다). 이름이 gachitayo로 시작하는 버킷·데이터베이스만 본다 (다른 앱 자원은 보지 않는다).
# 예전 미국 지도 버킷 gachitayo-map은 2026-11-13에 지웠다 (사용자 요청).
# 결과는 로그와 Actions 실행 화면의 요약(Summary)에 표로 남는다.
set -uo pipefail
export LC_ALL=C.UTF-8

API=https://api.cloudflare.com/client/v4
ACC="$CLOUDFLARE_ACCOUNT_ID"
auth=(-H "Authorization: Bearer $CLOUDFLARE_API_TOKEN")
summary="${GITHUB_STEP_SUMMARY:-/dev/stdout}"

mb() { awk -v b="$1" 'BEGIN { printf "%.1f MB", b / 1000000 }'; }

# R2: S3 방식으로 목록을 읽어 크기를 더한다 (열쇠는 map-data.sh와 같은 방법: 토큰 ID, 토큰의 SHA-256)
tid=$(curl -s "${auth[@]}" "$API/user/tokens/verify" | jq -r '.result.id // empty')
[ -n "$tid" ] || tid=$(curl -s "${auth[@]}" "$API/accounts/$ACC/tokens/verify" | jq -r '.result.id // empty')
[ -n "$tid" ] || { echo "::error::Cloudflare 토큰 ID를 알 수 없어 R2 크기를 읽을 수 없습니다"; exit 1; }
secret=$(printf '%s' "$CLOUDFLARE_API_TOKEN" | sha256sum | cut -d' ' -f1)
echo "::add-mask::$secret"
s3() {
  AWS_ACCESS_KEY_ID="$tid" AWS_SECRET_ACCESS_KEY="$secret" AWS_DEFAULT_REGION=auto \
    AWS_REQUEST_CHECKSUM_CALCULATION=when_required AWS_RESPONSE_CHECKSUM_VALIDATION=when_required \
    aws s3api list-objects-v2 --bucket "$1" --endpoint-url "https://$ACC.r2.cloudflarestorage.com" --output json 2>/dev/null
}

total=0
{
  echo "## 같이타요 서버 저장 용량 ($(TZ=Asia/Seoul date '+%Y-%m-%d %H:%M') 한국 시각)"
  echo
  echo "| 저장소 | 무엇 | 파일 수 | 크기 |"
  echo "|---|---|---:|---:|"
} >> "$summary"

for b in gachitayo-map-apac gachitayo-sessions; do
  case "$b" in
    gachitayo-map-apac) what="선 지도 (한국 지도 파일 + 글자 조각, 지금 쓰는 것)" ;;
    gachitayo-sessions) what="주행 기록 원본 파일" ;;
  esac
  json=$(s3 "$b")
  if [ -z "$json" ]; then
    echo "$b: 없음 (또는 읽을 수 없음)"
    echo "| R2 \`$b\` | $what | - | 없음 |" >> "$summary"
    continue
  fi
  # 버킷이 비어 있으면 Contents가 없다. 1000개가 넘으면 aws가 알아서 이어 읽는다
  n=$(printf '%s' "$json" | jq '[.Contents[]?] | length')
  bytes=$(printf '%s' "$json" | jq '[.Contents[]?.Size] | add // 0')
  total=$((total + bytes))
  echo "$b: 파일 ${n}개, $(mb "$bytes") ($bytes 바이트)"
  echo "| R2 \`$b\` | $what | $n | $(mb "$bytes") |" >> "$summary"
  # 큰 파일 몇 개
  printf '%s' "$json" | jq -r '[.Contents[]?] | sort_by(-.Size) | .[:3][] | "    \(.Key): \(.Size) 바이트"'
done

# D1 데이터베이스 (계정·코스·세션·랩 표)
uuid=$(curl -s "${auth[@]}" "$API/accounts/$ACC/d1/database?name=gachitayo" | jq -r '.result[]? | select(.name == "gachitayo") | .uuid' | head -1)
if [ -n "$uuid" ]; then
  d1=$(curl -s "${auth[@]}" "$API/accounts/$ACC/d1/database/$uuid")
  dbytes=$(printf '%s' "$d1" | jq -r '.result.file_size // 0')
  tables=$(printf '%s' "$d1" | jq -r '.result.num_tables // "-"')
  total=$((total + dbytes))
  echo "D1 gachitayo: 표 ${tables}개, $(mb "$dbytes")"
  echo "| D1 \`gachitayo\` | 계정·코스·기록 표 (표 ${tables}개) | - | $(mb "$dbytes") |" >> "$summary"
else
  echo "D1 gachitayo: 찾지 못함"
  echo "| D1 \`gachitayo\` | 계정·코스·기록 표 | - | 찾지 못함 |" >> "$summary"
fi

echo "합계: $(mb "$total")"
{
  echo "| **합계** | | | **$(mb "$total")** |"
  echo
  echo "무료 한도(참고): R2 저장 10 GB/월, D1 저장 5 GB."
} >> "$summary"
