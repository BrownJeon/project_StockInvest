---
id: T-023
title: getActiveOrders 연속조회(페이지네이션) 미처리 수정
status: done
created: 2026-08-12
updated: 2026-08-12
owner: leader
tags:
  - type/task
  - domain/kis-api
  - domain/order-sync
related_tasks:
  - "[[T-018-order-sync-fail-closed]]"
---

# T-023 — getActiveOrders 연속조회 미처리 수정

## 1. 배경

board.md "🔴 [신규, T-018 HIGH-2] `getActiveOrders` 가 페이지네이션을 전혀 처리하지 않는다".
미체결 목록이 KIS 응답 1페이지(연속조회 단위)를 넘으면, 2페이지 이후 주문은 **조회가 완전히
성공해도 화면·order-sync 로직 어디에도 나타나지 않는다** — order-sync는 "조회 성공, 목록에
없음"을 "취소됨"으로 추론하므로(T-018), 살아 있는 주문이 `cancelled`로 오기록될 수 있었다.
커버리지 갭(`active_coverage_gap`, 해외 미지원 거래소)과 달리 이건 **어느 주문이 안 보일지
미리 알 수 없어** 방어가 불가능한 유형이라 더 위험하다고 board.md가 지적함.

## 2. 원인 확인 및 프로토콜 검증

`kis-domestic.ts:403`/`kis-overseas.ts:426`의 `getActiveOrders` 둘 다 `CTX_AREA_FK100/200`,
`CTX_AREA_NK100/200`을 빈 값으로만 보내고, 응답의 연속조회 신호를 전혀 읽지 않은 채 첫 페이지
결과만 반환했다. 코드베이스 어디에도 KIS 연속조회 처리 선례가 없어(`grep` 확인), 정확한
프로토콜을 [KIS Developers 공식 예제(`open-trading-api`)](https://github.com/koreainvestment/open-trading-api)로
웹 검색해 확인:
1. 첫 요청 `tr_cont` 헤더 = 빈 문자열
2. 응답 헤더 `tr_cont` 가 `M`/`F` → 다음 페이지 존재
3. 다음 요청 `tr_cont` 헤더 = `'N'`
4. 다음 요청의 `CTX_AREA_FK100/200`·`CTX_AREA_NK100/200` = 이전 응답 **바디**의
   `ctx_area_fk100/200`·`ctx_area_nk100/200` 값
5. `tr_cont` 가 M/F 가 아니면 마지막 페이지

## 3. 수정

`kis-domestic.ts`·`kis-overseas.ts` 둘 다 `getActiveOrders`를 페이지 순회 루프로 재작성.
페이지별 `rt_cd`/`output` 형식 오류 처리(T-018의 "실패를 빈 배열로 바꾸지 않는다" 원칙)는
루프 안에서도 그대로 유지 — 어느 페이지에서 실패하든 즉시 던진다(조용히 부분 결과로
넘어가지 않음). 무한루프 방지로 `MAX_ACTIVE_ORDERS_PAGES=20`(도달 시 경고 로그 + 그때까지
모은 결과 반환, 조용히 자르지 않음).

## 4. 검증

- 회귀 테스트 신설: `kis-domestic.test.ts`(6건)·`kis-overseas.test.ts`(3건) — 단일 페이지
  회귀 없음, 2페이지 연속조회 정확성(URL·헤더까지 확인), tr_cont=F도 계속으로 처리, 페이지
  상한 안전장치, 다중 페이지에서도 수량 필터·rt_cd 오류 처리 유지 확인.
- typecheck 0에러, **98 suites / 1470 tests 전부 통과**(기존 96/1461 + 신규 9건).
- **실계좌 대상 실측은 못 했다** — 이 프로젝트에 KIS API 유닛테스트 선례가 아예 없어
  `kisFetch`를 전부 mock했고, 실제 KIS가 2페이지 이상을 반환하는 순간을 여기서 재현할 방법이
  없다(정상적으로는 미체결 주문 수가 페이지 크기를 넘을 때만 실제로 발동). 배포 후 실측
  관찰 권고: 미체결 주문이 많아지는 시점에 `[kis-domestic getActiveOrders] page=` 로그가
  1보다 큰 page 값으로 찍히는지 확인.

## 5. 안전장치 영향

주문 제출·취소 로직(`submitOrder`/`kis.createOrder`/`cancelOrder`) 무변경 — 순수 조회 함수의
결과 완전성만 고친다. 오히려 이 수정으로 order-sync의 fail-closed 판정(T-018)이 원래 의도대로
더 정확해진다(이전엔 페이지 밖 주문을 "취소"로 오판할 여지가 있었음).

## 6. 최종 요약 (사용자용)

미체결 주문이 많아지면(정확히 몇 건부터인지는 KIS 쪽 페이지 크기에 달려있어 코드로 단정할 수
없음) 뒤쪽 페이지의 주문이 시스템에 아예 안 보이는 문제가 있었습니다. 조회는 성공했다고
나오는데 특정 주문만 누락되는 형태라 눈치채기 어려운 결함이었습니다. 공식 문서로 확인한
정확한 방식대로 다음 페이지를 계속 이어서 가져오도록 고쳤고, 무한히 반복되지 않도록 안전
상한(20페이지)도 넣었습니다. 실제 KIS 서버로 직접 검증은 못 했고(테스트 환경 제약), 배포 후
주문이 많아지는 시점에 로그로 확인하는 걸 권장합니다.
