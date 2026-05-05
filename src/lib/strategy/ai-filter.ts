import { spawn } from 'node:child_process';
import type { RowDataPacket } from 'mysql2';
import { getPool } from '@/lib/db';
import type { Candle, Ticker } from '@/lib/exchanges/types';
import type { SignalInput } from '@/lib/signals/router';
import type { StyleConfig, AnalystStyle } from './style';
import { rsiLast } from './indicators/rsi';
import { emaLast } from './indicators/ema';
import { macdLast } from './indicators/macd';
import { bollingerLast } from './indicators/bollinger';
import { atrLast } from './indicators/atr';

export type SkipCategory =
  | 'ai_failed'
  | 'ai_low_confidence'
  | 'ai_rejected'
  | 'rule_prefilter'
  | 'dedup_reuse'
  | 'portfolio_guard';

export interface AiEvEstimate {
  pWin: number;
  rWin: number;
  rLoss: number;
  evPct: number;
}

/** 종목당 동시 승인 가능한 최대 시그널 수 — EV 큰 순으로 잘림 */
export const MAX_PICKS_PER_SYMBOL = 3;

/**
 * 활성 전략 의도 — LLM이 시장 국면별로 적합성 판단하도록 한 줄씩 명시.
 * 룰을 사전에 끄지 않고 LLM이 P_win 추정에 자연스럽게 반영하게 함.
 */
const STRATEGY_INTENT = `## 활성 전략 의도 (시장 국면별 적합성)
- rsi-oversold-v1, rsi-macd-reversal-v1, rsi-divergence-v1, triple-confirmation-v1: 박스권/하락 후 반등 — RSI 과매도 진입 (강한 추세장에선 P_win 낮게)
- ma-cross-v1, pullback-trend-v1: 명확한 추세 진행 중 진입 시점 — 횡보장에선 P_win 낮게
- bb-breakout-v1, bb-squeeze-expansion-v1, volume-spike-breakout-v1: 변동성 확장·돌파 모멘텀 — 추격 매수는 고점 매수 위험 → 거시 지표 양호할 때만 P_win 상향
→ 시장 국면(거시 지표·regime bucket·세션 phase)에 맞지 않는 전략의 후보는 P_win을 낮게 추정해 자동 거절되도록 평가하세요.`;

export interface AiSelectResult {
  /** 선택된 후보 인덱스 배열. EV 큰 순서, 빈 배열 = 전체 스킵, 최대 MAX_PICKS_PER_SYMBOL */
  selectedIndices: number[];
  confidence: number;
  reasoning: string;
  warnings: string[];
  skipCategory?: SkipCategory;
  ev?: AiEvEstimate;
}

export interface MarketSummary {
  currentPrice: number;
  priceChange5: number;
  volumeRatio: number;
  rsi14: number | null;
  ema20: number | null;
  ema60: number | null;
  macd: number | null;
  macdSignal: number | null;
  macdHistogram: number | null;
  bbUpper: number | null;
  bbMiddle: number | null;
  bbLower: number | null;
  atr14: number | null;
  high24h: number | undefined;
  low24h: number | undefined;
  recentCandles: Array<{ ts: string; o: number; h: number; l: number; c: number; v: number }>;
}

export function buildMarketSummary(candles: Candle[], ticker: Ticker): MarketSummary {
  const closes  = candles.map(c => c.close);
  const volumes = candles.map(c => c.volume);
  const n = candles.length - 1;

  const priceChange5 = candles.length >= 6
    ? ((closes[n] - closes[n - 5]) / closes[n - 5]) * 100 : 0;
  const vol20Avg = volumes.slice(-20).reduce((s, v) => s + v, 0) / Math.min(20, volumes.length);

  const macdPt = macdLast(closes);
  const bbPt   = bollingerLast(closes);

  return {
    currentPrice:  ticker.price,
    priceChange5:  Math.round(priceChange5 * 100) / 100,
    volumeRatio:   Math.round((volumes[n] / (vol20Avg || 1)) * 100) / 100,
    rsi14:         rsiLast(closes, 14),
    ema20:         emaLast(closes, 20),
    ema60:         emaLast(closes, 60),
    macd:          macdPt.macd,
    macdSignal:    macdPt.signal,
    macdHistogram: macdPt.histogram,
    bbUpper:       bbPt.upper,
    bbMiddle:      bbPt.middle,
    bbLower:       bbPt.lower,
    atr14:         atrLast(candles, 14),
    high24h:       ticker.high24h,
    low24h:        ticker.low24h,
    recentCandles: candles.slice(-5).map(c => ({
      ts: new Date(c.ts).toISOString().slice(0, 16).replace('T', ' '),
      o: c.open, h: c.high, l: c.low, c: c.close,
      v: Math.round(c.volume * 100) / 100,
    })),
  };
}

export type Candidate = SignalInput & { strategyId: string };

export interface RecentTrade {
  side: string;
  price: number;
  executedAt: string;
}

const STYLE_LABEL: Record<string, string> = {
  aggressive: '공격적',
  neutral:    '중립적',
  stable:     '안정적',
};

/** symbol_universe 랭킹 top 10 이내 종목을 대형주로 분류. 시장별로 latest refreshed_at을 분리 조회. */
async function classifySymbol(symbol: string): Promise<{ isMajor: boolean; symbolClass: string }> {
  try {
    const { getMarketFromSymbol } = await import('@/lib/exchanges/kis-symbols');
    const market = getMarketFromSymbol(symbol);
    const pool = getPool();
    const [latest] = await pool.query<RowDataPacket[]>(
      'SELECT refreshed_at FROM symbol_universe WHERE market = ? ORDER BY refreshed_at DESC LIMIT 1',
      [market],
    );
    if (latest.length === 0) return { isMajor: false, symbolClass: '중소형주' };
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT rank_pos FROM symbol_universe
       WHERE symbol = ? AND market = ? AND refreshed_at = ?
       ORDER BY rank_pos ASC LIMIT 1`,
      [symbol, market, latest[0].refreshed_at],
    );
    const isMajor = rows.length > 0 && Number(rows[0].rank_pos) <= 10;
    return { isMajor, symbolClass: isMajor ? '대형주' : '중소형주' };
  } catch {
    return { isMajor: false, symbolClass: '중소형주' };
  }
}

async function buildSelectPrompt(
  symbol: string,
  summary: MarketSummary,
  candidates: Candidate[],
  recentTrades: RecentTrade[] = [],
  style?: StyleConfig,
  styleName = '중립적',
  analystStyleKey: import('./style').AnalystStyle = 'neutral',
  market: import('@/lib/exchanges/kis-symbols').Market = 'domestic',
): Promise<string> {
  const fmt = (v: number | null | undefined, d = 0) => v == null ? 'N/A' : v.toFixed(d);

  const candidateList = candidates
    .map((c, i) =>
      `[${i}] 전략: ${c.strategyId} | 방향: ${c.side === 'buy' ? '매수(BUY)' : '매도(SELL)'} | 금액: ₩${Math.round(c.amountKRW).toLocaleString('ko-KR')}\n    근거: ${c.reasoning ?? '없음'}`,
    )
    .join('\n\n');

  const recentTradesSection = recentTrades.length > 0
    ? `\n## 최근 거래 이력 (최근 2시간)\n${recentTrades.map(t => `  ${t.executedAt} | ${t.side === 'buy' ? '매수' : '매도'} @ ${t.price.toLocaleString('ko-KR')}원`).join('\n')}\n`
    : '';

  const minProfit  = style ? (style.minProfitMargin * 100).toFixed(2) : '0.25';
  const minConfStr = style ? `${style.minAiConfidence}%` : '55%';
  const atrStopMult = style?.atrStopMult ?? 1.5;
  const minRWin     = style?.minRWinPct  ?? 1.0;

  // 심볼 분류 (주식: symbol_universe rank_pos ≤ 10 이면 대형주)
  const { isMajor, symbolClass } = await classifySymbol(symbol);

  // 실제 지표 기반 시장 상태 (타임존·지역 무관)
  const volRatio = summary.volumeRatio;
  const liquidityLevel =
    volRatio >= 1.5 ? `활발 (${volRatio}x)` :
    volRatio >= 0.7 ? `보통 (${volRatio}x)` :
    volRatio >= 0.4 ? `희박 (${volRatio}x)` :
                      `매우 희박 (${volRatio}x)`;

  const atrPct = summary.atr14 != null && summary.currentPrice > 0
    ? (summary.atr14 / summary.currentPrice) * 100 : null;
  const volatilityLevel = atrPct == null ? 'N/A'
    : atrPct >= 5  ? `고변동 (ATR ${atrPct.toFixed(1)}%)`
    : atrPct >= 2  ? `중변동 (ATR ${atrPct.toFixed(1)}%)`
    :                `저변동 (ATR ${atrPct.toFixed(1)}%)`;

  const trendCtx =
    summary.ema20 != null && summary.ema60 != null
      ? summary.ema20 > summary.ema60 * 1.002 ? '단기 상승 추세 (EMA20 > EMA60)'
      : summary.ema20 < summary.ema60 * 0.998 ? '단기 하락 추세 (EMA20 < EMA60)'
      :                                          '횡보 (EMA20 ≈ EMA60)'
      : '추세 판단 불가';

  // 중소형주 저유동성 시 volumeRatio 판단 기준 완화 안내
  const liquidityNote = !isMajor && volRatio < 0.7
    ? `\n- ⚠️ 중소형주는 구조적으로 거래량이 적습니다. volumeRatio < 0.7이어도 신호를 무효화하지 말고, 다른 지표(RSI·MACD·EMA)를 우선 판단하세요.`
    : '';

  const isAggressive = analystStyleKey === 'aggressive';

  const fewShotAggressive = `
## Few-shot 예시 (공격적 관점)

예시 1 — 단일 승인:
  후보: [0] rsi-macd-reversal | BUY | 근거: RSI 38, MACD 히스토그램 -0.5 → -0.2 전환, 현재봉 양봉
  시장: EMA20 < EMA60 (하락추세), volumeRatio 0.5, ATR 2.5%
  분석: 반전 초기 신호. ATR 2.5% 기준 R_win≈+1.2% 도달 가능, R_loss≈-1.0%, P_win≈0.55
       EV = 0.55×1.2 − 0.45×1.0 − 0.43(왕복 수수료+거래세) = -0.22% (경계)
  → {"selectedIndices":[0],"confidence":48,"ev":{"pWin":0.55,"rWin":1.2,"rLoss":-1.0,"evPct":-0.22},"reasoning":"RSI+MACD 반전 초기, EV 경계","warnings":["추세 역행 진입 → 빠른 청산 전제"]}

예시 2 — 다중 승인 (EV 큰 순):
  후보: [0] rsi-macd-reversal BUY EV +0.45 / [1] bb-squeeze-expansion BUY EV +0.32 / [2] rsi-divergence BUY EV +0.10
  → {"selectedIndices":[0,1,2],"confidence":58,"ev":{"pWin":0.55,"rWin":1.5,"rLoss":-1.0,"evPct":0.45},"reasoning":"3 후보 모두 EV>0.1, 진입 분산","warnings":[]}

예시 3 — 거절 케이스:
  후보: [0] bb-breakout | BUY | 근거: 상단 돌파
  시장: RSI 72 (과열), volumeRatio 0.3 (유동성 부족), ATR 4%
  분석: 과열 + 저유동성 + 고변동. R_loss 과대(-4%) 가능, P_win≈0.4
       EV = 0.4×0.8 − 0.6×4.0 − 0.43 = -2.51%
  → {"selectedIndices":[],"confidence":70,"ev":{"pWin":0.4,"rWin":0.8,"rLoss":-4.0,"evPct":-2.51},"reasoning":"과열+저유동성+고변동 EV 크게 음수","warnings":["RSI 과열","저유동성","고ATR"]}
`;

  const judgmentCriteria = isAggressive
    ? `## 평가 방식 (EV 기반 — hard-block 금지)
각 후보에 대해 다음 숫자를 추정:
  P_win : 30m~2h 안에 목표(R_win) 도달 확률 (0.0 ~ 1.0)
  R_win : 도달 시 수익률 % (권장 최소 ${minRWin}% 이상)
  R_loss: 손절 시 손실률 % (보통 -ATR × ${atrStopMult})
  EV    = P_win × R_win − (1 − P_win) × |R_loss| − 0.43(왕복 수수료+거래세)

판정:
- EV > +0.1% AND confidence ≥ 45 → 해당 후보 승인 (selectedIndices 배열에 추가)
- EV ≤ 0 OR confidence < 45 → 해당 후보 스킵
- **여러 후보 중 EV 큰 순으로 최대 ${MAX_PICKS_PER_SYMBOL}개까지 selectedIndices에 포함**. 모두 음수면 selectedIndices=[]

**중요: hard-block 없음**. 수수료·추세 역행·저유동성·고변동은 P_win/R_win/R_loss 숫자를 조정하는 변수일 뿐, 단독 차단 기준이 아님.

## 공격적 성향 원칙
1. "애매하면 진입해본다" — EV 근거를 숫자로 제시.
2. 추세 역행 반전 허용: R_loss를 작게 잡고(ATR×1.0) 빠른 청산 전제 → 진입 가능.
3. 중소형주 저유동성은 R_win 하향 조정으로 흡수. volumeRatio 0.3 이하는 P_win에 -0.1.
4. 거래정지·관리종목 패턴(거래량 0 + 비정상 가격): 즉시 selectedIndices=[].
${fewShotAggressive}`
    : `## 판단 기준
1. 수수료 수익성: 예상 순수익 ≥ ${minProfit}% 권장 (수수료+거래세 0.43% 고려, 단 복합 지표가 강하면 경계 케이스 승인 가능)
2. 추세 일치성: 시그널 방향이 현재 추세(EMA 방향)와 부합하는가?
3. 거래량 신뢰도: 대형주는 volumeRatio ≥ 0.7, 중소형주는 ≥ 0.4 기준 적용
4. 복합 지표 일치: RSI, MACD, EMA가 시그널 방향을 지지하는가?
5. 변동성 위험: ATR이 고변동(≥3%)이고 추세 불분명이면 신뢰도 낮게 평가
6. 거래정지·관리종목 패턴: 거래량 급감 + 이상 가격 감지 시 즉시 스킵`;

  const outputSpec = isAggressive
    ? `{"selectedIndices":[],"confidence":0,"reasoning":"EV 계산 과정 포함","ev":{"pWin":0.0,"rWin":0.0,"rLoss":0.0,"evPct":0.0},"warnings":[]}`
    : `{"selectedIndices":[],"confidence":0,"reasoning":"판단 근거 (한국어)","warnings":[]}`;

  const traderTitle = market === 'overseas' ? '미국주식 퀀트 트레이더' : '국내주식 퀀트 트레이더';
  const feeNotice = market === 'overseas'
    ? '- KIS 미국주식 수수료: 매수 0.25% + 매도 0.25% = 왕복 약 **0.50%** (거래세 없음, SEC fee 0.0022% 별도)'
    : '- KIS 수수료: 매수 0.015% + 매도 0.015% + 거래세 0.20% = 왕복 약 **0.43%**';

  const holdMin   = style?.holdingPeriodDays?.min ?? 1;
  const holdMax   = style?.holdingPeriodDays?.max ?? 7;
  const targetPct = style?.targetProfitPct ?? 2.0;
  const universeSrc = style?.universeSource ?? 'volume-top';
  const stableCoreMin = style?.stableCoreRatioMin ?? 0.20;
  const maxPos = style?.maxPositionsPerSymbol ?? 3;

  return `당신은 ${traderTitle}입니다. 종목 ${symbol}에 대해 여러 전략이 매매 후보 시그널을 생성했습니다.
시장 데이터를 분석하여 가장 적합한 시그널 하나를 선택하거나, 모두 부적합하면 스킵하세요.

## 투자 성향: ${styleName} (신뢰도 ${minConfStr} 이상일 때만 선택)

## 투자 성향 상세
- 보유 기간 가이드: ${holdMin}~${holdMax}일
- 평균 목표 수익률: ${targetPct}% (R_win 최소 ${minRWin}% 권장)
- 재매수 쿨다운: ${style?.rebuyCooldownMin ?? 30}분
- 종목당 최대 동시 진입: ${maxPos}건
- 포트폴리오 안정 코어 비율: ≥ ${(stableCoreMin * 100).toFixed(0)}% (KOSPI 100 종목)
- universe 종목 풀: ${universeSrc}

→ EV 추정 시 R_win은 보유 기간 ${holdMin}~${holdMax}일 내 도달 가능 수준으로 평가하세요.
→ 단기 변동(30분~수시간) 기준이 아닌, 위 보유 기간 척도로 P_win·R_win 산출.

## 현재 시장 상태 (실시간 지표 기반)
- 심볼 분류: ${symbolClass}
- 유동성: ${liquidityLevel}
- 변동성: ${volatilityLevel}
- 추세: ${trendCtx}${liquidityNote}

## 수수료 정보 (필수 고려)
${feeNotice}
- 공격 모드 최소 참고 목표: ${minProfit}% (EV 계산의 floor 가이드 — hard block 아님)
${recentTradesSection}
## 현재 시세
- 현재가: ${summary.currentPrice.toLocaleString('ko-KR')}원
- 당일 고가: ${fmt(summary.high24h)}원 / 저가: ${fmt(summary.low24h)}원
- 최근 5봉 가격변화: ${summary.priceChange5 > 0 ? '+' : ''}${summary.priceChange5}%

## 기술 지표 (30분봉)
- RSI(14): ${fmt(summary.rsi14, 1)}
- EMA(20): ${fmt(summary.ema20)}원 / EMA(60): ${fmt(summary.ema60)}원
- MACD: ${fmt(summary.macd, 2)} / Signal: ${fmt(summary.macdSignal, 2)} / Histogram: ${fmt(summary.macdHistogram, 2)}
- 볼린저밴드: Upper=${fmt(summary.bbUpper)} Middle=${fmt(summary.bbMiddle)} Lower=${fmt(summary.bbLower)}
- ATR(14): ${fmt(summary.atr14, 0)}원
- 거래량 비율: ${summary.volumeRatio}x (1.0=평균)

## 최근 5봉 캔들
${summary.recentCandles.map(c => `  ${c.ts} | O:${c.o} H:${c.h} L:${c.l} C:${c.c} V:${c.v}`).join('\n')}

## 후보 시그널 (${candidates.length}개)
${candidateList}

${STRATEGY_INTENT}

${judgmentCriteria}

selectedIndices 배열에 EV>0.1% 통과한 후보 인덱스를 EV 큰 순서로 **최대 ${MAX_PICKS_PER_SYMBOL}개**까지 입력하세요(0~${candidates.length - 1}).
모두 부적합하면 빈 배열 [].
반드시 JSON 형식으로만 응답하세요:
${outputSpec}

## 언어 규칙 (필수)
- "reasoning", "warnings" 모든 텍스트는 **반드시 한국어로만** 작성
- 영어/중국어(中文)/일본어 사용 금지 — 위반 시 응답 무효`;
}

/**
 * Claude CLI subprocess 실행.
 *
 * 과거 이슈 + 해결책:
 *  - `--tools ''`, `--system-prompt`, `--no-session-persistence`은 현재 CLI 버전에서 "Execution error" 유발 → 사용 금지
 *  - `--output-format json`은 effortLevel null 버그 → 사용 금지
 *  - 부모 프로세스에 `CLAUDECODE=1` 있으면 중첩 실행 감지로 SIGTERM(exit 143) → env에서 제거 필수
 *  - `ANTHROPIC_API_KEY`에 크레딧 소진 키가 있으면 hang → 제거하고 ~/.claude 구독 인증 fallback
 *  - **동시 호출 시 100% "Execution error" 자종료** → `cliQueue`로 직렬화
 *  - **순차 호출도 ~30% 간헐 "Execution error"** → 2회까지 재시도
 *  - cwd=/tmp : 프로젝트 CLAUDE.md 컨텍스트 격리
 *  - 정상 작동 조합: `claude -p <prompt> --permission-mode bypassPermissions --model sonnet`
 */

// CLI 호출 직렬화 큐 (동시성 1 — 세션 파일 충돌 방지)
let cliQueue: Promise<unknown> = Promise.resolve();

async function runClaude(prompt: string, timeoutMs = 90000): Promise<string> {
  // 2회 재시도 (총 3회 시도) — 간헐 "Execution error" 대응
  const attempt = async (): Promise<string> => {
    for (let tries = 0; tries < 3; tries++) {
      try {
        return await runClaudeOnce(prompt, timeoutMs);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (tries < 2 && msg.includes('Execution error')) {
          await new Promise(r => setTimeout(r, 300 + tries * 500));
          continue;
        }
        throw e;
      }
    }
    throw new Error('unreachable');
  };

  // 직렬화: 이전 호출 완료까지 대기
  const prev = cliQueue;
  const next = prev.then(() => attempt(), () => attempt());
  cliQueue = next.catch(() => {});
  return next;
}

function runClaudeOnce(prompt: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    // 부모가 Claude Code 세션일 때 claude CLI가 중첩 실행 감지 → SIGTERM(exit 143) 자종료.
    // 관련 감지 env 전부 제거해야 정상 동작.
    const cleanEnv: NodeJS.ProcessEnv = { ...process.env };
    for (const k of [
      'CLAUDECODE',
      'CLAUDE_CODE_ENTRYPOINT',
      'CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING',
      'CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS',
      'CLAUDE_CODE_EXECPATH',
      'CLAUDE_AGENT_SDK_VERSION',
      'VSCODE_IPC_HOOK_CLI',
      'VSCODE_CLI_REQUIRE_TOKEN',
      'VSCODE_HANDLES_UNCAUGHT_ERRORS',
      'VSCODE_HANDLES_SIGPIPE',
      'VSCODE_ESM_ENTRYPOINT',
      'VSCODE_L10N_BUNDLE_LOCATION',
      'VSCODE_NLS_CONFIG',
      'VSCODE_AGENT_FOLDER',
      'VSCODE_CWD',
      'ELECTRON_RUN_AS_NODE',
      // 크레딧 소진된 API key가 설정되어 있으면 CLI가 그 키로 호출하다 hang → exit 143.
      // 제거하면 ~/.claude 구독 인증으로 fallback되어 정상 작동.
      'ANTHROPIC_API_KEY',
    ]) delete cleanEnv[k];

    const proc = spawn('claude', [
      '--print', prompt,
      '--permission-mode', 'bypassPermissions',
      '--model', 'sonnet',
    ], {
      timeout: timeoutMs,
      cwd: '/tmp',
      env: cleanEnv,
      // stdin을 ignore로 차단 — PM2에서 부모 pipe가 열려있으면 CLI가 입력 대기로 hang.
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let out = '';
    let err = '';
    proc.stdout.on('data', (d: Buffer) => { out += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { err += d.toString(); });
    proc.on('error', (e: NodeJS.ErrnoException) => {
      if (e.code === 'ENOENT') reject(new Error('claude CLI not found in PATH'));
      else reject(e);
    });
    proc.on('close', (code: number | null) => {
      if (code !== 0 && code !== null) return reject(new Error(err.trim() || `claude exit ${code}`));
      const trimmed = out.trim();
      if (trimmed === 'Execution error' || trimmed.startsWith('Execution error\n')) {
        return reject(new Error(`claude Execution error: ${err.trim() || 'no stderr'}`));
      }
      resolve(trimmed);
    });
  });
}

function parseResult(raw: string): AiSelectResult {
  let parsed: Record<string, unknown> | null = null;

  try {
    const cleaned = raw.replace(/```(?:json)?/g, '').replace(/```/g, '').trim();
    const start = cleaned.indexOf('{');
    const end   = cleaned.lastIndexOf('}');
    if (start === -1 || end === -1) throw new Error('JSON not found in response');
    parsed = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
  } catch (e) {
    throw new Error(`JSON not found in response: ${e instanceof Error ? e.message : e}`);
  }

  if (!parsed) throw new Error('JSON not found in response');

  const rawConf = typeof parsed.confidence === 'number' ? parsed.confidence : 50;
  // Claude가 0~1 스케일로 반환하는 경우 100 스케일로 변환
  const confidence = rawConf <= 1 ? Math.round(rawConf * 100) : rawConf;

  let ev: AiEvEstimate | undefined;
  if (parsed.ev && typeof parsed.ev === 'object') {
    const e = parsed.ev as Record<string, unknown>;
    ev = {
      pWin:  Number(e.pWin  ?? 0),
      rWin:  Number(e.rWin  ?? 0),
      rLoss: Number(e.rLoss ?? 0),
      evPct: Number(e.evPct ?? 0),
    };
  }

  return {
    selectedIndices: parseSelectedIndices(parsed),
    confidence,
    reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : '',
    warnings:  Array.isArray(parsed.warnings) ? parsed.warnings as string[] : [],
    ev,
  };
}

/**
 * selectedIndices 배열 파싱 — legacy `selectedIndex: number` 응답도 호환:
 *  - selectedIndices 배열 우선
 *  - selected_indices / indices 별칭 허용
 *  - 없거나 비배열이면 legacy `selectedIndex` (-1=빈배열, ≥0=[n])
 *  - candidateCount 제공 시 인덱스 범위 검증·잘림. 중복 제거.
 *  - MAX_PICKS_PER_SYMBOL로 잘림.
 */
function parseSelectedIndices(obj: Record<string, unknown>, candidateCount?: number): number[] {
  const raw = obj.selectedIndices ?? obj.selected_indices ?? obj.indices;
  let arr: number[] = [];
  if (Array.isArray(raw)) {
    arr = raw.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  } else if (typeof obj.selectedIndex === 'number') {
    if (obj.selectedIndex >= 0) arr = [obj.selectedIndex];
  }
  // 중복 제거 + 인덱스 범위 검증 (candidateCount 주어졌을 때만)
  const seen = new Set<number>();
  const cleaned: number[] = [];
  for (const n of arr) {
    const idx = Math.trunc(n);
    if (idx < 0) continue;
    if (candidateCount != null && idx >= candidateCount) continue;
    if (seen.has(idx)) continue;
    seen.add(idx);
    cleaned.push(idx);
  }
  return cleaned.slice(0, MAX_PICKS_PER_SYMBOL);
}

/**
 * 종목의 후보 시그널 목록을 AI에게 제시해 최적 전략을 선택하게 한다.
 * 실패 시 fallback: 후보가 1개면 index=0 실행, 여러 개면 첫 번째 선택.
 */
export async function getRecentTrades(symbol: string): Promise<RecentTrade[]> {
  try {
    const pool = getPool();
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT side, price, created_at FROM signals
       WHERE symbol = ? AND status IN ('executed','accepted')
         AND created_at > DATE_SUB(NOW(), INTERVAL 2 HOUR)
       ORDER BY created_at DESC LIMIT 5`,
      [symbol],
    );
    return rows.map(r => ({
      side: r.side as string,
      price: Number(r.price),
      executedAt: new Date(r.created_at as string).toISOString().slice(0, 16).replace('T', ' '),
    }));
  } catch {
    return [];
  }
}

export interface BatchSymbolInput {
  symbol: string;
  candidates: Candidate[];
  summary: MarketSummary;
  recentTrades: RecentTrade[];
  heldQty?: number;
  /** 매입평단가 (보유 종목만). 미실현 손익률 계산용 */
  heldAvgPrice?: number;
  /** 동일 regime bucket의 과거 30일 누적 성과 (분석가 자가검증용) */
  regimeStats?: { count: number; winRate: number; avgEvPct: number } | null;
}

export interface BatchDecision {
  symbol: string;
  selectedIndices: number[];   // EV 큰 순서, 빈 배열 = 전체 스킵, 최대 MAX_PICKS_PER_SYMBOL
  confidence: number;
  reasoning: string;
  warnings: string[];
  skipCategory?: SkipCategory;
  ev?: AiEvEstimate;
}

export interface BatchResult {
  decisions: BatchDecision[];
  error?: string;
  marketView?: string;
}

export interface MarketContext {
  btc3hChangePct?: number | null;
  btc3hVolRatio?: number | null;
  recentExecutedBuys?: number;
  recentExecutedSells?: number;
  avgVolumeRatio?: number | null;
  highVolCount?: number;
  /** 시장 세션 phase 라벨 + 마감까지 남은 분 (시장별) */
  sessionPhase?: string;
  minutesToClose?: number | null;
  /** 거시 지표 — 당일 변화율 (%) */
  kospiChangePct?: number | null;
  sp500ChangePct?: number | null;
  usdKrwChangePct?: number | null;
}

function buildSymbolBlock(idx: number, input: BatchSymbolInput, isMajor: boolean): string {
  const fmt = (v: number | null | undefined, d = 0) => v == null ? 'N/A' : v.toFixed(d);
  const s = input.summary;
  const atrPct = s.atr14 != null && s.currentPrice > 0 ? ((s.atr14 / s.currentPrice) * 100) : null;
  const volTxt =
    s.volumeRatio >= 1.5 ? `활발(${s.volumeRatio}x)` :
    s.volumeRatio >= 0.7 ? `보통(${s.volumeRatio}x)` :
                           `희박(${s.volumeRatio}x)`;
  const atrTxt = atrPct == null ? 'N/A' :
    atrPct >= 3 ? `고(ATR ${atrPct.toFixed(1)}%)` :
    atrPct >= 1 ? `중(ATR ${atrPct.toFixed(1)}%)` :
                  `저(ATR ${atrPct.toFixed(1)}%)`;
  const trendTxt =
    s.ema20 != null && s.ema60 != null
      ? s.ema20 > s.ema60 * 1.002 ? '상승' : s.ema20 < s.ema60 * 0.998 ? '하락' : '횡보'
      : 'N/A';
  // 보유 컨텍스트 — 진입가·미실현 손익률 노출 (있으면)
  let held = '미보유';
  if (input.heldQty && input.heldQty > 0) {
    if (input.heldAvgPrice && input.heldAvgPrice > 0 && s.currentPrice > 0) {
      const pnlPct = ((s.currentPrice - input.heldAvgPrice) / input.heldAvgPrice) * 100;
      const sign = pnlPct >= 0 ? '+' : '';
      held = `보유 ${input.heldQty} @진입 ${input.heldAvgPrice.toLocaleString('ko-KR')} (평가 ${sign}${pnlPct.toFixed(2)}%)`;
    } else {
      held = `보유 ${input.heldQty}`;
    }
  }

  // 동일 regime 과거 성과 (있으면)
  const regimeLine = input.regimeStats && input.regimeStats.count >= 5
    ? `\n- 과거 동일 regime (30일): ${input.regimeStats.count}건 승률 ${(input.regimeStats.winRate * 100).toFixed(0)}% / 평균 EV ${input.regimeStats.avgEvPct >= 0 ? '+' : ''}${input.regimeStats.avgEvPct.toFixed(2)}%`
    : '';

  const candidateList = input.candidates.map((c, i) =>
    `    [${i}] ${c.strategyId} | ${c.side === 'buy' ? 'BUY' : 'SELL'} | ₩${Math.round(c.amountKRW).toLocaleString('ko-KR')} | ${c.reasoning ?? ''}`,
  ).join('\n');

  const ohlcv = s.recentCandles.slice(-5).map(c =>
    `O${c.o}/H${c.h}/L${c.l}/C${c.c}/V${c.v}`,
  ).join(' · ');

  const tradesTxt = input.recentTrades.length > 0
    ? input.recentTrades.map(t => `${t.executedAt} ${t.side === 'buy' ? '매수' : '매도'}@${t.price.toLocaleString('ko-KR')}`).join(', ')
    : '없음';

  return `### [${idx}] ${input.symbol} (${isMajor ? '대형주' : '중소형주'} / ${held})
- 시장: 유동성 ${volTxt} | 변동성 ${atrTxt} | 추세 ${trendTxt} | 5봉변화 ${s.priceChange5 > 0 ? '+' : ''}${s.priceChange5}%
- 시세: ${s.currentPrice.toLocaleString('ko-KR')}원 (당일 ${fmt(s.high24h)}~${fmt(s.low24h)})
- 지표: RSI ${fmt(s.rsi14, 1)} | EMA20=${fmt(s.ema20)} EMA60=${fmt(s.ema60)} | MACD ${fmt(s.macd, 1)}/${fmt(s.macdSignal, 1)}/${fmt(s.macdHistogram, 1)} | BB ${fmt(s.bbUpper)}/${fmt(s.bbMiddle)}/${fmt(s.bbLower)}
- 5봉: ${ohlcv}
- 최근 2h: ${tradesTxt}${regimeLine}
- 후보 (${input.candidates.length}개):
${candidateList}`;
}

async function buildBatchPrompt(
  inputs: BatchSymbolInput[],
  style: StyleConfig | undefined,
  analystStyle: AnalystStyle,
  marketContext: MarketContext,
  market: import('@/lib/exchanges/kis-symbols').Market = 'domestic',
): Promise<string> {
  const styleName = STYLE_LABEL[analystStyle] ?? '중립적';
  const minProfit = style ? (style.minProfitMargin * 100).toFixed(2) : '0.25';
  const minConfStr = style ? `${style.minAiConfidence}%` : '55%';
  const atrStopMult = style?.atrStopMult ?? 1.5;
  const minRWin = style?.minRWinPct ?? 1.0;
  const isAggressive = analystStyle === 'aggressive';

  const judgmentCriteria = isAggressive
    ? `## 평가 방식 (EV 기반 — hard-block 금지)
각 후보에 대해 다음 숫자 추정:
  P_win  : 30m~2h 내 목표(R_win) 도달 확률 (0.0~1.0)
  R_win  : 도달 시 수익률 % (최소 ${minRWin}% 권장)
  R_loss : 손절 손실률 % (보통 -ATR × ${atrStopMult})
  EV     = P_win × R_win − (1 − P_win) × |R_loss| − 0.43 (왕복 수수료+거래세)
판정:
- EV > +0.1% AND confidence ≥ 45 → selectedIndices에 해당 후보 인덱스 추가
- EV ≤ 0 OR confidence < 45 → 해당 후보 제외
- **여러 후보 중 EV 큰 순으로 최대 ${MAX_PICKS_PER_SYMBOL}개까지 selectedIndices에 포함**. 모두 음수면 selectedIndices=[]

**중요: hard-block 없음**. 수수료·추세 역행·저유동성·고변동은 숫자 조정 변수일 뿐, 단독 차단 기준 아님.
거래정지·관리종목 패턴 (거래량 0 + 비정상 가격) 은 즉시 selectedIndices=[].`
    : `## 판단 기준
1. 수수료 수익성: 예상 순수익 ≥ ${minProfit}% 권장 (수수료+거래세 0.43% 반영, 복합 지표 강하면 경계 케이스 승인 가능)
2. 추세 일치성: 시그널 방향이 현재 추세(EMA) 와 부합?
3. 거래량 신뢰도: 대형주 volumeRatio ≥ 0.7, 중소형주 ≥ 0.4
4. 복합 지표 일치: RSI/MACD/EMA 가 시그널 방향 지지?
5. 변동성 위험: ATR ≥ 3% + 추세 불분명 → 신뢰도 낮게
6. 거래정지·관리종목 패턴 (거래량 급감+이상 가격) → 즉시 스킵`;

  const macroPart = (() => {
    const parts: string[] = [];
    if (marketContext.kospiChangePct != null) parts.push(`KOSPI(KODEX200) ${marketContext.kospiChangePct >= 0 ? '+' : ''}${marketContext.kospiChangePct.toFixed(2)}%`);
    if (marketContext.sp500ChangePct != null) parts.push(`SP500(SPY) ${marketContext.sp500ChangePct >= 0 ? '+' : ''}${marketContext.sp500ChangePct.toFixed(2)}%`);
    if (marketContext.usdKrwChangePct != null) parts.push(`USD/KRW ${marketContext.usdKrwChangePct >= 0 ? '+' : ''}${marketContext.usdKrwChangePct.toFixed(2)}%`);
    return parts.length > 0 ? `\n- 거시: ${parts.join(' / ')}` : '';
  })();

  const sessionPart = marketContext.sessionPhase && marketContext.sessionPhase !== 'closed' && marketContext.minutesToClose != null
    ? `\n- 세션: ${marketContext.sessionPhase} | 마감까지 ${marketContext.minutesToClose}분 (${marketContext.minutesToClose < 30 ? '⚠ 신규 진입 시 청산 시간 부족' : '여유 있음'})`
    : '';

  const marketView = `- Universe 평균 거래량비: ${marketContext.avgVolumeRatio != null ? `${marketContext.avgVolumeRatio.toFixed(2)}x` : 'N/A'} | 고변동(ATR≥3%) 종목 수: ${marketContext.highVolCount ?? 0}
- 최근 3h 체결: 매수 ${marketContext.recentExecutedBuys ?? 0}건, 매도 ${marketContext.recentExecutedSells ?? 0}건${sessionPart}${macroPart}`;

  // symbol_universe rank 기반 대형주 분류 (batch 입력 전체 선행 조회)
  const majorMap = new Map<string, boolean>();
  await Promise.all(inputs.map(async i => {
    const { isMajor } = await classifySymbol(i.symbol);
    majorMap.set(i.symbol, isMajor);
  }));

  const symbolBlocks = inputs.map((input, idx) => buildSymbolBlock(idx, input, majorMap.get(input.symbol) ?? false)).join('\n\n');

  const evField = isAggressive ? `"ev":{"pWin":0.0,"rWin":0.0,"rLoss":0.0,"evPct":0.0},` : '';

  const traderTitle = market === 'overseas' ? '미국주식 퀀트 트레이더' : '국내주식 퀀트 트레이더';
  const holdMin = style?.holdingPeriodDays?.min ?? 1;
  const holdMax = style?.holdingPeriodDays?.max ?? 7;
  const targetPct = style?.targetProfitPct ?? 2.0;
  const universeSrc = style?.universeSource ?? 'volume-top';
  const stableCoreMin = style?.stableCoreRatioMin ?? 0.20;
  const maxPos = style?.maxPositionsPerSymbol ?? 3;

  return `당신은 ${traderTitle}입니다. 아래 ${inputs.length}개 종목 각각에 대해 매매 후보 시그널이 생성되었습니다.
**각 종목을 독립적으로 평가**하여 EV>0.1% 통과한 후보를 EV 큰 순으로 **최대 ${MAX_PICKS_PER_SYMBOL}개까지** 승인하거나, 모두 부적합하면 스킵하세요.

## 투자 성향: ${styleName} (신뢰도 ${minConfStr} 이상일 때만 선택)

## 투자 성향 상세
- 보유 기간 가이드: ${holdMin}~${holdMax}일
- 평균 목표 수익률: ${targetPct}% (R_win 최소 ${minRWin}% 권장)
- 재매수 쿨다운: ${style?.rebuyCooldownMin ?? 30}분
- 종목당 최대 동시 진입: ${maxPos}건
- 포트폴리오 안정 코어 비율: ≥ ${(stableCoreMin * 100).toFixed(0)}% (KOSPI 100 종목)
- universe 종목 풀: ${universeSrc}

→ EV 추정 시 R_win은 보유 기간 ${holdMin}~${holdMax}일 내 도달 가능 수준으로 평가하세요.
→ 단기 변동(30분~수시간) 기준이 아닌, 위 보유 기간 척도로 P_win·R_win 산출.

## 시장 거시 맥락 (최근 3시간)
${marketView}

## 수수료
- ${market === 'overseas' ? 'KIS 미국주식 왕복 ~0.50% (거래세 없음)' : 'KIS 국내주식 왕복 수수료+거래세 0.43%'} | 최소 참고 목표 ${minProfit}%

${STRATEGY_INTENT}

${judgmentCriteria}

## 종목별 데이터
${symbolBlocks}

## 응답 형식
반드시 아래 JSON 형식으로만 응답. 각 종목에 대해 독립적으로 판단:
\`\`\`json
{
  "marketView": "시장 전반 한 줄 코멘트 (반드시 한국어)",
  "decisions": [
    { "symbol": "KRW-XXX", "selectedIndices": [0], "confidence": 62, "reasoning": "반드시 한국어로만 작성", ${evField}"warnings": [] }
  ]
}
\`\`\`
- selectedIndices: 각 종목 후보 배열의 인덱스 0~N-1 중 EV 큰 순 최대 ${MAX_PICKS_PER_SYMBOL}개. 모두 부적합 시 빈 배열 []
- decisions 배열은 제공된 ${inputs.length}개 종목 **모두** 포함
- 심볼 누락 금지

## 언어 규칙 (필수)
- "marketView", "reasoning", "warnings" 모든 텍스트는 **반드시 한국어로만** 작성
- 영어/중국어(中文)/일본어 사용 금지 — 위반 시 응답 무효
- 예시: "RSI 과열 + 거래량 부족 → 매수 보류", "MA 데드크로스 + 음봉 확정 → 청산 권고"`;
}

function parseBatchResult(raw: string, inputs: BatchSymbolInput[]): BatchResult {
  let parsed: { marketView?: string; decisions?: unknown[] };
  try {
    const cleaned = raw.replace(/```(?:json)?/g, '').replace(/```/g, '').trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end === -1) throw new Error('JSON not found');
    parsed = JSON.parse(cleaned.slice(start, end + 1));
  } catch (e) {
    return { decisions: [], error: `parse failed: ${e instanceof Error ? e.message : e}` };
  }

  const rawDecisions = Array.isArray(parsed.decisions) ? parsed.decisions : [];
  const bySymbol = new Map<string, BatchDecision>();

  for (const d of rawDecisions) {
    if (!d || typeof d !== 'object') continue;
    const obj = d as Record<string, unknown>;
    const symbol = typeof obj.symbol === 'string' ? obj.symbol : null;
    if (!symbol) continue;

    const input = inputs.find(i => i.symbol === symbol);
    if (!input) continue;

    const rawConf = typeof obj.confidence === 'number' ? obj.confidence : 50;
    const confidence = rawConf <= 1 ? Math.round(rawConf * 100) : rawConf;

    const selectedIndices = parseSelectedIndices(obj, input.candidates.length);

    let ev: AiEvEstimate | undefined;
    if (obj.ev && typeof obj.ev === 'object') {
      const e = obj.ev as Record<string, unknown>;
      ev = {
        pWin: Number(e.pWin ?? 0),
        rWin: Number(e.rWin ?? 0),
        rLoss: Number(e.rLoss ?? 0),
        evPct: Number(e.evPct ?? 0),
      };
    }

    bySymbol.set(symbol, {
      symbol,
      selectedIndices,
      confidence,
      reasoning: typeof obj.reasoning === 'string' ? obj.reasoning : '',
      warnings: Array.isArray(obj.warnings) ? (obj.warnings as string[]) : [],
      ev,
    });
  }

  const decisions: BatchDecision[] = [];
  for (const input of inputs) {
    const d = bySymbol.get(input.symbol);
    if (d) {
      decisions.push(d);
    } else {
      decisions.push({
        symbol: input.symbol,
        selectedIndices: [],
        confidence: 0,
        reasoning: 'AI 배치 응답에 누락됨',
        warnings: ['missing in batch response'],
        skipCategory: 'ai_failed',
      });
    }
  }

  return { decisions, marketView: typeof parsed.marketView === 'string' ? parsed.marketView : undefined };
}

// 180s → 300s: Stage 2 Claude CLI subprocess 직렬화 큐 + 재시도 3회 마진 확보.
// TradingInvest 36h 운영에서 sell ai_failed 338건이 모두 'aborted' (timeout) 였던 사례 반영.
const BATCH_TIMEOUT_MS = 300000;

/**
 * Stage 1 결정으로부터 BatchDecision 생성 (Hybrid 모드 전용).
 * - pass     : 첫 번째 후보(EV 큰 순) 1개 선택 + reasoning에 stage1 reasoning 보존
 * - reject   : 빈 selectedIndices + skipCategory='ai_rejected'
 * - escalate : 사용 안 함 (escalate는 Stage 2로 가므로 호출되지 않음)
 *
 * Stage 1 신뢰도(0.0~1.0)는 BatchDecision.confidence(0~100)로 환산.
 */
function buildBatchDecisionFromStage1(
  input: BatchSymbolInput,
  d: import('./ai-filter-stage1').Stage1Decision | undefined,
): BatchDecision {
  const confidencePct = Math.round((d?.confidence ?? 0.5) * 100);
  if (!d || d.verdict === 'reject') {
    return {
      symbol: input.symbol,
      selectedIndices: [],
      confidence: confidencePct,
      reasoning: d?.reasoning ?? 'stage1 reject',
      warnings: [],
      skipCategory: 'ai_rejected',
    };
  }
  // pass — 후보 중 첫 번째 1개만 채택 (EV 추정은 stage1 값 사용)
  const evPct = d.evEstimatePct;
  return {
    symbol: input.symbol,
    selectedIndices: input.candidates.length > 0 ? [0] : [],
    confidence: confidencePct,
    reasoning: `[stage1] ${d.reasoning}`,
    warnings: [],
    ev: { pWin: 0.55, rWin: Math.max(0.5, evPct + 1), rLoss: -1, evPct },
  };
}

/**
 * Stage 1 (pass/reject) 결정 + Stage 2 (Claude) 결정을 단일 BatchResult로 병합.
 * 입력 inputs 순서대로 decisions 배치.
 */
function mergeStage1AndStage2(
  allInputs: BatchSymbolInput[],
  stage1: import('./ai-filter-stage1').Stage1Decision[],
  stage2: BatchResult,
): BatchResult {
  const stage2Map = new Map(stage2.decisions.map(d => [d.symbol, d]));
  const stage1Map = new Map(stage1.map(d => [d.symbol, d]));

  const decisions: BatchDecision[] = allInputs.map(input => {
    const s2 = stage2Map.get(input.symbol);
    if (s2) return s2;       // Claude가 결정한 항목
    const s1 = stage1Map.get(input.symbol);
    return buildBatchDecisionFromStage1(input, s1);
  });

  return {
    decisions,
    marketView: stage2.marketView,
    error: stage2.error,
  };
}

/**
 * 여러 종목의 후보를 **단일 CLI 호출**에 배열로 묶어 제출하고 심볼별 결정을 받는다.
 * 실패 시 error 필드에 메시지, decisions는 빈 배열.
 *
 * Hybrid 모드(provider==='hybrid'): 함수 진입부에서 Stage 1(M4 도메인 모델) 광역 스크리닝 →
 * pass/reject 즉시 결정, escalate만 Stage 2(Claude)로 전송. Stage 1 실패 시 legacy로 fallback.
 */
export async function aiSelectSignalBatch(
  inputs: BatchSymbolInput[],
  style: StyleConfig | undefined,
  analystStyle: AnalystStyle,
  marketContext: MarketContext,
  market: import('@/lib/exchanges/kis-symbols').Market = 'domestic',
): Promise<BatchResult> {
  if (inputs.length === 0) return { decisions: [] };

  // === Hybrid 모드 인터셉트 — Stage 1 광역 스크리닝 ===
  // provider==='hybrid' 일 때만 동작. Stage 1 실패 시 legacy single-stage로 즉시 fallback.
  let escalateInputs: BatchSymbolInput[] = inputs;
  let stage1Decisions: import('./ai-filter-stage1').Stage1Decision[] = [];
  try {
    const { getActiveProvider } = await import('@/lib/llm/provider');
    const provider = await getActiveProvider();
    if (provider === 'hybrid') {
      const { runStage1Screen } = await import('./ai-filter-stage1');
      try {
        const stage1 = await runStage1Screen(inputs, market);
        stage1Decisions = stage1.decisions;

        // 'volatile_high' regime이거나 보유 종목이면 Stage 1 결과 무시하고 Claude로 escalate (안전성)
        const forceEscalateSymbols = new Set(
          inputs
            .filter(i => (i.heldQty ?? 0) > 0)
            .map(i => i.symbol),
        );

        // pass/reject는 Stage 1 결정 채택, escalate만 Stage 2(Claude)로
        escalateInputs = inputs.filter(i => {
          if (forceEscalateSymbols.has(i.symbol)) return true;
          const d = stage1.decisions.find(s => s.symbol === i.symbol);
          return !d || d.verdict === 'escalate';
        });

        // 모두 pass/reject 처리됐으면 Stage 2 호출 자체 스킵
        if (escalateInputs.length === 0) {
          const decisions: BatchDecision[] = inputs.map(input => {
            const d = stage1.decisions.find(s => s.symbol === input.symbol);
            return buildBatchDecisionFromStage1(input, d);
          });
          console.log(`[ai-batch:hybrid] all ${inputs.length} symbols decided at stage1 — Claude skipped`);
          return { decisions };
        }
        console.log(`[ai-batch:hybrid] stage1: ${inputs.length} → escalate ${escalateInputs.length} to Claude`);
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        console.warn(`[ai-batch:hybrid] stage1 실패 — legacy single-stage로 fallback: ${errMsg}`);
        escalateInputs = inputs;
        stage1Decisions = [];
      }
    }
  } catch (e) {
    // provider 모듈 import 실패 — 안전하게 legacy 동작
    console.warn(`[ai-batch:hybrid] provider 조회 실패 — legacy: ${e instanceof Error ? e.message : String(e)}`);
  }

  const prompt = await buildBatchPrompt(escalateInputs, style, analystStyle, marketContext, market);

  try {
    const raw = await runClaude(prompt, BATCH_TIMEOUT_MS);
    const stage2Result = parseBatchResult(raw, escalateInputs);

    // Stage 1 채택 결과를 stage2Result.decisions에 병합 (escalate가 아닌 pass/reject만)
    const result: BatchResult =
      stage1Decisions.length > 0 && escalateInputs.length < inputs.length
        ? mergeStage1AndStage2(inputs, stage1Decisions, stage2Result)
        : stage2Result;
    const minConfidence = style?.minAiConfidence ?? 55;
    const styleName = STYLE_LABEL[analystStyle] ?? '중립적';

    // 성향별 신뢰도 필터 + skipCategory 분류
    for (const d of result.decisions) {
      if (d.skipCategory === 'ai_failed') continue;
      if (d.selectedIndices.length > 0 && d.confidence < minConfidence) {
        d.warnings.push(`신뢰도 ${d.confidence}% < 최소 ${minConfidence}% (${styleName})`);
        d.selectedIndices = [];
        d.skipCategory = 'ai_low_confidence';
      } else if (d.selectedIndices.length === 0 && !d.skipCategory) {
        d.skipCategory = 'ai_rejected';
      }
    }

    const selectedSymbols = result.decisions.filter(d => d.selectedIndices.length > 0).length;
    const totalPicks      = result.decisions.reduce((s, d) => s + d.selectedIndices.length, 0);
    const skippedSymbols  = result.decisions.filter(d => d.selectedIndices.length === 0).length;
    console.log(`[ai-batch] 1 call, ${inputs.length} symbols → ${selectedSymbols} selected (${totalPicks} picks) / ${skippedSymbols} skipped${result.marketView ? ` | marketView: ${result.marketView.slice(0, 80)}` : ''}`);
    return result;
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    console.error('[ai-batch] 배치 실패:', errMsg);
    return { decisions: [], error: errMsg };
  }
}

export async function aiSelectSignal(
  symbol: string,
  candidates: Candidate[],
  candles: Candle[],
  ticker: Ticker,
  style?: StyleConfig,
  analystStyle: AnalystStyle = 'neutral',
  market: import('@/lib/exchanges/kis-symbols').Market = 'domestic',
): Promise<AiSelectResult> {
  const summary    = buildMarketSummary(candles, ticker);
  const recentTrades = await getRecentTrades(symbol);
  const styleName  = STYLE_LABEL[analystStyle] ?? '중립적';
  const prompt     = await buildSelectPrompt(symbol, summary, candidates, recentTrades, style, styleName, analystStyle, market);
  const minConfidence = style?.minAiConfidence ?? 55;

  try {
    // 단건 호출(주로 보유 종목 청산 fallback)도 BATCH와 동일 timeout — Claude CLI subprocess 큐 영향
    const raw    = await runClaude(prompt, BATCH_TIMEOUT_MS);
    const result = parseResult(raw);
    // 범위 초과 인덱스 보정 (parseSelectedIndices에서 일부 처리되지만 candidates.length 모르고 호출되는 경로 대비)
    result.selectedIndices = result.selectedIndices.filter(i => i >= 0 && i < candidates.length);
    // 성향별 AI 신뢰도 최소값 미달 시 전체 스킵
    if (result.selectedIndices.length > 0 && result.confidence < minConfidence) {
      console.log(`[ai-filter] ${symbol} → confidence ${result.confidence}% < ${minConfidence}% (${styleName}) → skip`);
      result.selectedIndices = [];
      result.skipCategory = 'ai_low_confidence';
      result.warnings.push(`신뢰도 ${result.confidence}% < 최소 ${minConfidence}% (${styleName})`);
    }
    // Claude가 직접 거절한 경우 (빈 배열이고 카테고리 미설정)
    if (result.selectedIndices.length === 0 && !result.skipCategory) {
      result.skipCategory = 'ai_rejected';
    }
    console.log(`[ai-filter] ${symbol} → picks=[${result.selectedIndices.join(',')}] cat=${result.skipCategory ?? 'selected'} (${result.confidence}%) ${result.reasoning.slice(0, 80)}`);
    return result;
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    console.error('[ai-filter] AI 분석 실패 — 스킵:', errMsg);
    return {
      selectedIndices: [],
      confidence:    0,
      reasoning:     `AI 분석 실패 — ${errMsg}`,
      warnings:      [`AI filter error: ${errMsg}`],
      skipCategory:  'ai_failed',
    };
  }
}
