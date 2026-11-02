/**
 * T-143 WP-A — KIS **해외 종목 마스터**(`nysmst.cod`) 수집·판독.
 *
 * 정본: `docs/design/2026-11-01-t143-wpa-nyse50-spec.md` §2.3. 파싱은 순수 함수(`parseOverseasMaster`)이고
 * 다운로드만 외부에 나간다 — 시험은 순수 함수로 한다.
 *
 * ## 무엇에 쓰나 (KIS API 호출 0건으로 세 가지를 동시에 푼다)
 *  1. **요청 표기** — `symb` 열이 KIS 가 받는 표기다. 클래스주는 **슬래시**(`BRK/B`)이고 내부 규약은 점(`NYS:BRK.B`)이라
 *     이 열이 없으면 NYSE 시총 5위 안의 `BRK.B` 가 「조회 불가」로 조용히 빠진다(2026-10-21~11-01 운영에서 11일 연속 실패했다).
 *  2. **비보통주·DR 사전 판별** — `stis`(2=주식·3=ETP)·`etyp`(ETP 분류)·`isdr`(DR 여부). KIS 를 부르기 전에 걸러
 *     낭비 호출을 없앤다.
 *  3. **KIS 미취급 종목** — SEC NYSE 후보인데 마스터에 없으면 KIS 가 취급하지 않는다(상장 직후·NYSE American·마스터 지연).
 *
 * ## 실측한 파일 모양 (2026-11-01, `NYSMST.COD` 369,855 B)
 *  - **탭 구분 · cp949 · 24열 · 2,841행**(모든 행이 정확히 24열, `excd` 는 전부 `NYS`).
 *  - `stis` 분포 `2:2,462 · 3:379` / `isdr` `N:2,771 · Y:70` / `etyp` `(공백 3칸):2,462 · 004:299 · 001:78 · 000:2`.
 *  - 🔴 **`etyp` 는 빈 문자열이 아니라 공백 3칸이다** — `trim()` 하지 않으면 보통주 2,462건이 전부 「ETP」 로 제외된다.
 *  - `symb` 의 비영숫자는 **슬래시뿐**(440행). 하이픈·점 표기는 0건.
 *  - `rsym`(실시간 심볼)은 `NYS` + 표기(`NYSBRK/B`) 꼴이다 — 현재가상세 응답의 `rsym`(`D` 접두)과 **다른 형식**이라
 *    둘을 대조하지 않는다.
 */
import AdmZip from 'adm-zip';
import { createHash } from 'node:crypto';
import iconv from 'iconv-lite';
import { trackCall } from '@/lib/api-usage';

/** 국내 마스터(`kospi_code.mst.zip`)와 **같은 호스트**다 — `src/lib/exchanges/kis-master.ts` 가 이미 쓴다. */
export const KIS_MASTER_BASE = 'https://new.real.download.dws.co.kr/common/master';
export const NYSE_MASTER_URL = `${KIS_MASTER_BASE}/nysmst.cod.zip`;

/** 이 파일이 가진 24열 중 쓰는 것만. 원값 문자열 그대로 둔다(해석·환산 없음). */
export interface OverseasMasterEntry {
  /** KIS 요청 표기(`SYMB` 파라미터에 그대로 넣는다) — 클래스주는 `BRK/B`. */
  symb: string;
  /** 실시간 심볼(`NYSBRK/B`) — 참고용. */
  rsym: string;
  /** 거래소 코드(`NYS`). */
  excd: string;
  /** 영문 종목명. */
  enam: string | null;
  /** 종목 유형 `1`=지수 `2`=주식 `3`=ETP `4`=워런트. */
  stis: string;
  /** DR(주식예탁증서) 여부 `Y`/`N`. */
  isdr: string;
  /** ETP 분류(`001` ETF·`002` ETN…). **보통주는 공백 3칸이라 trim 한 값**을 담는다(빈 문자열 = ETP 아님). */
  etyp: string;
}

export const OVERSEAS_MASTER_COLUMNS = 24;

/** 0부터 센 열 위치 — 사양 §2.3 의 24열 배치. */
const COL = { excd: 2, symb: 4, rsym: 5, enam: 7, stis: 8, isdr: 17, etyp: 22 } as const;

export class OverseasMasterError extends Error {
  constructor(message: string) {
    super(`KIS 해외 종목 마스터 판독 불가 — ${message}`);
    this.name = 'OverseasMasterError';
  }
}

export interface ParsedOverseasMaster {
  entries: OverseasMasterEntry[];
  /** 24열이 아니거나 `symb` 가 비어 버린 줄 수. 전체의 절반을 넘으면 던진다(형식이 바뀐 것이다). */
  dropped: number;
}

/**
 * cp949 탭 구분 마스터 → 행 배열. **열 수가 24가 아닌 줄은 버리고 센다.** 쓸 수 있는 행이 0이거나
 * 버린 줄이 읽은 줄의 절반을 넘으면 던진다 — 형식이 바뀐 파일로 상위 50을 만들지 않는다.
 */
export function parseOverseasMaster(buf: Buffer): ParsedOverseasMaster {
  const text = iconv.decode(buf, 'cp949');
  const entries: OverseasMasterEntry[] = [];
  let dropped = 0;
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (!line.trim()) continue;
    const c = line.split('\t');
    if (c.length !== OVERSEAS_MASTER_COLUMNS) { dropped += 1; continue; }
    const symb = (c[COL.symb] ?? '').trim().toUpperCase();
    if (!symb) { dropped += 1; continue; }
    entries.push({
      symb,
      rsym: (c[COL.rsym] ?? '').trim(),
      excd: (c[COL.excd] ?? '').trim().toUpperCase(),
      enam: (c[COL.enam] ?? '').trim() || null,
      stis: (c[COL.stis] ?? '').trim(),
      isdr: (c[COL.isdr] ?? '').trim().toUpperCase(),
      // 🔴 공백 3칸을 빈 문자열로 — 이 trim 이 없으면 보통주 2,462건이 모두 ETP 로 제외된다
      etyp: (c[COL.etyp] ?? '').trim(),
    });
  }
  if (entries.length === 0) throw new OverseasMasterError('쓸 수 있는 행이 0건');
  if (dropped > entries.length) {
    throw new OverseasMasterError(`버린 줄(${dropped})이 읽은 줄(${entries.length})보다 많음 — 열 구분이 바뀐 것으로 본다`);
  }
  return { entries, dropped };
}

export interface OverseasMasterFile extends ParsedOverseasMaster {
  /** 표기 → 행. 같은 표기가 두 번 나오면 **먼저 나온 행**을 쓴다(마스터는 거래소 1곳이라 사실상 유일하다). */
  bySymb: Map<string, OverseasMasterEntry>;
  rows: number;
  /** zip 안 원본 바이트의 sha256 — run 기록에 남긴다(본문은 저장하지 않는다). */
  sha256: string;
}

export function indexMaster(parsed: ParsedOverseasMaster, sha256: string): OverseasMasterFile {
  const bySymb = new Map<string, OverseasMasterEntry>();
  for (const e of parsed.entries) if (!bySymb.has(e.symb)) bySymb.set(e.symb, e);
  return { ...parsed, bySymb, rows: parsed.entries.length, sha256 };
}

export type FetchLike = (url: string, init?: { headers?: Record<string, string> }) => Promise<Response>;

/**
 * 마스터 zip 1회 다운로드 → 판독. **실패는 던진다** — 마스터 없이 추측 표기로 KIS 를 부르지 않는다
 * (사양 §2.3 「v1 은 마스터 파일을 필수로 둔다」). 호출부는 run 을 `failed('master_unavailable')` 로 닫는다.
 */
export async function fetchNyseMaster(opts: { fetchImpl?: FetchLike; url?: string } = {}): Promise<OverseasMasterFile> {
  const url = opts.url ?? NYSE_MASTER_URL;
  const f: FetchLike = opts.fetchImpl ?? ((u, i) => fetch(u, i as RequestInit));
  // op 는 **리터럴**이다 — `src/lib/__tests__/api-usage-callsites.test.ts` 가 기록 지점의 op 를 리터럴로 고정한다
  //   (변수로 넘기면 그 시험에 `<var>` 로 남아 오타·배선 변경을 잡지 못한다).
  const res = await trackCall('kis-master', 'download.nyse', () => f(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 StockInvest-bot' },
  }));
  if (!res.ok) throw new OverseasMasterError(`HTTP ${res.status} (${url})`);
  const zipBuf = Buffer.from(await res.arrayBuffer());
  let data: Buffer;
  try {
    const entries = new AdmZip(zipBuf).getEntries();
    if (entries.length === 0) throw new Error('zip 이 비어 있음');
    data = entries[0].getData();
  } catch (e) {
    throw new OverseasMasterError(`zip 해제 실패: ${e instanceof Error ? e.message : String(e)}`);
  }
  return indexMaster(parseOverseasMaster(data), createHash('sha256').update(data).digest('hex'));
}

/** 마스터 기준 분류 결과 — 왜 뺐는지(또는 왜 넣었는지)를 값으로 남긴다. */
export type MasterVerdict =
  | { kind: 'ready'; entry: OverseasMasterEntry }
  /** 마스터에 없다 — KIS 미취급(상장 직후·NYSE American·마스터 지연). */
  | { kind: 'master_missing' }
  /** `stis !== '2'` — 지수·ETP·워런트. `entry` 를 함께 주어 제외된 행도 마스터 값을 남길 수 있게 한다. */
  | { kind: 'master_type'; value: string; entry: OverseasMasterEntry }
  /** `etyp` 가 비어 있지 않다 — ETF·ETN 등. */
  | { kind: 'master_etp'; value: string; entry: OverseasMasterEntry };

/**
 * 표기 후보로 마스터를 찾아 분류한다.
 *
 * 🔴 **DR(`isdr='Y'`)은 여기서 빼지 않는다.** Leader 결정 L-A2 는 ADR 을 1회차에서 **제외하되**
 * 「제외하지 않았다면 몇 위였는지」(가상 순위)를 기록하라고 했다 — 그 수치는 `tomv` 를 받아 봐야 알 수 있으므로
 * DR 도 **스캔하고** 제외는 `finalize` 에서 한다(사양 §3.3 은 listing 단계 제외였다. 사양과 다른 점이고,
 * 늘어나는 KIS 호출은 2026-11-01 실측 기준 70건(전체 2,034건의 3.4%)이다).
 */
export function classifyByMaster(
  master: Pick<OverseasMasterFile, 'bySymb'>,
  symbolCandidates: readonly string[],
): MasterVerdict {
  let entry: OverseasMasterEntry | undefined;
  for (const c of symbolCandidates) {
    entry = master.bySymb.get(c);
    if (entry) break;
  }
  if (!entry) return { kind: 'master_missing' };
  if (entry.stis !== '2') return { kind: 'master_type', value: entry.stis || '(빈값)', entry };
  if (entry.etyp) return { kind: 'master_etp', value: entry.etyp, entry };
  return { kind: 'ready', entry };
}
