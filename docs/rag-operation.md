# StockInvest RAG 운영 매뉴얼

본 문서는 StockInvest 가 home-m4-api 게이트웨이를 RAG 백엔드로 사용할 때의 **컬렉션 책임·적재 의존성·장애 대응**을 정리한다. 코드 변경 가이드가 아니며, 운영자가 시스템 상태를 진단·복구할 때 참조한다.

---

## 1. 사용 컬렉션 한눈에

StockInvest 의 [src/lib/rag/retrieval.ts](../src/lib/rag/retrieval.ts) 가 호출하는 컬렉션:

| 컬렉션 | market 라우팅 | 적재 책임 | 임베딩 모델 | 신선도 (lookback) |
|---|---|---|---|---|
| `signals.stockinvest` | domestic, overseas | StockInvest (자동, fire-and-forget) | bge-m3 | 30일 (D-1) |
| `signals.tradinginvest` | crypto | TradingInvest 프로젝트 | bge-m3 | 30일 |
| `news.kr_market` | domestic | **n8n** (별도 시스템) | bge-m3 | 7일 |
| `news.us_market` | overseas, crypto | **n8n** (별도 시스템) | bge-m3 | 7일 |
| `news.macro` | 모든 market 공통 | **n8n** (별도 시스템) | bge-m3 | 7일 |

> ⚠️ **news.* 적재 책임은 n8n 워크플로우** — StockInvest 코드베이스 내에는 `news.*` 컬렉션에 upsert 하는 로직이 없다. n8n 이 Notion 또는 외부 뉴스 소스에서 데이터를 끌어와 home-m4-api `/v1/kb/news.*/upsert` 를 직접 호출한다 (home-m4-api Plan §B-8 참조).

---

## 2. 적재 흐름 (signals.stockinvest)

```
[시그널 생성 in src/lib/signals/service.ts]
   ↓ fire-and-forget (queueMicrotask)
[src/lib/rag/signals-upsert.ts: upsertSignal]
   ↓ ensureCollectionOnce() (D-3 — lazy init, 첫 호출만 ensureCollection)
   ↓ buildSignalText / buildSignalMetadata (PII redact 포함, D-6)
[home-m4-api POST /v1/kb/signals.stockinvest/upsert]
   ↓ Qdrant 에 저장 (결정적 UUID)

[1h/4h/24h 후 cron in src/app/api/cron/signal-followup/route.ts]
   ↓ priceChangePct_*, hit_* 라벨 갱신
[fireAndForgetUpsertSignal 재호출 — 동일 ID 로 vector 갱신]
```

**핵심**: 시그널 생성 → 인덱싱 → 사후 P&L 라벨 갱신 → 재인덱싱 사이클이 닫혀 있어, 분석 시점에 "비슷한 셋업이 과거에 어떤 결과를 냈는지" 컨텍스트로 들어감.

---

## 3. 검색 흐름 (Stage 1 RAG 주입)

[src/lib/strategy/ai-filter-stage1.ts](../src/lib/strategy/ai-filter-stage1.ts) 의 `buildStage1Prompt` 가 retrieval 호출:

```
[Stage 1 batch 5종목]
   ↓ buildRagQueryText → 결합 query
[retrieveRagContext]
   ↓ 3 컬렉션 병렬 검색 (signals + news + macro), 5초 timeout
   ↓ D-4: in-process LRU 캐시 (TTL 60s, max 200) 경유
   ↓ D-7: schema 검증 → 깨진 hit 제외
   ↓ D-2: minScore=0.5 미만 hit 제외
   ↓ D-1: signals 도 dateFilter (lookbackDaysSignals=30)
[formatRagSection → Stage 1 prompt 에 주입]
```

---

## 4. 환경변수

`.env` (운영 측 — `~/.node-local/stockinvest/.env`):

| 변수 | 기본값 | 역할 |
|---|---|---|
| `AI_API_BASE` | `http://192.168.219.100:8000` | home-m4-api 게이트웨이 주소 |
| `AI_API_KEY` | (발급된 mk_*) | KB read/write 권한 (X-API-Key) |
| `M4_ADMIN_TOKEN` | (관리자 토큰) | ensureCollection 전용 (X-Admin-Token) |
| `M4_DEFAULT_EMBED_MODEL` | `bge-m3` | 신규 KB 컬렉션 기본 모델 (D-3/D-8) |
| `RAG_ENABLED` | `true` | RAG 컨텍스트 주입 on/off (UI 에서도 조정) |
| `RAG_TOPK_SIGNALS` | `5` | signals 검색 top-K |
| `RAG_TOPK_NEWS` | `3` | news 검색 top-K |
| `RAG_LOOKBACK_DAYS` | `7` | news/macro 신선도 (일) |
| `RAG_LOOKBACK_DAYS_SIGNALS` | `30` | **D-1**: signals 신선도 |
| `RAG_MIN_SCORE` | `0.5` | **D-2**: score 임계값 |

---

## 5. 장애 시나리오

### 5.1 모든 RAG 검색이 빈 hits 반환

증상: `[rag-retrieval] (...) past=0 news=0 macro=0 chars=0` 로그가 지속

원인 후보:
1. **컬렉션 자체가 비어있음** (특히 news.*) — n8n 적재 미작동
2. **API key 권한 부족** — KB scope 에 해당 컬렉션 없음
3. **score threshold 가 너무 높음** — `RAG_MIN_SCORE` 낮춰서 재시도 (예: 0.3)
4. **임베딩 모델 mismatch** — 컬렉션이 nomic-embed-text 로 생성됐는데 query 는 bge-m3 임베딩 → score 가 모두 0.x 미만으로 깔림

진단:
```bash
# 컬렉션별 항목 수
curl -s http://192.168.219.100:8000/v1/kb/news.macro/stats \
  -H "X-API-Key: $AI_API_KEY"
# → points_count 가 0 이면 적재 미작동 → n8n 워크플로우 확인

# 컬렉션 dim (모델 mismatch 진단)
curl -s http://localhost:6333/collections/news.macro | python3 -m json.tool
# → config.params.vectors.size = 1024 (bge-m3) 인지 확인
```

### 5.2 signals.stockinvest 만 비어있음

원인: signal-followup cron 또는 시그널 생성 자동 인덱싱이 실패하고 있음

진단:
```bash
# 백필 라우트로 90일치 강제 적재 (admin only)
curl -sX POST 'http://localhost:3000/api/admin/rag/backfill?days=90' \
  -H "X-Admin-Token: $ADMIN_TOKEN"
# 또는 dryRun=true 로 먼저 plannedCount 확인
```

### 5.3 home-m4-api 자체 다운

`AI_API_BASE` 응답 없음 → retrieval 5초 timeout → 빈 컨텍스트 + warn 로그.
StockInvest 자체는 정상 작동 (Stage 1 이 RAG 없이 진행). 게이트웨이 복구는 home-m4-api 운영 매뉴얼 (`docs/local-llm.md §7`) 참조.

### 5.4 score=1.0 인 hit 가 무관한 텍스트

**증상의 결정적 신호**: 한국어 query 에 영어 텍스트가 score 1.0 으로 매칭

원인: 임베딩 collapse — 컬렉션이 `nomic-embed-text`(영어 위주) 로 생성됨

해결:
1. 컬렉션 삭제 후 `bge-m3` 로 재생성
2. 시드 데이터 재적재
3. home-m4-api Plan §B-7-실 절차 참조

---

## 6. 권한 분리 (현재 미구현)

현 정책: 모든 정상 키가 모든 컬렉션 접근. tradinginvest 키가 stockinvest 컬렉션을 변조 가능.

→ home-m4-api Phase 1.5 권한 분리(`allowed_collections` per key) 도입 후 StockInvest 키도 scope 제한 필요. 현재는 운영 신뢰 기반.

---

## 7. 검색 품질 sanity check

운영 1주마다 수동:

```bash
# domestic 시그널 query
curl -sX POST http://192.168.219.100:8000/v1/kb/signals.stockinvest/search \
  -H "X-API-Key: $AI_API_KEY" -H "Content-Type: application/json" \
  -d '{"query":"삼성전자 RSI 과매도 매수","top_k":5,"filter":{"date":{"gte":"2026-04-08"}}}' \
  | python3 -m json.tool

# 기대: hits[0] 이 의미적으로 가까운 시그널, score 가 hits[1] 보다 의미 있게 높음 (>=0.05)
```

미달 시 prompt-engineer 와 협의해 임베딩 모델·컬렉션 재구성 검토.

---

## 8. 참조 문서

- 게이트웨이 측: `home-m4-api/docs/local-llm.md` §9 RAG, §7 장애 시나리오
- StockInvest 측: [.env.example](../.env.example), [src/lib/rag/](../src/lib/rag/)
- 운영 변경 이력: 본 문서 git history
