#!/usr/bin/env bash
# StockInvest signals → LoRA 학습 JSONL 추출 + home-m4-api 업로드.
#
# 동작 (Phase P 이후):
#   1. .env에서 DB_*·M4_API_URL·M4_ADMIN_TOKEN 로드
#   2. signals 테이블에서 도메인별(domestic/overseas) 분리 추출 (TSV)
#   3. build_trainset_jsonl.py로 도메인별 JSONL 변환
#   4. /tmp/trainset-YYYY-MM-DD-{domestic,overseas}.jsonl 저장
#   5. M4_API_URL 설정 시 curl POST + X-Admin-Token 으로 업로드
#      (미설정·M4_API_HOST 만 있는 경우 옛 scp 경로로 폴백 — 하위 호환)
#
# 호출:
#   ./scripts/export-llm-trainset.sh                  # 추출 + 로컬 저장만
#   M4_API_URL=http://m4.local:8000 \
#   M4_ADMIN_TOKEN=xxx ./scripts/export-llm-trainset.sh
#   ./scripts/export-llm-trainset.sh --dry-run        # SQL·JSONL만 생성, 업로드 skip
#
# Cron: cron-runner.sh에서 매일 03:00 실행

set -uo pipefail
PROJECT_DIR="${PROJECT_DIR:-/home/brownjeon/NFS/homes/brownjeon/project/StockInvest}"
ENV_FILE="$PROJECT_DIR/.env"
SCRIPT_DIR="$PROJECT_DIR/scripts"
OUT_DIR="${OUT_DIR:-/tmp}"

DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    *) echo "[export-trainset] unknown arg: $arg" >&2; exit 1 ;;
  esac
done

if [ ! -f "$ENV_FILE" ]; then
  echo "[export-trainset] .env not found at $ENV_FILE" >&2
  exit 1
fi

# .env에서 자격증명·M4 엔드포인트 로드
DB_HOST=$(grep '^DB_HOST=' "$ENV_FILE" | cut -d= -f2-)
DB_PORT=$(grep '^DB_PORT=' "$ENV_FILE" | cut -d= -f2-)
DB_USER=$(grep '^DB_USER=' "$ENV_FILE" | cut -d= -f2-)
DB_PWD=$(grep  '^DB_PWD='  "$ENV_FILE" | cut -d= -f2-)
DB_NAME=$(grep '^DB_NAME=' "$ENV_FILE" | cut -d= -f2-)
M4_API_URL_ENV=$(grep '^M4_API_URL='     "$ENV_FILE" | cut -d= -f2- || true)
M4_ADMIN_TOKEN_ENV=$(grep '^M4_ADMIN_TOKEN=' "$ENV_FILE" | cut -d= -f2- || true)
M4_AUTO_TRAIN_ENV=$(grep '^M4_AUTO_TRAIN=' "$ENV_FILE" | cut -d= -f2- || true)

# env 파일 값을 환경변수가 없을 때만 적용 (사용자 셸 export 우선)
M4_API_URL="${M4_API_URL:-${M4_API_URL_ENV:-}}"
M4_ADMIN_TOKEN="${M4_ADMIN_TOKEN:-${M4_ADMIN_TOKEN_ENV:-}}"
M4_AUTO_TRAIN="${M4_AUTO_TRAIN:-${M4_AUTO_TRAIN_ENV:-}}"

if [ -z "${DB_HOST:-}" ] || [ -z "${DB_USER:-}" ] || [ -z "${DB_PWD:-}" ] || [ -z "${DB_NAME:-}" ]; then
  echo "[export-trainset] DB credentials missing in .env" >&2
  exit 1
fi

DATE_STAMP=$(date +%F)

# 도메인별 SQL — market 컬럼으로 필터. price_1h_after IS NOT NULL OR ai_skipped 조건은 양 도메인 동일.
build_sql() {
  local market="$1"
  # Phase Q: 1h / 4h / 24h hit·pnl 모두 export. label_window 는 채워진 가장 긴 윈도우.
  # build_trainset_jsonl.py 가 24h > 4h > 1h 우선 순으로 학습 라벨 사용.
  cat <<EOSQL
SELECT s.id                                      AS signal_id,
       s.symbol,
       s.side,
       s.price,
       s.status,
       s.market,
       s.indicators,
       s.reasoning,
       s.price_1h_after,
       s.price_4h_after,
       s.price_24h_after,
       (CASE
          WHEN s.price_1h_after IS NULL THEN NULL
          WHEN s.side='buy'  AND s.price_1h_after > s.price THEN 1
          WHEN s.side='sell' AND s.price_1h_after < s.price THEN 1
          ELSE 0
        END)                                                                 AS hit_1h,
       (CASE
          WHEN s.price_4h_after IS NULL THEN NULL
          WHEN s.side='buy'  AND s.price_4h_after > s.price THEN 1
          WHEN s.side='sell' AND s.price_4h_after < s.price THEN 1
          ELSE 0
        END)                                                                 AS hit_4h,
       (CASE
          WHEN s.price_24h_after IS NULL THEN NULL
          WHEN s.side='buy'  AND s.price_24h_after > s.price THEN 1
          WHEN s.side='sell' AND s.price_24h_after < s.price THEN 1
          ELSE 0
        END)                                                                 AS hit_24h,
       (CASE WHEN s.price_1h_after IS NULL THEN NULL ELSE
         ((s.price_1h_after - s.price) / NULLIF(s.price,0) * 100) *
           CASE WHEN s.side='sell' THEN -1 ELSE 1 END
        END)                                                                 AS pnl_1h,
       (CASE WHEN s.price_4h_after IS NULL THEN NULL ELSE
         ((s.price_4h_after - s.price) / NULLIF(s.price,0) * 100) *
           CASE WHEN s.side='sell' THEN -1 ELSE 1 END
        END)                                                                 AS pnl_4h,
       (CASE WHEN s.price_24h_after IS NULL THEN NULL ELSE
         ((s.price_24h_after - s.price) / NULLIF(s.price,0) * 100) *
           CASE WHEN s.side='sell' THEN -1 ELSE 1 END
        END)                                                                 AS pnl_24h,
       (CASE
          WHEN s.price_24h_after IS NOT NULL THEN '24h'
          WHEN s.price_4h_after  IS NOT NULL THEN '4h'
          WHEN s.price_1h_after  IS NOT NULL THEN '1h'
          ELSE NULL
        END)                                                                 AS label_window,
       s.created_at
FROM signals s
WHERE s.created_at > DATE_SUB(NOW(), INTERVAL 90 DAY)
  AND s.market = '${market}'
  AND (s.price_1h_after IS NOT NULL OR s.status = 'ai_skipped')
ORDER BY s.created_at DESC;
EOSQL
}

# 도메인 1개 처리 (extract → JSONL → upload). 실패해도 다른 도메인은 계속 진행.
process_domain() {
  local domain="$1"
  local out_file="$OUT_DIR/trainset-${DATE_STAMP}-${domain}.jsonl"
  local tmp_tsv
  tmp_tsv=$(mktemp /tmp/trainset-${domain}.XXXXXX.tsv)
  # shellcheck disable=SC2064
  trap "rm -f '$tmp_tsv'" RETURN

  echo "[export-trainset:$domain] querying DB ($DB_HOST/$DB_NAME) ..."
  local sql
  sql=$(build_sql "$domain")

  if ! mysql --connect-timeout=15 \
        -h "$DB_HOST" -P "${DB_PORT:-3306}" -u "$DB_USER" -p"$DB_PWD" \
        --batch --raw \
        "$DB_NAME" -e "$sql" > "$tmp_tsv" 2> >(grep -v 'Warning' >&2); then
    echo "[export-trainset:$domain] mysql failed" >&2
    return 2
  fi

  local row_count
  row_count=$(wc -l < "$tmp_tsv")
  row_count=$((row_count - 1))  # header 제외
  echo "[export-trainset:$domain] fetched rows: $row_count"

  if [ "$row_count" -le 0 ]; then
    echo "[export-trainset:$domain] no rows — skip output" >&2
    return 0
  fi

  python3 "$SCRIPT_DIR/build_trainset_jsonl.py" < "$tmp_tsv" > "$out_file"
  local jsonl_count
  jsonl_count=$(wc -l < "$out_file")
  echo "[export-trainset:$domain] wrote $jsonl_count examples → $out_file"

  if [ "$DRY_RUN" -eq 1 ]; then
    echo "[export-trainset:$domain] DRY_RUN — skip upload"
    return 0
  fi

  upload_to_m4 "$out_file" "$domain"
}

# M4 API 업로드 — curl POST(권장) 또는 scp 폴백.
upload_to_m4() {
  local file="$1"
  local domain="$2"
  local filename
  filename=$(basename "$file")

  if [ -n "$M4_API_URL" ] && [ -n "$M4_ADMIN_TOKEN" ]; then
    echo "[export-trainset:$domain] HTTPS upload → $M4_API_URL/v1/dataset/upload"
    local code
    code=$(curl -sS --connect-timeout 10 --max-time 60 \
      -o /tmp/m4-upload-$$.json -w "%{http_code}" \
      -X POST "$M4_API_URL/v1/dataset/upload?overwrite=true" \
      -H "X-Admin-Token: $M4_ADMIN_TOKEN" \
      -F "file=@${file};filename=${filename};type=application/x-ndjson")

    if [ "$code" != "200" ]; then
      echo "[export-trainset:$domain] upload failed (HTTP $code): $(cat /tmp/m4-upload-$$.json 2>/dev/null)" >&2
      rm -f /tmp/m4-upload-$$.json
      return 3
    fi
    echo "[export-trainset:$domain] uploaded: $(cat /tmp/m4-upload-$$.json)"
    rm -f /tmp/m4-upload-$$.json

    # Phase S: 업로드 성공 시 fine-tune 자동 트리거 (M4_AUTO_TRAIN=1 일 때만).
    # M4 측 max_concurrent=1 이므로 첫 번째 도메인이 학습 중이면 두 번째는 429 — 무시.
    if [ "${M4_AUTO_TRAIN:-}" = "1" ] || [ "${M4_AUTO_TRAIN:-}" = "true" ]; then
      echo "[export-trainset:$domain] auto-train trigger"
      local train_code
      train_code=$(curl -sS --connect-timeout 10 --max-time 30 \
        -o /tmp/m4-train-$$.json -w "%{http_code}" \
        -X POST "$M4_API_URL/v1/dataset/train" \
        -H "X-Admin-Token: $M4_ADMIN_TOKEN" \
        -H 'Content-Type: application/json' \
        -d "{\"dataset_filename\":\"${filename}\"}")
      if [ "$train_code" = "200" ]; then
        echo "[export-trainset:$domain] train queued: $(cat /tmp/m4-train-$$.json)"
      elif [ "$train_code" = "429" ]; then
        echo "[export-trainset:$domain] train skipped (M4 max_concurrent in use): $(cat /tmp/m4-train-$$.json)" >&2
      else
        echo "[export-trainset:$domain] train trigger failed (HTTP $train_code): $(cat /tmp/m4-train-$$.json)" >&2
      fi
      rm -f /tmp/m4-train-$$.json
    fi
    return 0
  fi

  # 하위 호환: M4_API_HOST 가 설정돼 있으면 옛 scp 경로 사용
  if [ -n "${M4_API_HOST:-}" ]; then
    local remote_dir="${M4_API_REMOTE_DIR:-/data/trainset}"
    echo "[export-trainset:$domain] (legacy) scp → $M4_API_HOST:$remote_dir/"
    if scp -o ConnectTimeout=10 -o BatchMode=yes "$file" "$M4_API_HOST:$remote_dir/"; then
      echo "[export-trainset:$domain] uploaded via scp"
    else
      echo "[export-trainset:$domain] scp failed — local file kept at $file" >&2
      return 3
    fi
    return 0
  fi

  echo "[export-trainset:$domain] M4_API_URL/M4_API_HOST 미설정 — 업로드 skip (로컬 보존)"
}

# 메인 흐름 — 도메인 2개 순차 처리
RC_OVERALL=0
for d in domestic overseas; do
  if ! process_domain "$d"; then
    RC_OVERALL=$?
    echo "[export-trainset] domain '$d' rc=$RC_OVERALL — 다음 도메인 계속" >&2
  fi
done

# 30일 이상 된 로컬 jsonl 정리
find "$OUT_DIR" -maxdepth 1 -name 'trainset-*.jsonl' -mtime +30 -delete 2>/dev/null || true

if [ "$RC_OVERALL" -ne 0 ]; then
  echo "[export-trainset] 일부 도메인 실패 (rc=$RC_OVERALL)"
  exit "$RC_OVERALL"
fi

echo "[export-trainset] done"
