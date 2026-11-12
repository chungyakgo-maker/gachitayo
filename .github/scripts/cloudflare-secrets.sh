#!/usr/bin/env bash
# Cloudflare 비밀값 다듬기 (M6 배포): 비밀값에 실수로 같이 붙여 넣은 것(공백·줄바꿈, 'Bearer', 따옴표,
# 토큰 확인용 curl 명령, 주소창 주소)이 있어도 실제 토큰과 계정 ID만 꺼내 쓴다.
# 꺼낸 값은 먼저 로그에서 가리고, 값 자체는 어디에도 출력하지 않는다.
# Cloudflare에 토큰이 살아 있는지, 계정 ID가 그 토큰의 계정인지도 미리 확인해 알기 쉬운 말로 알린다.
set -uo pipefail
export LC_ALL=C.UTF-8

raw_token="${CLOUDFLARE_API_TOKEN:-}"
raw_account="${CLOUDFLARE_ACCOUNT_ID:-}"

# 영문·숫자·-·_ 로만 된 덩어리들 (공백·따옴표·콜론·슬래시·한글 등에서 끊는다)
runs() { printf '%s' "$1" | grep -oE '[A-Za-z0-9_-]+' || true; }

describe() {
  local v="$1" notes=()
  [[ "$v" == *curl* ]] && notes+=("curl 명령")
  [[ "$v" == *http* ]] && notes+=("인터넷 주소")
  [[ "$v" == *Bearer* ]] && notes+=("'Bearer' 글자")
  [[ "$v" == *'"'* || "$v" == *"'"* ]] && notes+=("따옴표")
  printf '%s' "$v" | grep -qP '[\x{AC00}-\x{D7A3}]' 2>/dev/null && notes+=("한글")
  if [ ${#notes[@]} -gt 0 ]; then
    local joined
    joined=$(printf ', %s' "${notes[@]}")
    echo "붙여 넣은 값에 섞인 것: ${joined:2}"
  else
    echo "붙여 넣은 값 길이 ${#v}자"
  fi
}

# 토큰 후보: 'Bearer'를 떼고, 32~120자이면서 영문과 숫자가 둘 다 섞인 덩어리 (계정 ID 모양 32자리 16진수는 뺀다)
mapfile -t token_cands < <(runs "$raw_token" | sed 's/^Bearer//' |
  awk 'length($0) >= 32 && length($0) <= 120 && /[0-9]/ && /[A-Za-z]/' |
  grep -vxE '[0-9a-fA-F]{32}' | sort -u)
# 계정 ID 후보: 정확히 32자리 16진수인 덩어리
mapfile -t account_cands < <(runs "$raw_account" | grep -xE '[0-9a-fA-F]{32}' | tr 'A-F' 'a-f' | sort -u)

for v in "${token_cands[@]}" "${account_cands[@]}"; do echo "::add-mask::$v"; done

if [ ${#token_cands[@]} -ne 1 ]; then
  echo "::error::CLOUDFLARE_API_TOKEN에서 토큰을 찾지 못했습니다 ($(describe "$raw_token"), 토큰처럼 보이는 값 ${#token_cands[@]}개). Cloudflare 토큰 화면의 토큰 값(영문·숫자 40~50자 안팎) 하나만 다시 등록해 주세요."
  exit 1
fi
token="${token_cands[0]}"
[ "$token" = "$(printf '%s' "$raw_token" | tr -d '[:space:]')" ] || echo "::notice::CLOUDFLARE_API_TOKEN에 토큰 말고 다른 글자가 섞여 있어 토큰만 꺼내 씁니다 ($(describe "$raw_token")). 나중에 토큰 값만 다시 등록해 두면 좋습니다."

account=""
if [ ${#account_cands[@]} -eq 1 ]; then
  account="${account_cands[0]}"
  [ "$account" = "$(printf '%s' "$raw_account" | tr -d '[:space:]')" ] || echo "::notice::CLOUDFLARE_ACCOUNT_ID에 계정 ID 말고 다른 글자가 섞여 있어 32자리 계정 ID만 꺼내 씁니다."
else
  why="$(describe "$raw_account"), 계정 ID처럼 보이는 값 ${#account_cands[@]}개"
  [ "$(printf '%s' "$raw_account" | tr -d '[:space:]')" = "$token" ] && why="계정 ID 칸에 토큰이 들어 있음"
fi

if [ "${SKIP_CLOUDFLARE_CHECK:-}" = "1" ]; then
  if [ -z "$account" ]; then
    echo "::error::CLOUDFLARE_ACCOUNT_ID에서 32자리 계정 ID를 찾지 못했습니다 ($why)."
    exit 1
  fi
else
  api() { curl -sS --max-time 30 -H "Authorization: Bearer $token" "https://api.cloudflare.com/client/v4$1" 2>/dev/null; }
  success() { grep -q '"success":[[:space:]]*true'; }
  user_verify=$(api /user/tokens/verify)
  if [ -z "$user_verify" ]; then
    echo "::warning::Cloudflare에 연결하지 못해 토큰을 미리 확인하지 못했습니다. 그대로 배포를 시도합니다."
    if [ -z "$account" ]; then
      echo "::error::CLOUDFLARE_ACCOUNT_ID에서 32자리 계정 ID를 찾지 못했습니다 ($why). Cloudflare 주소창의 dash.cloudflare.com/ 바로 뒤 32자를 다시 등록해 주세요."
      exit 1
    fi
  else
    token_ok() { printf '%s' "$user_verify" | success || { [ -n "$account" ] && api "/accounts/$account/tokens/verify" | success; }; }
    if [ -z "$account" ] || ! token_ok; then
      # 계정 ID 칸이 비었거나 토큰의 계정과 다르면, 토큰으로 접근할 수 있는 계정을 Cloudflare에 물어본다 (하나뿐이면 그것을 쓴다)
      mapfile -t ids < <(api "/accounts?per_page=50" | jq -r '.result[]?.id // empty' 2>/dev/null | grep -xE '[0-9a-f]{32}' | sort -u)
      for v in "${ids[@]}"; do echo "::add-mask::$v"; done
      if [ ${#ids[@]} -eq 1 ] && [ "${ids[0]}" != "$account" ]; then
        [ -n "$account" ] && why="토큰을 만든 계정의 ID와 다름"
        account="${ids[0]}"
        echo "::notice::CLOUDFLARE_ACCOUNT_ID가 맞지 않아서($why) 토큰의 계정을 찾아 씁니다. 나중에 Cloudflare 주소창의 dash.cloudflare.com/ 바로 뒤 32자로 다시 등록해 두면 좋습니다."
      elif [ ${#ids[@]} -gt 1 ] && [ -z "$account" ]; then
        echo "::error::CLOUDFLARE_ACCOUNT_ID에서 32자리 계정 ID를 찾지 못했습니다 ($why). 토큰으로 찾은 계정이 ${#ids[@]}개라 고를 수 없습니다. Cloudflare 주소창의 dash.cloudflare.com/ 바로 뒤 32자를 다시 등록해 주세요."
        exit 1
      fi
    fi
    if token_ok; then
      echo "Cloudflare가 토큰을 확인했습니다 (살아 있음)."
    else
      echo "::error::Cloudflare가 이 토큰을 받아 주지 않습니다 (지워졌거나, 기간이 지났거나, 일부만 복사됨). Cloudflare → 오른쪽 위 사람 아이콘 → My Profile → API Tokens에서 이 토큰의 '...' → Roll(새 값 받기)을 누르고, 새 값만 CLOUDFLARE_API_TOKEN에 다시 등록해 주세요."
      exit 1
    fi
    if [ -z "$account" ]; then
      echo "::error::CLOUDFLARE_ACCOUNT_ID에서 32자리 계정 ID를 찾지 못했습니다 ($why). Cloudflare 주소창의 dash.cloudflare.com/ 바로 뒤 32자를 다시 등록해 주세요."
      exit 1
    fi
    if api "/accounts/$account/workers/scripts" | success; then
      echo "계정 ID와 토큰의 계정이 맞습니다 (Workers 권한 확인)."
    else
      echo "::error::토큰은 살아 있지만 이 계정의 Workers에 접근할 수 없습니다. 계정 ID가 토큰을 만든 계정의 것인지, 토큰 권한에 Workers Scripts: Edit가 있고 Account Resources가 내 계정으로 되어 있는지 확인해 주세요."
      exit 1
    fi
  fi
fi

echo "CLOUDFLARE_API_TOKEN=$token" >> "${GITHUB_ENV:-/dev/null}"
echo "CLOUDFLARE_ACCOUNT_ID=$account" >> "${GITHUB_ENV:-/dev/null}"
echo "비밀값 확인 완료 (토큰 ${#token}자, 계정 ID ${#account}자)"
