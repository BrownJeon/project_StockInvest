# T-156 승인 v6 실수집 기반 예측 원장 UI binding 추가 가이드

상태: 사용자 최신 승인에 따른 기존 v6 실데이터 표시 분기 인계. 새 목업·새 화면 구조가 아니다. 기존 확정 v6 guide와 배치/상태/포커스/기간 규칙은 유지한다. 이 문서는 표시 계약만 정하며 예측 계산·자료 생성·운영 변경을 수행하지 않았다.

근거: `src/lib/strategy/m40/forecast-types.ts` 동결 계약과 `docs/design/2026-11-08-t156-forecast-engine-analyst-spec.md`. 이전 가이드의 '엔진 미구현/실원본 없음'은 해당 자료가 없는 상태에만 적용한다. 검증된 저장 원본이 존재하면 아래 실원본으로 표시한다. 실거래 OFF는 유지하며 agent 거래반영을 켜지 않는다.

## 기존 화면에 연결

모의성과의 관측된 성과/향후 예상성과/예측 사후비교 3보기, 내부 활성 테두리/하단선, 1주·1개월·3개월·1년 선택기를 유지한다. 상위 고정 한 줄4탭·각 목록10행·기존3분류/하단5메뉴는 변경하지 않는다. 관측 과거 주/월 선택과 미래 horizon은 독립이다. 데이터가 없을 때 합성 fallback을 쓰지 않는다.

향후 예상성과는 immutable forecast 원본 ID를 고른 뒤 해당 원본의 horizons 중 선택 horizon 한 개만 표시한다. 다른 실행의 baseline/정책/확률을 섞지 않는다. 신규 저장분이 생겨도 사용자가 읽는 원본을 조용히 덮지 말고 갱신 사실과 새 ID를 구별한다. 현재 가격으로 과거 분포를 재계산하지 않는다.

## 기본 표시 영역

기존 승인 카드/요약 안에 다음을 배치한다.

1. 제목 `향후 {1주/1개월/3개월/1년} 모의 시나리오 예상성과`. 바로 아래 `미보정 연구 모형 · 정량 검증 전` 상태를 접힘 없이 표시한다. 실제 수집자료 기반이지만 미래 사실/보장 확률은 아니다.
2. 기준 평가 세션 `baseline.session`, 발행/조회 시각 `issuedAt`을 분리한다. 목표 달력일 `calendarTarget`, 마지막 평가 예정 세션 `targetSession`, `sessions` 거래일을 표시한다. 원본에 targetStart가 없으면 UI가 근거 없는 날짜를 만들지 않고 '기준 평가 이후~목표일'로 표시한다. 발행일을 과거 기준 세션으로 소급해 보이지 않는다.
3. 초기 평가액 `baseline.equityUsd`: 실제 paper book에 기준 세션 raw marks를 적용한 `forecast_only_marked_snapshot`. 원래 clone투자금·운영 최초 전진평가/T0와 다름을 한 줄로 밝힌다. 예측의 신규 발행시점과 11/6 가격기준을 구별한다.
4. 승인 요약 타일: 기대 순손익(평균) `netUsd.mean / netPct.mean`, 중앙80% 모형 범위 `netUsd.p10~p90 / netPct.p10~p90`, 중앙값 `netUsd.p50 / netPct.p50`, 손실경로 `lossCount / pathCount`와 추정손실확률. mean/P50/P10/P90은 원본값 그대로이며 UI에서 다시 산출/연율화하지 않는다.
5. 손실확률 옆 또는 바로 아래 `모형 경로 비율 · 현실 확률 보장 아님`, `Monte Carlo 표준오차 ±N%p (모형 불확실성과 별개)`를 보인다. `lossProbability`와 `monteCarloSe`는 비율이므로 %/%p 표현에 ×100 적용한다. `netPct` 단위는 ledger projection에서 확정하고 이미%인 값을 다시100배 하지 않는다. DTO 단위 확인이 없으면 미확인이다.
6. 매수·매도 편도0.25% 비용 차감은 수치 근처에서 유지한다. 기존 보유 과거 매수비용·최종 mark-only 평가에 임의 비용을 더하지 않는다. 거래대금별 비용은 엔진 원본을 읽으며 UI에서 단순 왕복0.5%로 대체하지 않는다.

숫자 포맷은 기존 USD/tabular/%·한국 상승빨강/하락파랑 토큰을 사용한다. P10/P90은 중앙80% 모형범위이며 최대손실·최대수익 한계가 아니다. `예상 최대손실`이나 `성공확률`로 바꾸어 부르지 않는다.

## 표본·판본·가정 상세

기존 펼침 `예측 원본과 판본`에 아래를 넣는다. 기본화면에는 간단한 `실제 역사표본 N일 · 경로 B개 · 미검증`과 선택 horizon의 역사적 비중첩 창 수를 보인다. 특히 1년의 약1개 독립 창은 2,000경로와 혼동되지 않게 눈에 띄게 표시한다.

- `sampleCounts.historicalReturns/start/end`: 역사적 공동 수익률 개수와 범위.
- `blockLength`, `possibleBlockStarts`, `nonoverlappingBlocks`: 중첩/비중첩 표본 수. 부트스트랩 경로가 독립 실예측2000개라는 뜻이 아님.
- `historicalNonoverlappingWindows`: 선택 horizon 길이의 역사 비중첩 창 수. 유효 독립 표본수로 확정하거나 보정 검증 통과로 읽지 않음.
- `modelVersion`, seed, pathCount, calibration, quantileConvention, policySha256, sourceDatasetId/sourceSha256/sourceAvailableAt, inputSha256. 기본 카드에는 짧은 판본 이름, 상세에는 해시를 줄바꿈 가능하게 한다.
- baseline account/revision/bookSha256/epochSession/epochProvisional. 계좌 revision은 정책판이 아니다. provisional epoch면 `예측 전용 임시 재평가 일정 · 실제 운영 T0 변경 없음`, 실제 계좌와 phase가 다르면 사후비교 불가라고 표시한다.
- `bridge.kind==='latent_index_ols_centered_residual'`이면 기본 요약에 `미관측 지수의 모형 추정 가정 포함` 배지. 상세는 bridge.session의 실제 지수 관측이 없고 cohort predictor/OLS+centered residual로 잠재값을 가정했음을 명시한다. fitStart/end/sampleCount·계수·residualSha256는 상세로 제공한다. residuals/private 입력 배열은 표시/DTO 전송 금지. 잠재값을 실제 지수 시세표/관측 테이블에 넣지 않는다.
- assumptions는 안전한 문구 매핑으로 보여준다. 미래 뉴스/금리/agent 판단을 안다는 주장 금지. 배당/FX/미래 corporate action 제외, share-basis/settlement 가정, 검증 전 모형 불확실성을 구별한다.

현재 근거의 124종목/297공동수익률/B2000/L10과 1년 약1창은 검산 맥락이다. 제품에는 이 숫자를 상수로 박지 않고 선택 저장 원본에서 읽는다. MCSE가 작다고 모형 보정이나 실제 손실확률 검증이 끝난 것은 아니다.

## 사후비교 binding

기존 10행 목록과 immutable forecast ID/원본 판본 펼침을 유지한다. 예측 mean/P10/P50/P90/손실경로비율은 당시 저장 원본, actual은 append-only 실제 모의 관측에서 읽는다. actual이 입력으로 섞이지 않게 한다.

- 대기: target/evaluation/성숙 시각 미도래. 미래 actual·오차·범위 안/밖을 렌더하지 않는다.
- 관측 부족/미확인: 세션·가격·결제/이벤트·corporate action·baseline 등 근거가 부족. 0수익/실패예측으로 바꾸지 않는다.
- 비교 불가: account/baseline/cashflow/policy/rebalance phase가 다르거나 예측 임시 epoch와 실제 epoch가 불일치. 계좌 revision 단순 증가만으로 불가를 확정하지 말고 ledger 판정을 쓴다.
- 완료: ledger가 동일조건·필요 관측 완결을 확인한 경우만 실제 netUSD/netPct, actual−forecastMean, P10/P90 범위 안/밖 표시. UI가 target일만 보고 완료를 만들지 않는다.

완료하더라도 단일 확률을 정답/오답으로 판정하지 않는다. 충분한 실제 성숙표본과 사전 정의된 평가가 없으면 전체 정확도/보정은 `미검증`이다. 요약은 서버 전체 적격 비교대상 집계이며 현재10행으로 계산하지 않는다.

## DTO·권한·오류

PreparedForecastInput/실제 book/심볼별 holdings·원본 price paths·잔차배열은 private 실행 입력이므로 클라이언트에 반환하지 않는다. owner 권한을 통과한 allowlist projection만 읽는다. query/count/summary는 같은 account/snapshot/forecast ID·horizon에 결속한다. 서버 cursor와 ID tie-breaker, immutable 원본을 보존한다.

없음/실패/blocked/0경로/불완전 horizon은 해당 상태·안전한 이유를 표시하고 분포를 꾸미지 않는다. 401/403/malformed/loading은 이전 비공개 원본과 수치를 제거한다. 다른 원본/계좌 값으로 fallback 금지. raw 에러/JSON/잔고 원장을 펼침에 그대로 출력하지 않는다. seed/hash는 필요한 provenance만 표시한다.

## 전달/검증 항목

ledger UI owner가 forecast projection의 금액/% 단위와 비교 상태 계약을 먼저 대조한다. 네 horizon 모두 동일원본baseline/issuedAt에서 올바른 target·분포를 연결하며 화면별 원본 교차가 없는지 검사한다. 3개월/1년을 단기 분포의 배수로 UI 계산하지 않는다.

필수 검증: 원본없음/blocked/0path/비교pending·부족·불가·완료, 현재미래actual부재, %단위/MCSE%p, P50추가표시와 P10P90라벨, 1년 역사창 경고, latent bridge비관측라벨, provisional epoch불일치, 403폐기, 10/10/3페이지/요약독립, 360/412/1280·sticky/포커스/기존3·5셸. 새 데이터 binding 외 레이아웃 변경이 필요하면 먼저 root에 근거를 전달한다. 본 가이드 작성자는 제품을 수정하거나 새 계산/자료를 만들지 않았다.
