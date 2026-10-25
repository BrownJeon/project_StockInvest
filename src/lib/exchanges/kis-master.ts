import AdmZip from 'adm-zip';
import iconv from 'iconv-lite';
import { trackCall, type Op } from '@/lib/api-usage';

/**
 * KIS 종목 마스터(.mst) 파일 다운로드·파싱.
 *
 * 출처: KIS 공식 마스터 파일 (zip + EUC-KR 고정폭).
 *  - kospi_code.mst : 한 행 228 byte (단축코드9, 표준코드12, 한글종목명40, ...)
 *  - kosdaq_code.mst: 한 행 222 byte (구조 동일)
 *
 * 본 모듈은 단축코드(6자리) + 한글종목명만 추출. 매일 17:00 cron으로 갱신.
 */

const KOSPI_URL  = 'https://new.real.download.dws.co.kr/common/master/kospi_code.mst.zip';
const KOSDAQ_URL = 'https://new.real.download.dws.co.kr/common/master/kosdaq_code.mst.zip';

export interface MasterRow {
  symbol: string;
  name: string;
}

async function downloadMst(url: string, op: Op): Promise<Buffer> {
  // T-040 호출 기록 — 응답 헤더 수신까지(ZIP 본문 수신 시간은 제외). op 는 호출부 상수.
  const res = await trackCall('kis-master', op, () => fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 StockInvest-bot' },
  }));
  if (!res.ok) throw new Error(`download ${url} HTTP ${res.status}`);
  const zipBuf = Buffer.from(await res.arrayBuffer());
  const zip = new AdmZip(zipBuf);
  const entries = zip.getEntries();
  if (entries.length === 0) throw new Error(`empty zip from ${url}`);
  return entries[0].getData();
}

/** EUC-KR 고정폭 mst 파일에서 단축코드(0~9 byte) + 한글종목명(21~61 byte) 추출. */
function parseMst(buf: Buffer): MasterRow[] {
  const out: MasterRow[] = [];
  const LF = 0x0A;
  const CR = 0x0D;
  let start = 0;
  for (let i = 0; i <= buf.length; i++) {
    if (i === buf.length || buf[i] === LF) {
      let end = i;
      while (end > start && buf[end - 1] === CR) end--;
      const len = end - start;
      if (len >= 61) {
        const symbol = iconv.decode(buf.subarray(start, start + 9), 'ascii').trim();
        const name   = iconv.decode(buf.subarray(start + 21, start + 61), 'euc-kr').trim();
        if (/^\d{6}$/.test(symbol) && name) out.push({ symbol, name });
      }
      start = i + 1;
    }
  }
  return out;
}

export async function fetchKospiMaster(): Promise<MasterRow[]> {
  const buf = await downloadMst(KOSPI_URL, 'download.kospi');
  return parseMst(buf);
}

export async function fetchKosdaqMaster(): Promise<MasterRow[]> {
  const buf = await downloadMst(KOSDAQ_URL, 'download.kosdaq');
  return parseMst(buf);
}

export async function fetchAllDomesticMaster(): Promise<MasterRow[]> {
  const [k, q] = await Promise.all([fetchKospiMaster(), fetchKosdaqMaster()]);
  const seen = new Set<string>();
  const merged: MasterRow[] = [];
  for (const row of [...k, ...q]) {
    if (seen.has(row.symbol)) continue;
    seen.add(row.symbol);
    merged.push(row);
  }
  return merged;
}
