#!/usr/bin/env python3
"""
StockInvest signals/signal_followup → home-m4-api LoRA fine-tune JSONL 변환.

입력: stdin (mysql --batch CSV/TSV — \\t 구분, 헤더 1행)
출력: stdout (JSONL — 라인당 1개 학습 예시)

각 학습 예시:
{
  "messages": [
    {"role": "system",    "content": "<시스템 프롬프트>"},
    {"role": "user",      "content": "<재구성된 분석가 프롬프트>"},
    {"role": "assistant", "content": "<JSON 응답 — 실제 결과 라벨링>"}
  ],
  "metadata": {"signal_id": ..., "hit": 0/1, "actual_pnl_pct": ..., "regime_bucket": "...", "date": "YYYY-MM-DD"}
}

LoRA 학습 시 hit=1 (적중) 시그널은 positive, hit=0 (빗나감)은 reasoning을 corrective하게 변형해
"왜 그 판단이 틀렸는지" 가르치는 negative example로 변환.

호출 예:
  mysql -h ... -e "<SELECT ...>" --batch | python3 build_trainset_jsonl.py > trainset-2026-04-26.jsonl
"""
from __future__ import annotations

import csv
import json
import sys
from datetime import datetime
from typing import Any

SYSTEM_PROMPT = (
    "당신은 한국·미국 주식 + 암호화폐 퀀트 트레이딩 시그널 평가 전문가입니다.\n"
    "EV(기대값) 공식: EV = P_win × R_win − (1−P_win)×|R_loss| − 수수료\n"
    "- 국내주식 0.43%, 미국주식 0.50%, 코인 0.20%\n"
    "- EV > +0.1% AND confidence ≥ 임계 → selectedIndices에 추가, 최대 3개\n"
    "- 모든 후보 EV ≤ 0 → selectedIndices = []\n"
    "응답: JSON 형식, selectedIndices 배열, confidence 0~100, ev{pWin,rWin,rLoss,evPct}, reasoning(한국어), warnings 배열."
)


def safe_json_loads(s: str) -> dict[str, Any]:
    if not s or s in ("NULL", "\\N"):
        return {}
    try:
        return json.loads(s)
    except (json.JSONDecodeError, TypeError):
        return {}


def build_user_prompt(row: dict[str, str]) -> str:
    """
    signals 행 + indicators JSON을 분석가 프롬프트 형태로 재구성.
    실제 ai-filter.ts buildSelectPrompt 출력과 정확히 일치할 필요는 없음 — LLM이 패턴 학습 가능한 수준이면 충분.
    """
    indicators = safe_json_loads(row.get("indicators", "{}"))
    ai = indicators.get("ai", {}) if isinstance(indicators, dict) else {}
    regime = ai.get("regimeBucket", "unknown")

    market = row.get("market", "domestic")
    fee = "0.50%" if market == "overseas" else "0.43%"

    return (
        f"## 종목 평가 요청\n"
        f"- 심볼: {row.get('symbol','?')} ({market})\n"
        f"- 후보 시그널: {row.get('side','?').upper()} @ ₩{row.get('price','0')}\n"
        f"- regime bucket: {regime}\n"
        f"- 수수료: {fee} (왕복 기준)\n\n"
        f"## 평가 방식\n"
        f"selectedIndices에 EV>0.1% 통과한 후보 인덱스를 EV 큰 순 최대 3개 입력.\n"
        f"모두 부적합하면 빈 배열.\n\n"
        f"## 응답 형식 (JSON)\n"
        f'{{"selectedIndices":[...],"confidence":...,"ev":{{...}},"reasoning":"...","warnings":[]}}'
    )


_NULL_VALUES: set[str | None] = {None, "", "NULL", "\\N"}


def _safe_int(v: str | None, default: int = 0) -> int:
    if v in _NULL_VALUES:
        return default
    try:
        return int(v)  # type: ignore[arg-type]
    except (ValueError, TypeError):
        return default


def _safe_float(v: str | None, default: float = 0.0) -> float:
    if v in _NULL_VALUES:
        return default
    try:
        return float(v)  # type: ignore[arg-type]
    except (ValueError, TypeError):
        return default


def _resolve_best_label(row: dict[str, str]) -> tuple[int, float, str]:
    """
    Phase Q: 24h > 4h > 1h 우선순으로 학습 라벨 선택.
    Returns: (hit_best, pnl_best, label_window)
        label_window ∈ {'24h','4h','1h','none'}

    hit_*가 NULL이 아니면(채워진 윈도우면) 해당 윈도우 채택.
    pnl_*가 NULL인 경우(가격 컬럼 데이터 결손)는 0.0으로 간주하되 윈도우 라벨은 유지.
    """
    for window, hit_key, pnl_key in (
        ("24h", "hit_24h", "pnl_24h"),
        ("4h",  "hit_4h",  "pnl_4h"),
        ("1h",  "hit_1h",  "pnl_1h"),
    ):
        v = row.get(hit_key)
        if v not in _NULL_VALUES:
            return (_safe_int(v), _safe_float(row.get(pnl_key)), window)
    # legacy 폴백 (Phase Q 이전 export 형식 — hit·actual_pnl_pct 단일 컬럼)
    if row.get("hit") not in _NULL_VALUES:
        return (_safe_int(row.get("hit")), _safe_float(row.get("actual_pnl_pct")), "1h")
    return (0, 0.0, "none")


def build_assistant_response(row: dict[str, str]) -> str:
    """
    실제 시그널이 발화됐고 사후 결과(hit/miss)가 나왔을 때 LLM이 했어야 할 응답을 합성.

    hit=1: 원래 응답 그대로 (positive example)
    hit=0: confidence 다운그레이드 + warnings에 "(사후 라벨: 빗나감 — 신중 권장)" 추가 (corrective example)

    Phase Q: 라벨은 24h > 4h > 1h 우선순으로 선택 — 장기 노이즈 감소.
    """
    indicators = safe_json_loads(row.get("indicators", "{}"))
    ai = indicators.get("ai", {}) if isinstance(indicators, dict) else {}

    confidence = int(ai.get("confidence", 50))
    ev_obj = ai.get("ev", {}) if isinstance(ai, dict) else {}
    warnings_orig: list[str] = ai.get("warnings", []) if isinstance(ai, dict) else []
    if not isinstance(warnings_orig, list):
        warnings_orig = []
    reasoning = (row.get("reasoning") or "").replace("\n", " ").strip()

    hit, actual_pnl, _label_window = _resolve_best_label(row)
    is_skipped = (row.get("status") == "ai_skipped") or (ai.get("skipCategory") in (
        "ai_rejected", "ai_low_confidence", "rule_prefilter"))

    # 스킵 시그널: selectedIndices=[], 사후 결과로 라벨 보강
    if is_skipped:
        warnings = list(warnings_orig)
        # actual_pnl이 양수였다면 "스킵이 오답이었음" 학습
        if hit and actual_pnl > 0.5:
            warnings.append(f"(사후 라벨: 스킵했으나 +{actual_pnl:.2f}% — 진입 검토 가능)")
        resp = {
            "selectedIndices": [],
            "confidence": confidence,
            "ev": {
                "pWin":  float(ev_obj.get("pWin", 0)),
                "rWin":  float(ev_obj.get("rWin", 0)),
                "rLoss": float(ev_obj.get("rLoss", 0)),
                "evPct": float(ev_obj.get("evPct", 0)),
            },
            "reasoning": reasoning,
            "warnings": warnings,
        }
    else:
        # 승인 시그널: selectedIndices=[0] (단일 후보 가정)
        # hit=0이면 confidence/EV 하향
        adjusted_conf = confidence if hit else max(0, confidence - 15)
        warnings = list(warnings_orig)
        if not hit:
            warnings.append(
                f"(사후 라벨: 진입 후 {actual_pnl:+.2f}% — 신호 약하거나 시장 역행)"
            )
        resp = {
            "selectedIndices": [] if not hit and adjusted_conf < 45 else [0],
            "confidence": adjusted_conf,
            "ev": {
                "pWin":  float(ev_obj.get("pWin",  0.5 if hit else 0.4)),
                "rWin":  float(ev_obj.get("rWin",  abs(actual_pnl) if hit else 0.5)),
                "rLoss": float(ev_obj.get("rLoss", -1.0)),
                "evPct": actual_pnl - 0.43,  # 사후 실측 - 수수료
            },
            "reasoning": reasoning,
            "warnings": warnings,
        }

    return json.dumps(resp, ensure_ascii=False)


def _opt_int(row: dict[str, str], key: str) -> int | None:
    v = row.get(key)
    if v in _NULL_VALUES:
        return None
    try:
        return int(v)  # type: ignore[arg-type]
    except (ValueError, TypeError):
        return None


def _opt_float(row: dict[str, str], key: str) -> float | None:
    v = row.get(key)
    if v in _NULL_VALUES:
        return None
    try:
        return float(v)  # type: ignore[arg-type]
    except (ValueError, TypeError):
        return None


def build_metadata(row: dict[str, str]) -> dict[str, Any]:
    indicators = safe_json_loads(row.get("indicators", "{}"))
    ai = indicators.get("ai", {}) if isinstance(indicators, dict) else {}
    market = (row.get("market") or "").strip().lower()
    domain = market if market in ("domestic", "overseas") else "unknown"
    fee_pct = 0.43 if domain == "domestic" else (0.50 if domain == "overseas" else 0.43)
    hit_best, pnl_best, label_window = _resolve_best_label(row)
    return {
        "signal_id":      int(row.get("signal_id", 0) or 0),
        "symbol":         row.get("symbol", ""),
        "domain":         domain,                    # 'domestic' | 'overseas' | 'unknown'
        "fee_pct":        fee_pct,                   # 도메인별 왕복 수수료
        "regime_bucket":  ai.get("regimeBucket", "unknown") if isinstance(ai, dict) else "unknown",
        "side":           row.get("side", ""),
        # Phase Q: 윈도우별 hit·pnl + 우선 채택 라벨 — 0이 채워짐을 의미하므로 `or` 사용 X
        "hit_1h":         _opt_int(row, "hit_1h")   if "hit_1h"   in row else _opt_int(row, "hit"),
        "hit_4h":         _opt_int(row, "hit_4h"),
        "hit_24h":        _opt_int(row, "hit_24h"),
        "pnl_1h":         _opt_float(row, "pnl_1h") if "pnl_1h"   in row else _opt_float(row, "actual_pnl_pct"),
        "pnl_4h":         _opt_float(row, "pnl_4h"),
        "pnl_24h":        _opt_float(row, "pnl_24h"),
        "label_window":   label_window,              # '24h' | '4h' | '1h' | 'none'
        # Backcompat — fine-tune 코드가 단일 hit/actual_pnl_pct 만 보는 경우 대응
        "hit":            hit_best,
        "actual_pnl_pct": pnl_best,
        "status":         row.get("status", ""),
        "date":           (row.get("created_at", "") or "")[:10],
    }


def main() -> int:
    reader = csv.DictReader(sys.stdin, delimiter="\t")
    written = 0
    skipped = 0
    for row in reader:
        # 빈 행 / 헤더 잔재 / 비정상 행 스킵
        if not row.get("signal_id"):
            skipped += 1
            continue
        try:
            example = {
                "messages": [
                    {"role": "system",    "content": SYSTEM_PROMPT},
                    {"role": "user",      "content": build_user_prompt(row)},
                    {"role": "assistant", "content": build_assistant_response(row)},
                ],
                "metadata": build_metadata(row),
            }
            sys.stdout.write(json.dumps(example, ensure_ascii=False) + "\n")
            written += 1
        except Exception as e:
            print(f"[build-trainset] row skip signal_id={row.get('signal_id')}: {e}", file=sys.stderr)
            skipped += 1

    print(f"[build-trainset] written={written} skipped={skipped} ts={datetime.now().isoformat()}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
