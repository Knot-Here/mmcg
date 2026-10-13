/** The seven worked examples from the spec, as executable fixtures. */
import { describe, expect, it } from 'vitest';
import { labelQuote } from '../src/engine/quotes.js';
import { valueHand } from '../src/engine/valuation.js';
import {
  computePnl,
  maxAffordableUnits,
  scoreDecision,
  signedEvPerUnit,
  sizingFlag,
  type OrderContext,
} from '../src/engine/scoring.js';

const T = 1; // edge threshold

function ctx(quote: { bid: number; ask: number }, v: ReturnType<typeof valueHand>, balance = 500): OrderContext {
  return { quote, valuation: v, balance, feePerUnit: 0, sizeLimit: null, maxUnits: 999 };
}

describe('worked examples', () => {
  it('1. three hidden, 20 at 24 -> fair 24, skip', () => {
    const v = valueHand([], 3, null);
    expect(v.fairValue).toBe(24);
    const { edge, optimalAction } = labelQuote(v.fairValue, { bid: 20, ask: 24 }, T);
    expect(optimalAction).toBe('skip');
    expect(edge).toBe(0);
  });

  it('2. three hidden, 16 at 20 -> buy edge 4, max 25 units on 500', () => {
    const v = valueHand([], 3, null);
    const quote = { bid: 16, ask: 20 };
    const { edge, optimalAction } = labelQuote(v.fairValue, quote, T);
    expect(optimalAction).toBe('buy');
    expect(edge).toBe(4);
    expect(maxAffordableUnits('buy', ctx(quote, v))).toBe(25);
  });

  it('3. face-up 7 + two hidden, 28 at 37 -> sell edge 5; good decision, bad outcome', () => {
    const v = valueHand([7], 2, null);
    expect(v.fairValue).toBe(23);
    expect(v.maxPossibleSum).toBe(35);
    const quote = { bid: 28, ask: 37 };
    const { edge, optimalAction } = labelQuote(v.fairValue, quote, T);
    expect(optimalAction).toBe('sell');
    expect(edge).toBe(5);
    // Buying can never profit: the ask sits above the highest possible sum.
    expect(quote.ask).toBeGreaterThan(v.maxPossibleSum);
    expect(computePnl('sell', 10, quote, 31)).toBe(-30);
    expect(scoreDecision(optimalAction, 'sell')).toBe(1);
  });

  it('4. face-up J,Q + one hidden, 11 at 25 -> risk-free buy, realized 25 pays 0', () => {
    const v = valueHand([11, 12], 1, null);
    expect(v.fairValue).toBe(31);
    expect(v.minPossibleSum).toBe(25);
    const quote = { bid: 11, ask: 25 };
    const { optimalAction } = labelQuote(v.fairValue, quote, T);
    expect(optimalAction).toBe('buy');
    expect(quote.ask).toBeLessThanOrEqual(v.minPossibleSum); // worst case is zero
    expect(computePnl('buy', 20, quote, 25)).toBe(0);
  });

  it('5. face-up 3 + two hidden, 26 at 37 -> sell edge 7; buying scores zero', () => {
    const v = valueHand([3], 2, null);
    expect(v.fairValue).toBe(19);
    expect(v.maxPossibleSum).toBe(31);
    const quote = { bid: 26, ask: 37 };
    const { edge, optimalAction } = labelQuote(v.fairValue, quote, T);
    expect(optimalAction).toBe('sell');
    expect(edge).toBe(7);
    expect(scoreDecision(optimalAction, 'buy')).toBe(0);
  });

  it('6. two cards, face-up 8, 5 at 15 -> thin buy; max size is flagged', () => {
    const v = valueHand([8], 1, null);
    expect(v.fairValue).toBe(16);
    expect(v.minPossibleSum).toBe(10);
    const quote = { bid: 5, ask: 15 };
    const { edge, optimalAction } = labelQuote(v.fairValue, quote, T);
    expect(optimalAction).toBe('buy');
    expect(edge).toBe(1);
    expect(computePnl('buy', 1, quote, 10)).toBe(-5); // worst case per unit
    const max = maxAffordableUnits('buy', ctx(quote, v));
    expect(sizingFlag('buy', 'buy', max, edge, max)).toBe('oversized');
    expect(sizingFlag('buy', 'buy', 1, edge, max)).toBe(null);
  });

  it('7. three hidden, 4 at 8 -> buy edge 16, near-max size', () => {
    const v = valueHand([], 3, null);
    const quote = { bid: 4, ask: 8 };
    const { edge, optimalAction } = labelQuote(v.fairValue, quote, T);
    expect(optimalAction).toBe('buy');
    expect(edge).toBe(16);
    expect(quote.ask).toBeGreaterThan(v.minPossibleSum); // not a free arb, just very cheap
    const max = maxAffordableUnits('buy', ctx(quote, v));
    expect(sizingFlag('buy', 'buy', 1, edge, max)).toBe('undersized');
  });
});

describe('regression: wrong-way trade into an arbitrage', () => {
  // Observed in play: face-up 7 and 4, one hidden 3, quote 26 at 28.
  // The bid sat above the highest attainable sum, so selling was free money;
  // the player bought instead, and the sizing hint told them to buy more.
  it('scores the direction and stays quiet about size', () => {
    const v = valueHand([7, 4], 1, null);
    expect(v.fairValue).toBe(19);
    expect(v.maxPossibleSum).toBe(25);

    const quote = { bid: 26, ask: 28 };
    const { edge, optimalAction } = labelQuote(v.fairValue, quote, T);
    expect(optimalAction).toBe('sell');
    expect(edge).toBe(7);
    expect(quote.bid).toBeGreaterThan(v.maxPossibleSum); // a genuine arb

    expect(computePnl('buy', 1, quote, 14)).toBe(-14);
    expect(scoreDecision(optimalAction, 'buy')).toBe(0);

    // Buying was -9/unit: sizing advice on it would be advice to lose more.
    expect(signedEvPerUnit('buy', quote, v.fairValue)).toBe(-9);
    expect(sizingFlag('buy', optimalAction, 1, edge, 11)).toBe(null);
    // The same small size in the right direction is genuinely undersized.
    expect(sizingFlag('sell', optimalAction, 1, edge, 999)).toBe('undersized');
  });
});
