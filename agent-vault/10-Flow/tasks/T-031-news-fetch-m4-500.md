---
task_id: T-031
title: news-fetch cron 실패 조사 — 낡은 IP(해결) + M4 API 500(미해결)
status: doing
roles_involved: [leader]
related_tasks: []
tags:
  - type/task
  - domain/ops
  - domain/infra
aliases:
  - news-fetch 실패
  - news-fetch-m4-500
created: 2026-08-19
updated: 2026-08-19
---

## 증상

`pm2 logs stockinvest-cron` 에 아래가 반복 출력된다.

```
[2026-08-18 06:54:57] news-fetch start
[2026-08-18 06:55:07] news-fetch domestic FAILED HTTP=000
[2026-08-18 06:55:17] news-fetch overseas FAILED HTTP=000
```

최근 200줄에 **72건**. `entry-watcher`·`holding-checker`·`strategy-eval`·`trade-report` 는 계속 OK 라
**매매 자체는 정상**이고, 영향은 뉴스 KB(`news.kr_market`/`news.us_market`) 갱신 중단이다.

## 조사 결과 — 원인이 두 겹이다 (systematic-debugging Phase 1~3 완료)

### 호출 구조 (먼저 파악할 것)

`scripts/cron-runner.sh:118-138` 이 **자기 앱이 아니라 외부 서버**를 부른다:
```bash
curl -X POST "$M4_BASE/v1/news/fetch" -H "X-Admin-Token: $M4_ADMIN" ...
# M4_BASE = .env 의 AI_API_BASE, M4_ADMIN = .env 의 M4_ADMIN_TOKEN (cron-runner.sh:56-59)
```
→ **`src/app/api/cron/news-fetch` 라우트는 이 저장소에 존재하지 않는다.** 대상은
[[home-m4-api]] 프로젝트(맥미니 M4)다. 여기서 코드를 찾지 말 것.

### 1겹 — 낡은 IP ✅ 해결됨

`.env` 의 `AI_API_BASE` 가 죽은 주소 `192.168.219.163` 을 가리키고 있었다. 실제 주소는
**`192.168.219.100:8001`**(사용자 확인). 포트 8001 은 원래부터 맞았고 **IP 만 틀렸다**.
커밋 `54e1e02 chore: update M4 API IP to 192.168.219.100` 로 반영됨.

실측 근거(2026-08-19):

| 대상 | 결과 |
|---|---|
| `192.168.219.163` (구 주소) | ping 100% 손실, 8000·8001·22·80 **전부 무응답** |
| `192.168.219.154:3000` (Gitea, 대조군) | HTTP=200, connect **0.9ms** — 네트워크·라우팅 정상 |
| `192.168.219.100:8001` (신 주소) | `/health` **HTTP=200**, connect **1.3ms** |
| `192.168.219.100:8000` | 닫힘 → **포트는 8001 이 맞다** |

> 참고: 이 서버는 `192.168.219.x` 대역에 속해 있지 않다(`enp3s0 = 125.177.194.26/25` + docker 대역).
> 해당 대역 트래픽은 게이트웨이를 거쳐 나간다. 그래도 `.154`·`.100` 은 정상 도달한다.
> 또 **TradingInvest `.env` 는 아직 `AI_API_BASE=http://192.168.219.163:8000`(구 IP·구 포트)** 이다 —
> 그 프로젝트도 같은 증상일 가능성이 높다. **확인 권고**(이번 범위 밖).

### 2겹 — M4 API `/v1/news/fetch` 가 500 🔴 미해결

IP 를 고치자 실패 양상이 바뀌었다: **`HTTP=000`(연결 불가) → `HTTP=500`(서버 내부 오류)**.

```
POST http://192.168.219.100:8001/v1/news/fetch  (X-Admin-Token 포함)
  → 500 Internal Server Error   (domestic·overseas 둘 다)
GET  http://192.168.219.100:8001/health
  → 200                          (서버 자체는 정상, uvicorn)
```

**500 이 나는 지점을 좁혔다.** `home-m4-api/app/routes/market_context.py:212` 핸들러는 예외를
**502 로 감싸는 구간이 두 곳**이다:

| 구간 | 실패 시 |
|---|---|
| RSS fetch (`httpx.HTTPError`) | **502** `RSS fetch error` |
| KB upsert (`Exception`) | **502** `KB upsert error` |

실제로는 **500** 이 나온다 → **이 두 구간이 아니라 예외 처리가 없는 곳**에서 터진다. 후보 3줄:

```python
articles = _parse_rss(response.text, req.market, req.limit)   # try 없음
meta = await kb.get_collection_meta(collection)                # try 없음   ← 유력
await kb.create_collection(collection, model="bge-m3")         # ValueError 만 잡음
```

**RSS 는 범인이 아닐 가능성이 크다** — 두 소스 모두 이 서버에서 HTTP=200 으로 정상 응답하고,
실패했다면 502 가 나와야 한다:
- `https://www.yna.co.kr/rss/economy.xml` → 200
- `https://feeds.a.dj.com/rss/RSSMarketsMain.xml` → 200

→ **가장 유력한 가설: KB 계층.** `get_collection_meta` 는 예외 처리가 아예 없고
`create_collection` 은 `ValueError` 만 잡는다. 임베딩 모델 **`bge-m3` 가 Ollama 에 없거나**
벡터 스토어/Redis 가 죽었다면 그대로 500 이 된다. (가설이며 **미검증** — M4 내부를 볼 수 없었다.)

## 🔴 다음 세션이 할 일

### A. M4 500 규명 (주 과제) — **`home-m4-api` 프로젝트로 전환 필요**

이 저장소에서는 더 못 한다. M4 머신에서 확인할 것:
1. **uvicorn 로그의 스택 트레이스** — 500 이 난 정확한 줄이 찍힌다 (가장 빠른 길)
2. `ollama list` 에 **`bge-m3`** 가 있는지
3. KB 백엔드(Redis/벡터 스토어) 상태

재현 커맨드(이 저장소에서 바로 실행 가능):
```bash
cd /home/brownjeon/NFS/homes/brownjeon/project/StockInvest
B=$(grep '^AI_API_BASE=' .env | cut -d= -f2-); T=$(grep '^M4_ADMIN_TOKEN=' .env | cut -d= -f2-)
curl -sS -D- -X POST "$B/v1/news/fetch" -H "X-Admin-Token: $T" \
  -H "Content-Type: application/json" -d '{"market":"domestic","limit":3}'
```

### B. StockInvest 쪽 재시도 폭주 (별개, 지금 고칠 수 있음)

`scripts/cron-runner.sh:137`
```bash
[ "$OK" = "1" ] && echo "$TODAY" > "$NEWS_FETCH_LAST_RUN_FILE"
```
**성공해야만** 날짜 파일을 쓴다 → 실패가 계속되면 `HH=06` 인 **1시간 내내 매 분 재시도**한다
(회당 20초 = `--connect-timeout 10` × 2 market, 로그 72줄). 일시 장애 자동복구 의도는 이해되나
**항구적 장애와 구분이 안 된다.** M4 를 고치면 증상은 사라지지만 구조는 남는다.
→ 연속 실패 N회 후 백오프/포기 + 로그 1줄 요약 권고. **`scripts/cron-runner.sh` 는 SAFETY_PATHS 라
Reviewer 게이트 대상**이다(커밋 시 `T-0NN` 참조 + scope 필요).

### C. 곁가지
- **TradingInvest `.env` 의 `AI_API_BASE` 도 구 IP·구 포트**(`163:8000`) — 같은 증상 가능성, 확인 권고
- `webhook-deploy` 가 `0481d55` push 에 **발화하지 않아** 수동 배포했다(`deploy-stockinvest.sh`).
  프로세스는 online·에러로그 비어 있었다. **다음 배포 때 재현되는지 확인 필요.**

## Leader 기록

- [2026-08-19] systematic-debugging Phase 1~3 수행. Phase 4(수정)는 **범위 밖**이라 미착수 —
  근본 원인이 다른 프로젝트(home-m4-api) 안에 있다. 증상만 덮는 수정은 하지 않았다.
  StockInvest 코드는 **한 줄도 바꾸지 않았다**(`.env` 의 IP 는 사용자가 직접 수정, `54e1e02`).
