import type { Card } from './deck.js';
import { Shoe } from './deck.js';
import type { GameConfig } from './config.js';
import type { Rng } from './rng.js';
import { generateQuote, labelQuote, type Action, type Quote } from './quotes.js';
import { valueHand, type Valuation } from './valuation.js';
import { computePnl, type Direction } from './scoring.js';

export type Phase = 'AWAITING_DECISION' | 'REVEALED' | 'AWAITING_REPORT' | 'SETTLED';

export type MarketEvent =
  | { kind: 'quote_pulled'; atSecond: number }
  | { kind: 'quote_shift'; atSecond: number; delta: number }
  | { kind: 'size_limit'; limit: number }
  | { kind: 'fee'; feePerUnit: number };

export function describeEvent(e: MarketEvent): string {
  switch (e.kind) {
    case 'quote_pulled':
      return `Quote will be pulled after ${e.atSecond}s`;
    case 'quote_shift':
      return `Market moved ${e.delta > 0 ? '+' : ''}${e.delta}`;
    case 'size_limit':
      return `Size limit: max ${e.limit} units`;
    case 'fee':
      return `Fee round: ${e.feePerUnit} per unit traded`;
  }
}

export interface Round {
  index: number;
  cards: Card[];
  faceUpMask: boolean[];
  quote: Quote;
  valuation: Valuation;
  edge: number;
  optimalAction: Action;
  howler: boolean;
  event: MarketEvent | null;
  eventFired: boolean;
  feePerUnit: number;
  sizeLimit: number | null;
  phase: Phase;
  quotePulled: boolean;
  action: Action;
  direction: Direction | null;
  units: number;
  realizedSum: number;
  truePnl: number;
  reportedPnl: number | null;
  reportCorrect: boolean;
  reportSeconds: number;
  timedOutDecision: boolean;
  reshuffled: boolean;
}

function rollEvent(cfg: GameConfig, rng: Rng): MarketEvent | null {
  if (!cfg.marketEvents) return null;
  if (!rng.chance(0.35)) return null;
  const roll = rng.int(1, 4);
  const maxT = Math.max(3, cfg.decisionSeconds - 3);
  const atSecond = rng.int(3, maxT);
  switch (roll) {
    case 1:
      return { kind: 'quote_pulled', atSecond };
    case 2:
      return { kind: 'quote_shift', atSecond, delta: rng.int(1, 3) * (rng.chance(0.5) ? 1 : -1) };
    case 3:
      return { kind: 'size_limit', limit: rng.int(1, 5) };
    default:
      return { kind: 'fee', feePerUnit: rng.int(1, 2) };
  }
}

export function dealRound(index: number, shoe: Shoe, cfg: GameConfig, rng: Rng): Round {
  const n = rng.int(cfg.cardsMin, cfg.cardsMax);
  const reshuffled = shoe.prepare(n);
  const cards = shoe.deal(n);

  const f = Math.min(n, rng.int(cfg.faceUpMin, cfg.faceUpMax));
  const faceUpMask = cards.map((_, i) => i < f);

  const faceUpValues = cards.filter((_, i) => faceUpMask[i]).map((c) => c.rank);
  const hidden = cards.filter((_, i) => !faceUpMask[i]);
  const pool = cfg.depletion ? shoe.unknownValues(hidden) : null;
  const valuation = valueHand(faceUpValues, hidden.length, pool);

  const rq = generateQuote(valuation, cfg.quote, rng);
  const event = rollEvent(cfg, rng);

  return {
    index,
    cards,
    faceUpMask,
    quote: rq.quote,
    valuation,
    edge: rq.edge,
    optimalAction: rq.optimalAction,
    howler: rq.howler,
    event,
    eventFired: event !== null && (event.kind === 'size_limit' || event.kind === 'fee'),
    feePerUnit: event?.kind === 'fee' ? event.feePerUnit : 0,
    sizeLimit: event?.kind === 'size_limit' ? event.limit : null,
    phase: 'AWAITING_DECISION',
    quotePulled: false,
    action: 'skip',
    direction: null,
    units: 0,
    realizedSum: cards.reduce((a, c) => a + c.rank, 0),
    truePnl: 0,
    reportedPnl: null,
    reportCorrect: false,
    reportSeconds: 0,
    timedOutDecision: false,
    reshuffled,
  };
}

/** Re-label edge and optimal action after anything changes the quote or the fee. */
export function relabel(round: Round, cfg: GameConfig): void {
  const { edge, optimalAction } = labelQuote(
    round.valuation.fairValue,
    round.quote,
    cfg.quote.edgeThreshold,
    round.feePerUnit,
  );
  round.edge = edge;
  round.optimalAction = optimalAction;
}

/** Fire a timed market event. Returns true if something changed. */
export function fireEvent(round: Round, cfg: GameConfig): boolean {
  const e = round.event;
  if (!e || round.eventFired) return false;
  if (e.kind === 'quote_pulled') {
    round.quotePulled = true;
    round.eventFired = true;
    return true;
  }
  if (e.kind === 'quote_shift') {
    round.quote = { bid: Math.max(1, round.quote.bid + e.delta), ask: round.quote.ask + e.delta };
    if (round.quote.ask <= round.quote.bid) round.quote.ask = round.quote.bid + 1;
    relabel(round, cfg);
    round.eventFired = true;
    return true;
  }
  return false;
}

export function placeOrder(round: Round, direction: Direction, units: number): void {
  round.action = direction;
  round.direction = direction;
  round.units = units;
  round.truePnl = computePnl(direction, units, round.quote, round.realizedSum, round.feePerUnit);
  round.phase = 'REVEALED';
}

export function skipRound(round: Round, timedOut = false): void {
  round.action = 'skip';
  round.direction = null;
  round.units = 0;
  round.truePnl = 0;
  round.timedOutDecision = timedOut;
  round.phase = 'REVEALED';
}

export function toReport(round: Round): void {
  round.phase = 'AWAITING_REPORT';
}

export function submitReport(round: Round, value: number, seconds: number): void {
  round.reportedPnl = value;
  round.reportCorrect = value === round.truePnl;
  round.reportSeconds = seconds;
  round.phase = 'SETTLED';
}

export function timeoutReport(round: Round, seconds: number): void {
  round.reportedPnl = null;
  round.reportCorrect = false;
  round.reportSeconds = seconds;
  round.phase = 'SETTLED';
}
