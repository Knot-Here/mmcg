import type { Action, Quote } from './quotes.js';
import type { Valuation } from './valuation.js';

export type Direction = 'buy' | 'sell';

export interface OrderContext {
  quote: Quote;
  valuation: Valuation;
  balance: number;
  feePerUnit: number;
  /** Per-round cap from a size-limit market event, if any. */
  sizeLimit: number | null;
  maxUnits: number;
}

export function computePnl(
  direction: Direction | null,
  units: number,
  quote: Quote,
  realizedSum: number,
  feePerUnit = 0,
): number {
  if (!direction || units <= 0) return 0;
  const gross =
    direction === 'buy' ? (realizedSum - quote.ask) * units : (quote.bid - realizedSum) * units;
  return gross - feePerUnit * units;
}

/** Worst-case loss per unit, which is what a short must be collateralised against. */
export function riskPerUnit(direction: Direction, ctx: OrderContext): number {
  const { quote, valuation, feePerUnit } = ctx;
  const loss =
    direction === 'buy'
      ? quote.ask // a long is capped by its cost, per the spec's affordability rule
      : Math.max(valuation.maxPossibleSum - quote.bid, 0);
  return loss + feePerUnit;
}

export function maxAffordableUnits(direction: Direction, ctx: OrderContext): number {
  const risk = riskPerUnit(direction, ctx);
  const cap = Math.min(ctx.maxUnits, ctx.sizeLimit ?? Infinity);
  if (risk <= 0) return cap; // risk-free arb: only the hard cap binds
  return Math.max(0, Math.min(cap, Math.floor(ctx.balance / risk)));
}

export type Validation = { ok: true; units: number } | { ok: false; reason: string };

export function validateOrder(
  direction: Direction,
  units: number,
  ctx: OrderContext,
): Validation {
  if (!Number.isInteger(units) || units <= 0) {
    return { ok: false, reason: 'Size must be a positive whole number.' };
  }
  if (ctx.sizeLimit !== null && units > ctx.sizeLimit) {
    return { ok: false, reason: `Size limit this round is ${ctx.sizeLimit}.` };
  }
  if (units > ctx.maxUnits) {
    return { ok: false, reason: `Maximum size is ${ctx.maxUnits}.` };
  }
  const risk = riskPerUnit(direction, ctx);
  const exposure = units * risk;
  if (exposure > ctx.balance) {
    const affordable = maxAffordableUnits(direction, ctx);
    return direction === 'buy'
      ? { ok: false, reason: `Costs ${exposure}, balance is ${ctx.balance}. Max ${affordable}.` }
      : {
          ok: false,
          reason: `Worst case loses ${exposure} (max sum ${Math.round(
            ctx.valuation.maxPossibleSum,
          )} vs bid ${ctx.quote.bid}), balance is ${ctx.balance}. Max ${affordable}.`,
        };
  }
  return { ok: true, units };
}

/** Signed expected value per unit of the action the player actually took. */
export function signedEvPerUnit(
  direction: Direction | null,
  quote: Quote,
  fairValue: number,
  feePerUnit = 0,
): number {
  if (!direction) return 0;
  const raw = direction === 'buy' ? fairValue - quote.ask : quote.bid - fairValue;
  return raw - feePerUnit;
}

export interface RoundRecord {
  round: number;
  faceUp: number[];
  hidden: number[];
  realizedSum: number;
  quote: Quote;
  fairValue: number;
  edge: number;
  optimalAction: Action;
  howler: boolean;
  playerAction: Action;
  units: number;
  feePerUnit: number;
  pnl: number;
  /** EV the player actually took on, signed. */
  evTaken: number;
  /** EV that was on the table at notional max size. */
  evAvailable: number;
  decisionPoint: 0 | 1;
  reportCorrect: boolean;
  reportedPnl: number | null;
  reportSeconds: number;
  balanceAfter: number;
  sizingFlag: 'undersized' | 'oversized' | null;
  event: string | null;
}

export function scoreDecision(optimal: Action, played: Action): 0 | 1 {
  return optimal === played ? 1 : 0;
}

/**
 * Sizing is only meaningful once the direction is right. Judging the size of a
 * wrong-way trade against the optimal action's edge would tell the player to
 * put more on a position that loses money.
 */
export function sizingFlag(
  played: Action,
  optimal: Action,
  units: number,
  edge: number,
  maxUnitsAvailable: number,
): 'undersized' | 'oversized' | null {
  if (played === 'skip' || played !== optimal || maxUnitsAvailable <= 0) return null;
  const frac = units / maxUnitsAvailable;
  if (edge >= 5 && frac <= 0.2) return 'undersized';
  if (edge <= 1 && frac >= 0.8) return 'oversized';
  return null;
}

export interface SessionStats {
  rounds: number;
  pnl: number;
  balance: number;
  decisionScore: number;
  decisionPct: number;
  tradeableOffered: number;
  tradeableTaken: number;
  evTaken: number;
  evAvailable: number;
  evCapturedPct: number;
  reportsCorrect: number;
  reportsTotal: number;
  reportPct: number;
  meanReportSeconds: number;
  undersized: number;
  oversized: number;
  howlersOffered: number;
  howlersTaken: number;
}

export function summarize(records: RoundRecord[], startingBalance: number): SessionStats {
  const n = records.length;
  const sum = (f: (r: RoundRecord) => number) => records.reduce((a, r) => a + f(r), 0);
  const count = (f: (r: RoundRecord) => boolean) => records.filter(f).length;

  const decisionScore = sum((r) => r.decisionPoint);
  const evTaken = sum((r) => r.evTaken);
  const evAvailable = sum((r) => r.evAvailable);
  const reportsTotal = count((r) => r.playerAction !== 'skip');
  const reportsCorrect = count((r) => r.playerAction !== 'skip' && r.reportCorrect);
  const reportTimes = records.filter((r) => r.playerAction !== 'skip').map((r) => r.reportSeconds);
  const tradeableOffered = count((r) => r.optimalAction !== 'skip');
  const howlers = records.filter((r) => r.howler);

  return {
    rounds: n,
    pnl: sum((r) => r.pnl),
    balance: n ? records[n - 1]!.balanceAfter : startingBalance,
    decisionScore,
    decisionPct: n ? (decisionScore / n) * 100 : 0,
    tradeableOffered,
    tradeableTaken: count((r) => r.optimalAction !== 'skip' && r.playerAction === r.optimalAction),
    evTaken,
    evAvailable,
    evCapturedPct: evAvailable > 0 ? (evTaken / evAvailable) * 100 : 0,
    reportsCorrect,
    reportsTotal,
    reportPct: reportsTotal ? (reportsCorrect / reportsTotal) * 100 : 0,
    meanReportSeconds: reportTimes.length
      ? reportTimes.reduce((a, b) => a + b, 0) / reportTimes.length
      : 0,
    undersized: count((r) => r.sizingFlag === 'undersized'),
    oversized: count((r) => r.sizingFlag === 'oversized'),
    howlersOffered: howlers.length,
    howlersTaken: howlers.filter((r) => r.playerAction === r.optimalAction).length,
  };
}
