---
project: StockInvest
created: 2026-08-08
tags:
  - type/knowledge
  - domain/infra
aliases:
  - DDL 알고리즘 고정 규약
---

# DDL 알고리즘 고정(pinning) 규약과 그 함정

## 규약 (Phase 2에서 확립)

라이브 테이블에 DDL을 칠 때는 **알고리즘을 고정**한다 — 고정하지 않으면 MariaDB가 조용히 `COPY`로 떨어져 테이블 락이 걸릴 수 있다. 운영 중인 테이블에서 이는 곧 장애다.

```sql
ALTER TABLE t MODIFY COLUMN c ..., ALGORITHM=INSTANT, LOCK=NONE
```

INSTANT가 거부되면 **`INPLACE, LOCK=NONE`으로 재시도**한다(둘 다 online DDL이라 "COPY/락 금지"라는 불변식을 만족). 하드 실패시키지 않는다 — 알고리즘 미지원 하나로 자충수 아웃티지를 만들 이유가 없다.

## 🔴 함정 — 이 규약이 스스로 초래하는 실수

**`ALGORITHM=` / `LOCK=` 을 쉼표로 덧붙이는 문법은 `ALTER TABLE` 전용이다.**

`CREATE INDEX`에 같은 형태로 붙이면 **문법 오류**가 난다:

```sql
-- ❌ ERROR 1064 ... near ' LOCK=NONE'
CREATE UNIQUE INDEX uq ON users (a, b), ALGORITHM=INPLACE, LOCK=NONE

-- ✅ 같은 결과를 ALTER TABLE 문법으로
ALTER TABLE users ADD UNIQUE KEY uq (a, b), ALGORITHM=INPLACE, LOCK=NONE
```

**실제 사고**: 2026-08-08 T-009에서 `uq_users_oauth` 인덱스가 이 이유로 생성되지 않은 채 배포됐다. 컬럼 ALTER들은 전부 `ALTER TABLE`이라 성공했고 인덱스만 실패해서, 스키마가 **부분적으로만** 적용된 상태가 됐다.

→ **핀 고정 DDL이 필요하면 `ALTER TABLE` 형태로 표현하라.** 다른 DDL 종류에 이 규약을 확장할 때는 반드시 실서버 버전에서 검증할 것.

## `ADD INDEX`에는 INSTANT가 아예 없다

실측(MariaDB 10.11 컨테이너):

```
ERROR 1846: ALGORITHM=INSTANT is not supported. Reason: ADD INDEX
```

거부가 아니라 **해당 연산에 존재하지 않는 알고리즘**이다. 따라서 인덱스 추가에는 INSTANT를 시도하지 않고 `INPLACE`부터 시작한다 — 시도하면 부팅 로그에 **매번 실패가 보장된 경고**가 찍히고, 그 로그는 진짜 문제를 잡는 수단이므로 상시 오탐으로 오염시키면 안 된다.

## 검증 방법 — 추측하지 말고 일회용 컨테이너에서 돌려라

이 사고는 **문법을 가정**했기 때문에 발생했다. 운영과 같은 버전의 일회용 인스턴스에서 실행해보는 비용은 몇 분이다.

```bash
docker run --rm -d --name ddl-check -e MARIADB_ROOT_PASSWORD=x mariadb:10.11
# 운영 테이블 형태를 재현한 뒤 문제의 DDL을 그대로 실행
```

확인할 것: ① 실패가 운영 로그와 **문자 단위로 일치**하는가(같은 원인인지) ② 수정본이 성공하는가 ③ NULL 허용 기존 행이 영향받지 않는가 ④ 제약이 실제로 작동하는가 ⑤ **에러 문자열 매처가 진짜 메시지와 매칭되는가** ⑥ 두 번째 부팅에서 건너뛰는가(멱등).

특히 ⑤가 중요하다 — 중복 키 에러 메시지를 문자열로 판별하는 코드는 **실제 에러를 본 적 없으면 맞는지 알 수 없다.**

> 운영 버전 확인: `SELECT VERSION()` — 2026-08-08 기준 **MariaDB 10.11.11**

## ⚠️ 이 함정의 비용은 테이블 크기에 비례한다 — Steps 2~5 대비

2026-08-08 사고가 **무료**였던 이유는 `users` 테이블이 **0행**이었기 때문이다. 인덱스가 안 생겼을 뿐 아무 것도 잠기지 않았다.

**[[T-008-multiuser-auth-step1]] Step 3(13개 테이블에 `user_id` 추가)에서는 사정이 다르다:**

| 구분 | 성격 | 위험 |
|---|---|---|
| `ADD COLUMN` | INSTANT 가능, 메타데이터만 변경 | 낮음 |
| **`ADD INDEX` / `ADD FOREIGN KEY`** | **INSTANT 불가**(위 §참조) | **높음** |

그리고 그 인덱스·FK가 붙을 대상은 **비어 있지 않다** — `signals`는 최근 실측 약 **13,811행**, `eval_funnel`은 일 ~8,000행씩 쌓이는 중이다.

→ **같은 문법 실수를 여기서 하면 결과가 "인덱스가 안 생김"이 아니라 "라이브 테이블 락 또는 리빌드"다.**

**결론: Step 3 계획 단계에서부터 컨테이너 검증을 일정에 넣어라.** 사후 수정 단계로 취급하지 말 것. 특히 인덱스·FK 문장은 **운영과 같은 행 수 규모의 더미 데이터**를 넣은 뒤 `LOCK=NONE`이 실제로 유지되는지(락 대기 발생 여부) 확인해야 한다 — 0행 테이블에서의 성공은 비어있지 않은 테이블에 대한 보장이 아니다.

## 사후 관측 — 실패를 어떻게 알아차릴 것인가

DDL 실패 브랜치는 `console.error`만으로 부족하다. **부팅 로그를 상시 보는 사람은 없다.** 2026-08-08에 이 버그를 잡은 것은 배포 직후 우연히 로그를 grep했기 때문이지 절차 때문이 아니었다.

→ DDL 실패 브랜치는 `notifyCritical()`을 호출해 **결과(무엇이 보호되지 않는가)** 를 명시한다. 부팅을 막지는 않되(자충수 아웃티지 방지), 조용히 지나가지도 않게 한다.
