#!/usr/bin/env bash
# StockInvest signals + signal_followup → LoRA 학습 JSONL 추출 + home-m4-api 전송.
#
# 동작:
#   1. .env에서 DB_* 자격증명 로드
#   2. signals + signal_followup JOIN으로 최근 90일 데이터 추출 (TSV)
#   3. build_trainset_jsonl.py로 JSONL 변환
#   4. /tmp/trainset-YYYY-MM-DD.jsonl 저장
#   5. (선택) M4_API_HOST 설정 시 scp로 home-m4-api:/data/trainset/ 전송
#
# 호출:
#   ./scripts/export-llm-trainset.sh                # 추출 + 로컬 저장만
#   M4_API_HOST=user@m4.local ./scripts/export-llm-trainset.sh    # + scp 전송
#
# Cron: cron-runner.sh에서 매일 03:00 실행

set -uo pipefail
PROJECT_DIR="${PROJECT_DIR:-/home/brownjeon/NFS/homes/brownjeon/project/StockInvest}"
ENV_FILE="$PROJECT_DIR/.env"
SCRIPT_DIR="$PROJECT_DIR/scripts"
OUT_DIR="${OUT_DIR:-/tmp}"

if [ ! -f "$ENV_FILE" ]; then
  echo "[export-trainset] .env not found at $ENV_FILE" >&2
  exit 1
fi

# .env에서 DB 자격증명 로드 (값에 = 포함될 수 있음)
DB_HOST=$(grep '^DB_HOST=' "$ENV_FILE" | cut -d= -f2-)
DB_PORT=$(grep '^DB_PORT=' "$ENV_FILE" | cut -d= -f2-)
DB_USER=$(grep '^DB_USER=' "$ENV_FILE" | cut -d= -f2-)
DB_PWD=$(grep  '^DB_PWD='  "$ENV_FILE" | cut -d= -f2-)
DB_NAME=$(grep '^DB_NAME=' "$ENV_FILE" | cut -d= -f2-)

if [ -z "${DB_HOST:-}" ] || [ -z "${DB_USER:-}" ] || [ -z "${DB_PWD:-}" ] || [ -z "${DB_NAME:-}" ]; then
  echo "[export-trainset] DB credentials missing in .env" >&2
  exit 1
fi

DATE_STAMP=$(date +%F)
OUT_FILE="$OUT_DIR/trainset-$DATE_STAMP.jsonl"

# 학습 데이터 추출 SQL
# - 90일 누적 시그널 (자동승인·실행·스킵 모두 포함)
# - signals.price_1h_after / price_change_pct 컬럼이 followup 데이터 (별도 테이블 없음)
SQL=$(cat <<'EOSQL'
SELECT s.id                                      AS signal_id,
       s.symbol,
       s.side,
       s.price,
       s.status,
       s.market,
       s.indicators,
       s.reasoning,
       s.price_1h_after,
       (CASE
          WHEN s.price_1h_after IS NULL THEN 0
          WHEN s.side='buy'  AND s.price_1h_after > s.price THEN 1
          WHEN s.side='sell' AND s.price_1h_after < s.price THEN 1
          ELSE 0
        END)                                                                 AS hit,
       COALESCE(
         ((s.price_1h_after - s.price) / NULLIF(s.price,0) * 100) *
           CASE WHEN s.side='sell' THEN -1 ELSE 1 END,
         0
       )                                                                     AS actual_pnl_pct,
       s.created_at
FROM signals s
WHERE s.created_at > DATE_SUB(NOW(), INTERVAL 90 DAY)
  AND (s.price_1h_after IS NOT NULL OR s.status = 'ai_skipped')
ORDER BY s.created_at DESC;
EOSQL
)

echo "[export-trainset] querying DB ($DB_HOST/$DB_NAME) ..."
TMP_TSV=$(mktemp /tmp/trainset-raw.XXXXXX.tsv)
trap 'rm -f "$TMP_TSV"' EXIT

mysql --connect-timeout=15 \
  -h "$DB_HOST" -P "${DB_PORT:-3306}" -u "$DB_USER" -p"$DB_PWD" \
  --batch --raw \
  "$DB_NAME" -e "$SQL" > "$TMP_TSV" 2> >(grep -v 'Warning' >&2) || {
    echo "[export-trainset] mysql failed" >&2
    exit 2
  }

ROW_COUNT=$(wc -l < "$TMP_TSV")
ROW_COUNT=$((ROW_COUNT - 1))  # header 제외
echo "[export-trainset] fetched rows: $ROW_COUNT"

if [ "$ROW_COUNT" -le 0 ]; then
  echo "[export-trainset] no rows — skip output" >&2
  exit 0
fi

# JSONL 변환
python3 "$SCRIPT_DIR/build_trainset_jsonl.py" < "$TMP_TSV" > "$OUT_FILE"
JSONL_COUNT=$(wc -l < "$OUT_FILE")
echo "[export-trainset] wrote $JSONL_COUNT examples → $OUT_FILE"

# (선택) home-m4-api 서버로 전송
if [ -n "${M4_API_HOST:-}" ]; then
  REMOTE_DIR="${M4_API_REMOTE_DIR:-/data/trainset}"
  echo "[export-trainset] uploading to $M4_API_HOST:$REMOTE_DIR/ ..."
  scp -o ConnectTimeout=10 -o BatchMode=yes "$OUT_FILE" \
      "$M4_API_HOST:$REMOTE_DIR/" && {
    echo "[export-trainset] uploaded successfully"
  } || {
    echo "[export-trainset] scp failed — local file kept at $OUT_FILE" >&2
    exit 3
  }
fi

# 30일 이상 된 로컬 jsonl 정리 (선택)
find "$OUT_DIR" -maxdepth 1 -name 'trainset-*.jsonl' -mtime +30 -delete 2>/dev/null || true

echo "[export-trainset] done"
