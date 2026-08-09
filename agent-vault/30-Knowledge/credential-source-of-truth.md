---
project: StockInvest
created: 2026-08-09
tags:
  - type/knowledge
  - domain/security
  - domain/infra
aliases:
  - 자격증명 원천
  - cred_ 오버라이드
---

# 이 앱에는 자격증명 저장소가 **두 개** 있다 — `.env` 는 원천이 아니다

## 규칙

**엔진이 실제로 거래에 쓰는 값을 알려면 `getCredential()` 을 봐야 한다. `.env` 를 직접 읽으면 안 된다.**

`src/lib/credentials.ts` 의 우선순위:

```
system_config.cred_<KEY>  >  process.env.<KEY>  >  ''
```

즉 DB에 `cred_KIS_APP_KEY` 행이 있으면 **`.env` 값은 무시된다.** UI(설정 화면)에서 자격증명을 수정하면 DB 쪽에 저장되므로, 시간이 지나면 `.env` 는 조용히 낡는다.

## 🔴 실측 — 실제로 낡아 있었다 (2026-08-09)

[[T-011-owner-account-migration]] 착수 시 Leader 가 "`.env` 의 KIS 값을 읽어라"고 지시했다. developer 가 `getCredential()` 을 써야 한다고 지적했고, Leader 가 SHA-256 앞자리로 대조한 결과:

| 키 | `system_config.cred_*` | `.env` | 판정 |
|---|---|---|---|
| `KIS_APP_KEY` | `0bd02cb0cea8` | `c67d4c38bc5d` | **다름** |
| `KIS_APP_SECRET` | `d66a029ee2da` | `49c4f19b7f15` | **다름** |
| `KIS_ACCOUNT_NO` | `8183beb5b48b` | `2f5b8ec764a0` | **다름** |
| `KIS_ACCOUNT_PRODUCT` | `699cc6e015a5` | `938db8c9f82c` | **다름** |

**네 개 전부 달랐다.** 지시대로 `.env` 를 읽었다면 **엔진이 거래하지 않는 낡은 자격증명**을 회원 계정에 이관하고, 검증용 `tokenP` 호출도 엉뚱한 키로 했을 것이다.

> 바이트 길이는 일치했다 — 길이 비교로는 **잡히지 않는다.** 값 대조는 해시로 해야 한다(평문 출력 금지).

## 예외 — `KIS_MOCK`

`KIS_MOCK` **만은** 엔진이 `getCredential()` 이 아니라 `process.env` 를 직접 읽는다(`kis-auth.ts`·`kis-domestic.ts`·`kis-overseas.ts` 실측). 따라서 이 값만 `process.env` 에서 읽는 것이 정답이다.

**해석 규칙도 다르다**: 엔진은 `String(v ?? 'true').toLowerCase() === 'true'` — **trim 없음**, 그리고 `'true'` 가 아닌 **모든 값이 실전**이다. `parseBoolFlag`(`1/on/yes/y` 를 참으로 봄)와 다르므로 혼용하면 실전/모의 판정이 갈린다.

## 점검 절차

새 코드가 KIS 자격증명을 읽어야 할 때:

```bash
# 1. 엔진이 이 키를 어디서 읽는지 먼저 확인
grep -rn "KIS_APP_KEY\|getCredential" src/lib/exchanges/

# 2. DB 오버라이드 존재 여부 (값 출력 금지 — 해시로만)
SELECT `key` FROM system_config WHERE `key` LIKE 'cred_%';
```

## 부수 발견 — 정리 대상

`.env` 의 KIS 값이 낡은 채 남아 있다. 읽는 코드가 없으면 무해하지만, **다음 사람이 그것을 원천으로 착각할 함정**이다. 정리하거나 주석으로 "이 값은 사용되지 않음 — `system_config.cred_*` 참조"를 남기는 것을 백로그로 제안한다.
