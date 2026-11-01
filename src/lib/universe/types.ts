/**
 * T-143 WP-B 해외 분석 대상 — **공유 타입** (구현 가이드 §4.1 의 `UniverseScreenDTO`).
 *
 * 정본: `docs/design/2026-11-01-t143-implementation-guide.md` §4(API 계약 3개)·§5(DB 가 담아야 할 것).
 * 승인 데모: `mockups/T-143-universe-watch-v1.html` v1.
 *
 * 규칙(가이드 §2.2·§4.1):
 *  - **값이 없으면 0 을 넣지 않는다** — `null` 로 두고 화면이 그 구절을 뺀다(T-108 과 같은 규칙).
 *  - **문장·숫자 계산을 화면에 맡기지 않는다** — 제안 버튼 글자(`action.label`·`action.verb`)와
 *    확인 시트의 효과 숫자(`effect`)는 서버가 완성해 준다. 화면은 더하거나 빼지 않는다.
 *  - **Q2(주기)·Q4(개수)를 화면에 박지 않는다** — `autoTopN`·`autoNextAt` 로 내려보낸다.
 *  - 시각 문자열은 ISO 8601 `+09:00`(KST 표기, 서버가 만든다).
 *  - 섹션 단위 실패 격리 — 한 섹션 실패는 그 섹션만 `error` 이고 HTTP 200(`/api/ops/home` 선례).
 *
 * 이 파일은 **런타임 import 0개**(type 전용)라 클라이언트 컴포넌트가 그대로 import 해도 DB 코드가 딸려 가지 않는다.
 */

/** 종목이 분석 대상에 들어온 출처. 4가지가 섞인다(가이드 §2.5). */
export type UniverseSource = 'manual' | 'auto' | 'favorite' | 'held';

/**
 * 제안 상태 4종(가이드 §2.4.1). 카드의 다섯째 상태 `failed` 는 **화면 전용**이라 여기 없다
 * — 저장 요청이 실패한 화면 상태이고 DB 에 `failed` 를 만들지 않는다.
 */
export type ProposalState = 'open' | 'held' | 'ignored' | 'done';

/** 제안 1건의 주 행동 3종 — 빼기·넣기·코드 바꾸기. 「삭제」라는 말은 쓰지 않는다(데모 §3). */
export type ProposalActionType = 'remove' | 'add' | 'recode';

/** 제안 처리 요청 4종. `reopen` = 되돌리기(`held`·`ignored` 만). */
export type ProposalDo = 'act' | 'hold' | 'ignore' | 'reopen';

/** 변경 확인이 읽는 원천 3곳 — 미국 공시 · 해외 뉴스 · 상장 목록(가이드 §2.7). */
export type WatchSourceId = 'us_filings' | 'news_overseas' | 'listing';

/** 섹션 단위 실패 격리(T-108 `Section<T>` 과 같은 모양 — 그 타입을 import 하지 않고 같은 꼴을 둔다). */
export type UniverseSection<T> = { state: 'ok'; data: T } | { state: 'error'; error: string };

/** 머리 숫자 4칸(가이드 §2.2) + 효과 계산의 기준. */
export interface UniverseSummary {
  /** 분석 대상 = 보유 ∪ 즐겨찾기 ∪ 목록. */
  total: number;
  manual: number;
  /**
   * 🔴 수동 목록이 어디서 왔나(Reviewer high-2). `'fallback'` = 개정판이 아직 없어 **환경변수·코드 기본 목록**을
   * 센 값이다(분석이 실제로 쓰는 값과 같다 — 0 을 보여 주면 거짓이 된다).
   * 이 사실을 화면에 **어떻게 보일지는 designer 가 정한다** — 지금은 숫자만 맞춰 두었다.
   */
  manualSource: 'db' | 'fallback';
  auto: number;
  favorites: number;
  held: number;
  /** 수동 목록 마지막 갱신(ISO +09:00). 기록이 없으면 null — 화면은 그 구절을 뺀다. */
  manualUpdatedAt: string | null;
  /** 「349일 전」 — 서버가 조회 시각과의 차로 계산한다. */
  manualUpdatedDaysAgo: number | null;
  /** 일괄 교체 409 판정의 기준(가이드 §4.3). 기록이 없으면 0. */
  manualVersion: number;
  /** 자동 목록 산출 시각(ISO +09:00). WP-A 미착수면 null. */
  autoRefreshedAt: string | null;
  /** 다음 산출 예정(ISO +09:00). 주기(Q2)가 바뀌면 이 값이 따라간다. */
  autoNextAt: string | null;
  /** 자동 목록 개수(Q4) — 라벨 `자동 — NYSE 상위 {n}` 을 이 값으로 만든다. 모르면 null. */
  autoTopN: number | null;
  /** 「목록을 비우면 남는 수」(보유 ∪ 즐겨찾기). 모르면 null — 화면은 그 구절을 뺀다. */
  heldOrFavoritesOnlyCount: number | null;
}

/** 원천 1곳의 마지막 확인 결과. */
export interface WatchCoverage {
  source: WatchSourceId;
  ok: boolean;
  /** 실패했을 때 그 시각(ISO +09:00). 성공이면 null. */
  failedAt: string | null;
}

/**
 * 변경 확인 실행 기록(가이드 §5.3). `allChecked` 는 **서버가 그렇게 말할 때만** true 다 —
 * 화면이 원천 수를 세어 「3곳 모두 확인」을 쓰지 않는다(§2.7).
 */
export interface UniverseWatch {
  lastCheckedAt: string | null;
  coverage: WatchCoverage[];
  allChecked: boolean;
}

/** 제안 1건 처리 효과 — 확인 시트의 숫자(가이드 §2.4.3). 서버가 계산한다. */
export interface ProposalEffect {
  manualFrom: number;
  manualTo: number;
  totalFrom: number;
  totalTo: number;
  /** 보유 중이라 분석 대상 수가 그대로인가 — 「보유 중이라 분석 대상 수는 150 그대로입니다」. */
  heldKeepsAnalysis: boolean;
}

export interface ProposalAction {
  type: ProposalActionType;
  /** 주 버튼 글자 — `목록에서 빼기` / `목록에 넣기` / `코드 바꾸기 NAS:AJJJ → NYS:AJJJ`. */
  label: string;
  /** 확인 버튼 글자 — `빼기` / `넣기` / `바꾸기`. */
  verb: string;
  /** `recode` 일 때 바꿀 코드. 그 밖은 null. */
  nextSymbol: string | null;
}

export interface Proposal {
  id: string;
  /** 전체 코드(`NAS:AAAA`) — 이 화면은 거래소 접두사가 뜻을 가지므로 줄이지 않는다(가이드 §2.5). */
  symbol: string;
  /** 내부 분류 코드(예 delisting·acquisition·exchange_move). */
  kind: string;
  /** 화면 칩 글자(예 `상장폐지 예정`). 서버가 완성해 준다. */
  kindLabel: string;
  /** 근거 한 줄 — 원천 + 수집일. */
  basis: string;
  /** 권고 한 줄. 없으면 null → 화면은 `action.label` 을 쓴다. */
  recommendation: string | null;
  action: ProposalAction;
  /**
   * 확인 시트의 효과 숫자. **목록·요약 조회가 실패하면 null** 이다 — 제안 조회와 목록 조회는 따로 실패하므로
   * (가이드 §2.8) 목록을 못 읽은 채로도 제안은 보여야 하고, 그때 숫자를 추측해 만들지 않는다.
   * null 이면 시트가 효과 줄을 **뺀다**(0 으로 채우지 않는다 — 프로젝트 공통 규칙).
   */
  effect: ProposalEffect | null;
  /** 보유 중이면 수량. `qty` 를 모르면 `{ qty: null }`(칩은 「보유」 — 0 으로 채우지 않는다). */
  held: { qty: number | null } | null;
  state: ProposalState;
  /** `held` 상태의 해제 시각(ISO +09:00) — 화면이 날짜를 계산하지 않는다(D4). */
  heldUntil: string | null;
  /** 보유 중 경고 한 줄. 없으면 null. */
  warn: string | null;
  /** 완료 문구(`목록에서 뺐습니다 (보유 중이라 분석은 계속)` 등). */
  doneText: string;
}

export interface UniverseRow {
  symbol: string;
  /** `stock_meta` 에 없으면 null — 이름 조회를 위해 외부·`/api/ticker/*` 를 부르지 않는다. */
  name: string | null;
  sources: UniverseSource[];
  /** 자동 목록 순위(시가총액). 자동이 아니면 null. */
  autoRank: number | null;
  heldQty: number | null;
  hasProposal: boolean;
}

/** `GET /api/settings/overseas-universe` 응답 본문(가이드 §4.1). */
export interface UniverseScreenDTO {
  /** 조회 시각(ISO +09:00) — 앱바 오른쪽. */
  generatedAt: string;
  summary: UniverseSection<UniverseSummary>;
  watch: UniverseSection<UniverseWatch>;
  proposals: UniverseSection<Proposal[]>;
  list: UniverseSection<UniverseRow[]>;
}

/**
 * `POST …/proposals/[id]` 성공 응답 본문.
 * 🔴 두 값이 **null 일 수 있다**(Reviewer m-2): 트랜잭션은 커밋됐는데 그 뒤 다시 읽기가 실패한 경우다.
 * 그때는 **「저장되지 않았다」고 말하면 거짓**이므로 화면이 다른 문구를 쓰고 조용히 재조회한다.
 */
export interface ProposalActResult {
  proposal: Proposal | null;
  summary: UniverseSummary | null;
}

/** `PUT …/manual` 성공 응답 본문(가이드 §4.3). `summary` 는 m-2 와 같은 이유로 null 일 수 있다. */
export interface ManualReplaceResult {
  summary: UniverseSummary | null;
  applied: { added: number; removed: number; kept: number };
  version: number;
}
