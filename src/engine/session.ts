import type { GameConfig } from './config.js';
import { Shoe } from './deck.js';
import { makeRng, type Rng } from './rng.js';
import {
  dealRound,
  placeOrder,
  skipRound,
  submitReport,
  timeoutReport,
  toReport,
  type Round,
} from './round.js';
import {
  maxAffordableUnits,
  signedEvPerUnit,
  sizingFlag,
  scoreDecision,
  summarize,
  validateOrder,
  type Direction,
  type OrderContext,
  type RoundRecord,
  type SessionStats,
  type Validation,
} from './scoring.js';

export class Session {
  readonly rng: Rng;
  readonly shoe: Shoe;
  balance: number;
  records: RoundRecord[] = [];
  private roundCounter = 0;

  constructor(readonly cfg: GameConfig) {
    this.rng = makeRng(cfg.seed);
    this.shoe = new Shoe(this.rng, cfg.depletion);
    this.balance = cfg.startingBalance;
  }

  get bust(): boolean {
    return this.balance <= 0;
  }

  nextRound(): Round {
    this.roundCounter += 1;
    return dealRound(this.roundCounter, this.shoe, this.cfg, this.rng);
  }

  /**
   * Balance used for order validation. In hidden-balance mode this is the
   * starting notional, so a rejection cannot leak the live balance.
   */
  private validationBalance(): number {
    return this.cfg.validationMode === 'notional' ? this.cfg.startingBalance : this.balance;
  }

  orderContext(round: Round, balanceOverride?: number): OrderContext {
    return {
      quote: round.quote,
      valuation: round.valuation,
      balance: balanceOverride ?? this.validationBalance(),
      feePerUnit: round.feePerUnit,
      sizeLimit: round.sizeLimit,
      maxUnits: this.cfg.maxUnits,
    };
  }

  maxUnitsFor(round: Round, direction: Direction): number {
    return maxAffordableUnits(direction, this.orderContext(round));
  }

  tryPlace(round: Round, direction: Direction, units: number): Validation {
    if (round.quotePulled) return { ok: false, reason: 'The quote has been pulled.' };
    const v = validateOrder(direction, units, this.orderContext(round));
    if (v.ok) placeOrder(round, direction, units);
    return v;
  }

  skip(round: Round, timedOut = false): void {
    skipRound(round, timedOut);
  }

  toReport(round: Round): void {
    toReport(round);
  }

  report(round: Round, value: number, seconds: number): void {
    submitReport(round, value, seconds);
  }

  reportTimeout(round: Round, seconds: number): void {
    timeoutReport(round, seconds);
  }

  /** Apply P&L, score the decision, file the round record. */
  settle(round: Round): RoundRecord {
    const maxForPlayed =
      round.direction === null ? 0 : this.maxUnitsFor(round, round.direction);

    const penalty = round.action !== 'skip' && !round.reportCorrect ? this.cfg.reportPenalty : 0;
    this.balance += round.truePnl - penalty;

    const evTaken =
      signedEvPerUnit(round.direction, round.quote, round.valuation.fairValue, round.feePerUnit) *
      round.units;

    // Denominator is deliberately measured at the starting notional, not the live
    // balance, so EV-captured stays free of P&L luck.
    const evAvailable =
      round.optimalAction === 'skip'
        ? 0
        : round.edge *
          maxAffordableUnits(
            round.optimalAction,
            this.orderContext(round, this.cfg.startingBalance),
          );

    const record: RoundRecord = {
      round: round.index,
      faceUp: round.cards.filter((_, i) => round.faceUpMask[i]).map((c) => c.rank),
      hidden: round.cards.filter((_, i) => !round.faceUpMask[i]).map((c) => c.rank),
      realizedSum: round.realizedSum,
      quote: round.quote,
      fairValue: round.valuation.fairValue,
      edge: round.edge,
      optimalAction: round.optimalAction,
      howler: round.howler,
      playerAction: round.action,
      units: round.units,
      feePerUnit: round.feePerUnit,
      pnl: round.truePnl - penalty,
      evTaken,
      evAvailable,
      decisionPoint: scoreDecision(round.optimalAction, round.action),
      reportCorrect: round.reportCorrect,
      reportedPnl: round.reportedPnl,
      reportSeconds: round.reportSeconds,
      balanceAfter: this.balance,
      sizingFlag: sizingFlag(round.action, round.optimalAction, round.units, round.edge, maxForPlayed),
      event: round.event ? round.event.kind : null,
    };

    this.shoe.discard(round.cards);
    this.records.push(record);
    return record;
  }

  get stats(): SessionStats {
    return summarize(this.records, this.cfg.startingBalance);
  }
}
