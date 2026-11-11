/**
 * Analyst 기대값 오라클(T-165 §9) — `~/.node-local/t165-analyst/test-cases-expected.json`
 * (sha256 584ee43b818a4add, 참조 계산기 `t165_gen.py` 산출)을 변환 스크립트로 **리터럴로** 옮긴 것.
 * 시험이 저장소 밖 파일을 읽지 않게 하려고 저장소 안에 둔다. 손으로 고치지 않는다.
 * 각 `expected` 는 부분 객체다 — `toMatchObject` 로 비교한다(H15·H16·S2 는 cpi 축이 없다 = 미계산).
 */
/* eslint-disable */
export interface AnalystCase {
  readonly name: string;
  readonly asOfUtc: string;
  readonly expected: Record<string, unknown>;
}

export const ANALYST_CASES: readonly AnalystCase[] = [
  {
    "name": "H1 2021-08-16 video-type5 claim date; FFR 0%, before first hike",
    "asOfUtc": "2021-08-16T14:00:00Z",
    "expected": {
      "asOfUtc": "2021-08-16T14:00:00Z",
      "asOfEtDate": "2021-08-16",
      "cpi": {
        "referenceMonth": "2021-07",
        "releaseAtUtc": "2021-08-11T12:30:00Z",
        "index": 273.003,
        "baseMonth": "2020-07",
        "baseIndex": 259.101,
        "yoyPctRaw": 5.3655,
        "yoyPct": 5.4,
        "hot": true,
        "monthGap": 1
      },
      "rate": {
        "upperPct": 0.25,
        "upperEffectiveFrom": "2020-03-16",
        "compareDate": "2021-02-16",
        "upper6mAgoPct": 0.25,
        "deltaPct": 0.0,
        "direction": "hold"
      },
      "label": "hot_hold",
      "isType5": false,
      "reasonCodes": []
    }
  },
  {
    "name": "H2 2022-06-15 day before 06-16 hike effective",
    "asOfUtc": "2022-06-15T14:00:00Z",
    "expected": {
      "asOfUtc": "2022-06-15T14:00:00Z",
      "asOfEtDate": "2022-06-15",
      "cpi": {
        "referenceMonth": "2022-05",
        "releaseAtUtc": "2022-06-10T12:30:00Z",
        "index": 292.296,
        "baseMonth": "2021-05",
        "baseIndex": 269.195,
        "yoyPctRaw": 8.5815,
        "yoyPct": 8.6,
        "hot": true,
        "monthGap": 1
      },
      "rate": {
        "upperPct": 1.0,
        "upperEffectiveFrom": "2022-05-05",
        "compareDate": "2021-12-15",
        "upper6mAgoPct": 0.25,
        "deltaPct": 0.75,
        "direction": "tightening"
      },
      "label": "hot_tightening",
      "isType5": true,
      "reasonCodes": []
    }
  },
  {
    "name": "H3 2022-06-16 hike effective day",
    "asOfUtc": "2022-06-16T14:00:00Z",
    "expected": {
      "asOfUtc": "2022-06-16T14:00:00Z",
      "asOfEtDate": "2022-06-16",
      "cpi": {
        "referenceMonth": "2022-05",
        "releaseAtUtc": "2022-06-10T12:30:00Z",
        "index": 292.296,
        "baseMonth": "2021-05",
        "baseIndex": 269.195,
        "yoyPctRaw": 8.5815,
        "yoyPct": 8.6,
        "hot": true,
        "monthGap": 1
      },
      "rate": {
        "upperPct": 1.75,
        "upperEffectiveFrom": "2022-06-16",
        "compareDate": "2021-12-16",
        "upper6mAgoPct": 0.25,
        "deltaPct": 1.5,
        "direction": "tightening"
      },
      "label": "hot_tightening",
      "isType5": true,
      "reasonCodes": []
    }
  },
  {
    "name": "H4 2022-07-13 12:29Z one minute before June CPI 9.1 release -> May used",
    "asOfUtc": "2022-07-13T12:29:00Z",
    "expected": {
      "asOfUtc": "2022-07-13T12:29:00Z",
      "asOfEtDate": "2022-07-13",
      "cpi": {
        "referenceMonth": "2022-05",
        "releaseAtUtc": "2022-06-10T12:30:00Z",
        "index": 292.296,
        "baseMonth": "2021-05",
        "baseIndex": 269.195,
        "yoyPctRaw": 8.5815,
        "yoyPct": 8.6,
        "hot": true,
        "monthGap": 2
      },
      "rate": {
        "upperPct": 1.75,
        "upperEffectiveFrom": "2022-06-16",
        "compareDate": "2022-01-13",
        "upper6mAgoPct": 0.25,
        "deltaPct": 1.5,
        "direction": "tightening"
      },
      "label": "hot_tightening",
      "isType5": true,
      "reasonCodes": []
    }
  },
  {
    "name": "H5 2022-07-13 12:30Z release instant -> June used",
    "asOfUtc": "2022-07-13T12:30:00Z",
    "expected": {
      "asOfUtc": "2022-07-13T12:30:00Z",
      "asOfEtDate": "2022-07-13",
      "cpi": {
        "referenceMonth": "2022-06",
        "releaseAtUtc": "2022-07-13T12:30:00Z",
        "index": 296.311,
        "baseMonth": "2021-06",
        "baseIndex": 271.696,
        "yoyPctRaw": 9.0598,
        "yoyPct": 9.1,
        "hot": true,
        "monthGap": 1
      },
      "rate": {
        "upperPct": 1.75,
        "upperEffectiveFrom": "2022-06-16",
        "compareDate": "2022-01-13",
        "upper6mAgoPct": 0.25,
        "deltaPct": 1.5,
        "direction": "tightening"
      },
      "label": "hot_tightening",
      "isType5": true,
      "reasonCodes": []
    }
  },
  {
    "name": "H6 2023-09-20 last hike 07-27 within 6 months",
    "asOfUtc": "2023-09-20T14:00:00Z",
    "expected": {
      "asOfUtc": "2023-09-20T14:00:00Z",
      "asOfEtDate": "2023-09-20",
      "cpi": {
        "referenceMonth": "2023-08",
        "releaseAtUtc": "2023-09-13T12:30:00Z",
        "index": 307.026,
        "baseMonth": "2022-08",
        "baseIndex": 296.171,
        "yoyPctRaw": 3.6651,
        "yoyPct": 3.7,
        "hot": false,
        "monthGap": 1
      },
      "rate": {
        "upperPct": 5.5,
        "upperEffectiveFrom": "2023-07-27",
        "compareDate": "2023-03-20",
        "upper6mAgoPct": 4.75,
        "deltaPct": 0.75,
        "direction": "tightening"
      },
      "label": "normal_tightening",
      "isType5": false,
      "reasonCodes": []
    }
  },
  {
    "name": "H7 2024-03-01 hold period",
    "asOfUtc": "2024-03-01T14:00:00Z",
    "expected": {
      "asOfUtc": "2024-03-01T14:00:00Z",
      "asOfEtDate": "2024-03-01",
      "cpi": {
        "referenceMonth": "2024-01",
        "releaseAtUtc": "2024-02-13T13:30:00Z",
        "index": 308.417,
        "baseMonth": "2023-01",
        "baseIndex": 299.17,
        "yoyPctRaw": 3.0909,
        "yoyPct": 3.1,
        "hot": false,
        "monthGap": 2
      },
      "rate": {
        "upperPct": 5.5,
        "upperEffectiveFrom": "2023-07-27",
        "compareDate": "2023-09-01",
        "upper6mAgoPct": 5.5,
        "deltaPct": 0.0,
        "direction": "hold"
      },
      "label": "normal_hold",
      "isType5": false,
      "reasonCodes": []
    }
  },
  {
    "name": "H8 2025-03-01 easing cycle",
    "asOfUtc": "2025-03-01T14:00:00Z",
    "expected": {
      "asOfUtc": "2025-03-01T14:00:00Z",
      "asOfEtDate": "2025-03-01",
      "cpi": {
        "referenceMonth": "2025-01",
        "releaseAtUtc": "2025-02-12T13:30:00Z",
        "index": 317.671,
        "baseMonth": "2024-01",
        "baseIndex": 308.417,
        "yoyPctRaw": 3.0005,
        "yoyPct": 3.0,
        "hot": false,
        "monthGap": 2
      },
      "rate": {
        "upperPct": 4.5,
        "upperEffectiveFrom": "2024-12-19",
        "compareDate": "2024-09-01",
        "upper6mAgoPct": 5.5,
        "deltaPct": -1.0,
        "direction": "easing"
      },
      "label": "normal_easing",
      "isType5": false,
      "reasonCodes": []
    }
  },
  {
    "name": "H9 2025-11-15 Oct-2025 CPI unpublished -> Sep used, gap 2",
    "asOfUtc": "2025-11-15T14:00:00Z",
    "expected": {
      "asOfUtc": "2025-11-15T14:00:00Z",
      "asOfEtDate": "2025-11-15",
      "cpi": {
        "referenceMonth": "2025-09",
        "releaseAtUtc": "2025-10-24T12:30:00Z",
        "index": 324.8,
        "baseMonth": "2024-09",
        "baseIndex": 315.301,
        "yoyPctRaw": 3.0127,
        "yoyPct": 3.0,
        "hot": false,
        "monthGap": 2
      },
      "rate": {
        "upperPct": 4.0,
        "upperEffectiveFrom": "2025-10-30",
        "compareDate": "2025-05-15",
        "upper6mAgoPct": 4.5,
        "deltaPct": -0.5,
        "direction": "easing"
      },
      "label": "normal_easing",
      "isType5": false,
      "reasonCodes": []
    }
  },
  {
    "name": "H10 2025-12-17 day before Nov release -> Sep used, gap 3 allowed",
    "asOfUtc": "2025-12-17T14:00:00Z",
    "expected": {
      "asOfUtc": "2025-12-17T14:00:00Z",
      "asOfEtDate": "2025-12-17",
      "cpi": {
        "referenceMonth": "2025-09",
        "releaseAtUtc": "2025-10-24T12:30:00Z",
        "index": 324.8,
        "baseMonth": "2024-09",
        "baseIndex": 315.301,
        "yoyPctRaw": 3.0127,
        "yoyPct": 3.0,
        "hot": false,
        "monthGap": 3
      },
      "rate": {
        "upperPct": 3.75,
        "upperEffectiveFrom": "2025-12-11",
        "compareDate": "2025-06-17",
        "upper6mAgoPct": 4.5,
        "deltaPct": -0.75,
        "direction": "easing"
      },
      "label": "normal_easing",
      "isType5": false,
      "reasonCodes": []
    }
  },
  {
    "name": "H11 2026-06-15 May-2026 YoY 4.2 released, hold",
    "asOfUtc": "2026-06-15T14:00:00Z",
    "expected": {
      "asOfUtc": "2026-06-15T14:00:00Z",
      "asOfEtDate": "2026-06-15",
      "cpi": {
        "referenceMonth": "2026-05",
        "releaseAtUtc": "2026-06-10T12:30:00Z",
        "index": 335.123,
        "baseMonth": "2025-05",
        "baseIndex": 321.465,
        "yoyPctRaw": 4.2487,
        "yoyPct": 4.2,
        "hot": true,
        "monthGap": 1
      },
      "rate": {
        "upperPct": 3.75,
        "upperEffectiveFrom": "2025-12-11",
        "compareDate": "2025-12-15",
        "upper6mAgoPct": 3.75,
        "deltaPct": 0.0,
        "direction": "hold"
      },
      "label": "hot_hold",
      "isType5": false,
      "reasonCodes": []
    }
  },
  {
    "name": "H12 2026-11-10 13:29Z one minute before Oct release (EST)",
    "asOfUtc": "2026-11-10T13:29:00Z",
    "expected": {
      "asOfUtc": "2026-11-10T13:29:00Z",
      "asOfEtDate": "2026-11-10",
      "cpi": {
        "referenceMonth": "2026-09",
        "releaseAtUtc": "2026-10-14T12:30:00Z",
        "index": 336.94,
        "baseMonth": "2025-09",
        "baseIndex": 324.8,
        "yoyPctRaw": 3.7377,
        "yoyPct": 3.7,
        "hot": false,
        "monthGap": 2
      },
      "rate": {
        "upperPct": 4.0,
        "upperEffectiveFrom": "2026-09-17",
        "compareDate": "2026-05-10",
        "upper6mAgoPct": 3.75,
        "deltaPct": 0.25,
        "direction": "tightening"
      },
      "label": "normal_tightening",
      "isType5": false,
      "reasonCodes": []
    }
  },
  {
    "name": "H13 2026-11-10 13:30Z Oct released but base 2025-10 missing -> Sep fallback",
    "asOfUtc": "2026-11-10T13:30:00Z",
    "expected": {
      "asOfUtc": "2026-11-10T13:30:00Z",
      "asOfEtDate": "2026-11-10",
      "cpi": {
        "referenceMonth": "2026-09",
        "releaseAtUtc": "2026-10-14T12:30:00Z",
        "index": 336.94,
        "baseMonth": "2025-09",
        "baseIndex": 324.8,
        "yoyPctRaw": 3.7377,
        "yoyPct": 3.7,
        "hot": false,
        "monthGap": 2
      },
      "rate": {
        "upperPct": 4.0,
        "upperEffectiveFrom": "2026-09-17",
        "compareDate": "2026-05-10",
        "upper6mAgoPct": 3.75,
        "deltaPct": 0.25,
        "direction": "tightening"
      },
      "label": "normal_tightening",
      "isType5": false,
      "reasonCodes": []
    }
  },
  {
    "name": "H14 2026-11-11 today",
    "asOfUtc": "2026-11-11T14:00:00Z",
    "expected": {
      "asOfUtc": "2026-11-11T14:00:00Z",
      "asOfEtDate": "2026-11-11",
      "cpi": {
        "referenceMonth": "2026-09",
        "releaseAtUtc": "2026-10-14T12:30:00Z",
        "index": 336.94,
        "baseMonth": "2025-09",
        "baseIndex": 324.8,
        "yoyPctRaw": 3.7377,
        "yoyPct": 3.7,
        "hot": false,
        "monthGap": 2
      },
      "rate": {
        "upperPct": 4.0,
        "upperEffectiveFrom": "2026-09-17",
        "compareDate": "2026-05-11",
        "upper6mAgoPct": 3.75,
        "deltaPct": 0.25,
        "direction": "tightening"
      },
      "label": "normal_tightening",
      "isType5": false,
      "reasonCodes": []
    }
  },
  {
    "name": "H15 2009-03-01 compare date before table start",
    "asOfUtc": "2009-03-01T14:00:00Z",
    "expected": {
      "asOfUtc": "2009-03-01T14:00:00Z",
      "asOfEtDate": "2009-03-01",
      "label": "unknown",
      "isType5": false,
      "reasonCodes": [
        "cpi_stale",
        "rate_table_before_start"
      ]
    }
  },
  {
    "name": "H16 2009-06-16 compare date == table start",
    "asOfUtc": "2009-06-16T14:00:00Z",
    "expected": {
      "asOfUtc": "2009-06-16T14:00:00Z",
      "asOfEtDate": "2009-06-16",
      "rate": {
        "upperPct": 0.25,
        "upperEffectiveFrom": "2008-12-16",
        "compareDate": "2008-12-16",
        "upper6mAgoPct": 0.25,
        "deltaPct": 0.0,
        "direction": "hold"
      },
      "label": "unknown",
      "isType5": false,
      "reasonCodes": [
        "cpi_stale"
      ]
    }
  },
  {
    "name": "S1 2026-12-10 FOMC 12-09 passed, verifiedThrough 2026-11-11 -> stale",
    "asOfUtc": "2026-12-10T14:00:00Z",
    "expected": {
      "asOfUtc": "2026-12-10T14:00:00Z",
      "asOfEtDate": "2026-12-10",
      "cpi": {
        "referenceMonth": "2026-09",
        "releaseAtUtc": "2026-10-14T12:30:00Z",
        "index": 336.94,
        "baseMonth": "2025-09",
        "baseIndex": 324.8,
        "yoyPctRaw": 3.7377,
        "yoyPct": 3.7,
        "hot": false,
        "monthGap": 3
      },
      "rate": {
        "upperPct": 4.0,
        "upperEffectiveFrom": "2026-09-17",
        "compareDate": "2026-06-10",
        "upper6mAgoPct": 3.75,
        "deltaPct": 0.25,
        "direction": "tightening"
      },
      "label": "unknown",
      "isType5": false,
      "reasonCodes": [
        "rate_table_stale"
      ]
    }
  },
  {
    "name": "S2 2027-12-20 beyond last known meeting",
    "asOfUtc": "2027-12-20T14:00:00Z",
    "expected": {
      "asOfUtc": "2027-12-20T14:00:00Z",
      "asOfEtDate": "2027-12-20",
      "rate": {
        "upperPct": 4.0,
        "upperEffectiveFrom": "2026-09-17",
        "compareDate": "2027-06-20",
        "upper6mAgoPct": 4.0,
        "deltaPct": 0.0,
        "direction": "hold"
      },
      "label": "unknown",
      "isType5": false,
      "reasonCodes": [
        "cpi_stale",
        "rate_table_stale",
        "rate_schedule_exhausted"
      ]
    }
  }
];
