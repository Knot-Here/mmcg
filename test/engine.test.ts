import { describe, expect, it } from 'vitest';
import { Shoe, freshDeck, mean } from '../src/engine/deck.js';
import { makeRng } from '../src/engine/rng.js';
import { valueHand } from '../src/engine/valuation.js';
import { generateQuote, labelQuote } from '../src/engine/quotes.js';
import { PRESETS, makeConfig } from '../src/engine/config.js';
import { Session } from '../src/engine/session.js';
import { submitReport } from '../src/engine/round.js';
import {
  computePnl,
  maxAffordableUnits,
  scoreDecision,
  validateOrder,
  type OrderContext,
} from '../src/engine/scoring.js';

const DECK_SUM = 4 * (2 + 3 + 4 + 5 + 6 + 7 + 8 + 9 + 10 + 11 + 12 + 13 + 14); // 416

describe('fair value', () => {
  it('fresh deck: 8 per hidden card', () => {
    expect(valueHand([], 3, null).fairValue).toBe(24);
    expect(valueHand([], 5, null).fairValue).toBe(40);
  });

  it('fresh deck with face-ups: face-up sum plus 8 per hidden', () => {
    const v = valueHand([10, 4], 2, null);
    expect(v.fairValue).toBe(30);
    expect(v.minPossibleSum).toBe(18);
    expect(v.maxPossibleSum).toBe(42);
    expect(v.hiddenStd).toBeCloseTo(Math.sqrt(28), 10);
  });

  it('depletion: the hidden mean shifts once cards are seen', () => {
    const shoe = new Shoe(makeRng('deplete'), true);
    const dealt = shoe.deal(4);
    const dealtSum = dealt.reduce((a, c) => a + c.rank, 0);
    const pool = shoe.unknownValues([]);
    expect(pool).toHaveLength(48);
    expect(mean(pool)).toBeCloseTo((DECK_SUM - dealtSum) / 48, 10);
  });

  it('depletion: removing the four aces drags the hidden mean below 8', () => {
    const pool = freshDeck()
      .filter((c) => c.rank !== 14)
      .map((c) => c.rank);
    const v = valueHand([], 1, pool);
    expect(v.hiddenMean).toBeCloseTo((DECK_SUM - 4 * 14) / 48, 10);
    expect(v.hiddenMean).toBeLessThan(8);
    expect(v.maxPossibleSum).toBe(13); // best remaining card is a king
  });

  it('depletion: the unknown pool includes this round face-down cards', () => {
    const shoe = new Shoe(makeRng('pool'), true);
    const cards = shoe.deal(3);
    const hidden = cards.slice(1);
    // 49 left in the shoe plus the 2 still face-down in the hand.
    expect(shoe.unknownValues(hidden)).toHaveLength(51);
  });
});

describe('order validity', () => {
  const v = valueHand([7], 2, null); // fair 23, max 35
  const quote = { bid: 28, ask: 37 };
  const ctx = (balance: number, extra: Partial<OrderContext> = {}): OrderContext => ({
    quote,
    valuation: v,
    balance,
    feePerUnit: 0,
    sizeLimit: null,
    maxUnits: 999,
    ...extra,
  });

  it('short must cover max possible loss, not the notional', () => {
    // risk per unit = maxSum 35 - bid 28 = 7
    expect(maxAffordableUnits('sell', ctx(500))).toBe(71);
    expect(validateOrder('sell', 71, ctx(500)).ok).toBe(true);
    expect(validateOrder('sell', 72, ctx(500)).ok).toBe(false);
  });

  it('short cover uses the true remaining-deck max under depletion', () => {
    const poolNoHighCards = freshDeck()
      .filter((c) => c.rank <= 10)
      .map((c) => c.rank);
    const vd = valueHand([7], 2, poolNoHighCards);
    expect(vd.maxPossibleSum).toBe(27); // 7 + 10 + 10, not 7 + 14 + 14
    // Risk collapses to zero: the bid is above every attainable sum.
    expect(maxAffordableUnits('sell', ctx(500, { valuation: vd }))).toBe(999);
  });

  it('long affordability is units x ask', () => {
    expect(maxAffordableUnits('buy', ctx(500))).toBe(13); // floor(500/37)
    expect(validateOrder('buy', 14, ctx(500)).ok).toBe(false);
  });

  it('rejects non-positive and fractional sizes', () => {
    expect(validateOrder('buy', 0, ctx(500)).ok).toBe(false);
    expect(validateOrder('buy', -3, ctx(500)).ok).toBe(false);
    expect(validateOrder('buy', 2.5, ctx(500)).ok).toBe(false);
  });

  it('honours a size-limit market event', () => {
    const r = validateOrder('buy', 4, ctx(500, { sizeLimit: 3 }));
    expect(r.ok).toBe(false);
    expect(maxAffordableUnits('buy', ctx(500, { sizeLimit: 3 }))).toBe(3);
  });

  it('a fee raises the cost of every unit', () => {
    expect(maxAffordableUnits('buy', ctx(500, { feePerUnit: 3 }))).toBe(12); // floor(500/40)
  });

  it('detects bust', () => {
    const s = new Session(makeConfig('easy', 'bust-seed'));
    s.balance = 0;
    expect(s.bust).toBe(true);
    s.balance = -5;
    expect(s.bust).toBe(true);
  });
});

describe('p&l', () => {
  const quote = { bid: 20, ask: 24 };
  it('buy, sell and skip including negatives', () => {
    expect(computePnl('buy', 3, quote, 30)).toBe(18);
    expect(computePnl('buy', 3, quote, 18)).toBe(-18);
    expect(computePnl('sell', 5, quote, 14)).toBe(30);
    expect(computePnl('sell', 5, quote, 26)).toBe(-30);
    expect(computePnl(null, 0, quote, 26)).toBe(0);
    expect(computePnl('buy', 0, quote, 30)).toBe(0);
  });

  it('subtracts the per-unit fee', () => {
    expect(computePnl('buy', 4, quote, 30, 2)).toBe(24 - 8);
  });

  it('report verification accepts 0 and -0 for a flat round', () => {
    const s = new Session(makeConfig('easy', 'report'));
    const r = s.nextRound();
    r.truePnl = 0;
    submitReport(r, -0, 2);
    expect(r.reportCorrect).toBe(true);
    submitReport(r, 0, 2);
    expect(r.reportCorrect).toBe(true);
    submitReport(r, 1, 2);
    expect(r.reportCorrect).toBe(false);
  });

  it('report verification is exact on negatives', () => {
    const s = new Session(makeConfig('easy', 'report2'));
    const r = s.nextRound();
    r.truePnl = -30;
    submitReport(r, -30, 2);
    expect(r.reportCorrect).toBe(true);
    submitReport(r, 30, 2);
    expect(r.reportCorrect).toBe(false);
  });
});

describe('quote generator', () => {
  const diffs = ['easy', 'medium', 'hard'] as const;

  it.each(diffs)('%s keeps the tradeable rate inside the 40-60%% band', (d) => {
    const s = new Session(makeConfig(d, `band-${d}`));
    let tradeable = 0;
    const N = 5000;
    for (let i = 0; i < N; i++) {
      const r = s.nextRound();
      if (r.optimalAction !== 'skip') tradeable++;
      s.shoe.discard(r.cards);
    }
    const pct = (tradeable / N) * 100;
    expect(pct).toBeGreaterThanOrEqual(40);
    expect(pct).toBeLessThanOrEqual(60);
  });

  it('never crosses or locks the book, and never quotes below 1', () => {
    const rng = makeRng('book');
    for (let i = 0; i < 5000; i++) {
      const v = valueHand([], 3, null);
      const { quote } = generateQuote(v, PRESETS.hard.quote, rng);
      expect(quote.bid).toBeGreaterThanOrEqual(1);
      expect(quote.ask).toBeGreaterThan(quote.bid);
    }
  });

  it('howlers are genuine arbitrage', () => {
    const rng = makeRng('howl');
    const params = { ...PRESETS.hard.quote, howlerProb: 1 };
    for (let i = 0; i < 2000; i++) {
      const v = valueHand(i % 2 ? [9] : [], 3, null);
      const { quote, howler } = generateQuote(v, params, rng);
      expect(howler).toBe(true);
      const arb = quote.ask < v.minPossibleSum || quote.bid > v.maxPossibleSum;
      expect(arb).toBe(true);
    }
  });
});

describe('decision scorer', () => {
  it('a bracketing quote makes skip the optimal action', () => {
    const { optimalAction } = labelQuote(24, { bid: 21, ask: 27 }, 1);
    expect(optimalAction).toBe('skip');
    expect(scoreDecision(optimalAction, 'skip')).toBe(1);
    expect(scoreDecision(optimalAction, 'buy')).toBe(0);
  });

  it('the -3/-1 both-sides-lose case is a skip', () => {
    // buy loses 3 per unit, sell loses 1 per unit
    const { edge, optimalAction } = labelQuote(24, { bid: 23, ask: 27 }, 1);
    expect(edge).toBe(0);
    expect(optimalAction).toBe('skip');
    expect(scoreDecision(optimalAction, 'skip')).toBe(1);
  });

  it('correct direction on a real edge scores a point', () => {
    const buy = labelQuote(24, { bid: 12, ask: 18 }, 1);
    expect(buy.optimalAction).toBe('buy');
    expect(scoreDecision(buy.optimalAction, 'buy')).toBe(1);
    const sell = labelQuote(24, { bid: 30, ask: 36 }, 1);
    expect(sell.optimalAction).toBe('sell');
    expect(scoreDecision(sell.optimalAction, 'sell')).toBe(1);
  });

  it('an edge below threshold is not worth taking', () => {
    const { edge, optimalAction } = labelQuote(24, { bid: 10, ask: 23.5 }, 1);
    expect(edge).toBeCloseTo(0.5, 10);
    expect(optimalAction).toBe('skip');
  });

  it('a fee can turn a thin edge into a skip', () => {
    expect(labelQuote(24, { bid: 5, ask: 23 }, 1).optimalAction).toBe('buy');
    expect(labelQuote(24, { bid: 5, ask: 23 }, 1, 2).optimalAction).toBe('skip');
  });
});

describe('shoe', () => {
  it('reshuffles when it cannot cover the next hand', () => {
    const shoe = new Shoe(makeRng('exhaust'), true);
    let reshuffled = false;
    for (let i = 0; i < 12; i++) {
      reshuffled = shoe.prepare(5) || reshuffled;
      const cards = shoe.deal(5);
      shoe.discard(cards);
    }
    expect(reshuffled).toBe(true);
    expect(shoe.reshuffles).toBeGreaterThanOrEqual(1);
    expect(shoe.remainingCount).toBeGreaterThanOrEqual(5);
  });

  it('resets every round when depletion is off', () => {
    const shoe = new Shoe(makeRng('fresh'), false);
    shoe.prepare(3);
    shoe.deal(3);
    shoe.discard(shoe.deal(3));
    shoe.prepare(3);
    expect(shoe.remainingCount).toBe(52);
    expect(shoe.seen).toHaveLength(0);
  });

  it('the discard tray only grows under depletion', () => {
    const shoe = new Shoe(makeRng('tray'), true);
    shoe.prepare(3);
    shoe.discard(shoe.deal(3));
    expect(shoe.seen).toHaveLength(3);
  });
});

describe('session', () => {
  it('is deterministic for a given seed', () => {
    const play = () => {
      const s = new Session(makeConfig('medium', 'fixed-seed'));
      const out: number[] = [];
      for (let i = 0; i < 20; i++) {
        const r = s.nextRound();
        out.push(r.realizedSum, r.quote.bid, r.quote.ask);
        s.skip(r);
        s.settle(r);
      }
      return out;
    };
    expect(play()).toEqual(play());
  });

  it('applies p&l and the report penalty to the balance', () => {
    const s = new Session(makeConfig('easy', 'settle'));
    const r = s.nextRound();
    s.tryPlace(r, 'buy', 1);
    const expected = r.truePnl;
    s.report(r, expected + 1, 3); // wrong report
    s.settle(r);
    expect(s.balance).toBe(500 + expected - 10);
    expect(s.records[0]!.reportCorrect).toBe(false);
  });

  it('hidden-balance mode validates against the starting notional', () => {
    const s = new Session(makeConfig('hard', 'hidden'));
    s.balance = 1; // nearly bust
    const r = s.nextRound();
    // Sizing is still judged against 500, so the rejection cannot leak the balance.
    expect(s.maxUnitsFor(r, 'buy')).toBe(
      Math.min(999, Math.floor(500 / (r.quote.ask + r.feePerUnit))),
    );
  });

  it('refuses orders once the quote is pulled', () => {
    const s = new Session(makeConfig('easy', 'pulled'));
    const r = s.nextRound();
    r.quotePulled = true;
    expect(s.tryPlace(r, 'buy', 1).ok).toBe(false);
  });
});
