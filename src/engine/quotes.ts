import type { Rng } from './rng.js';
import type { Valuation } from './valuation.js';

export type Action = 'buy' | 'sell' | 'skip';

export interface Quote {
  bid: number;
  ask: number;
}

export interface QuoteParams {
  /** Mispricing magnitude S: skew ~ U(-S, +S). */
  mispricing: number;
  minSpread: number;
  maxSpread: number;
  /** Probability of an arbitrage-grade quote. */
  howlerProb: number;
  /** |edge| at or above this counts as a tradeable round. */
  edgeThreshold: number;
}

export interface RoundQuote {
  quote: Quote;
  howler: boolean;
  edge: number;
  optimalAction: Action;
}

/**
 * Howlers are built by construction rather than by the large-skew recipe: a
 * skew proportional to fair value does not reliably push the ask below the
 * minimum possible sum, so it would not guarantee a real arbitrage.
 */
function howlerQuote(v: Valuation, spread: number, rng: Rng): Quote {
  const gap = rng.int(1, 3);
  const coin = rng.chance(0.5);
  // A buy-side arb needs room for an ask strictly below the floor and above zero.
  const canBuyArb = v.minPossibleSum >= 3;
  if (canBuyArb && coin) {
    // Ask below the floor: buying cannot lose.
    const ask = Math.max(2, v.minPossibleSum - gap);
    return { bid: Math.max(1, ask - spread), ask };
  }
  // Bid above the ceiling: selling cannot lose.
  const bid = v.maxPossibleSum + gap;
  return { bid, ask: bid + spread };
}

export function generateQuote(v: Valuation, params: QuoteParams, rng: Rng): RoundQuote {
  const spread = rng.int(params.minSpread, params.maxSpread);
  let quote: Quote;
  let howler = false;

  if (rng.chance(params.howlerProb)) {
    quote = howlerQuote(v, spread, rng);
    howler = true;
  } else {
    const mid = v.fairValue + rng.float(-params.mispricing, params.mispricing);
    quote = { bid: Math.round(mid - spread / 2), ask: Math.round(mid + spread / 2) };
  }

  // Clamp: prices are positive and the book is never crossed or locked.
  quote.bid = Math.max(1, quote.bid);
  if (quote.ask <= quote.bid) quote.ask = quote.bid + 1;

  return { quote, howler, ...labelQuote(v.fairValue, quote, params.edgeThreshold) };
}

/** Edge per unit of the best available action, and what that action is. */
export function labelQuote(
  fairValue: number,
  quote: Quote,
  edgeThreshold: number,
  feePerUnit = 0,
): { edge: number; optimalAction: Action } {
  const buyEdge = fairValue - quote.ask - feePerUnit;
  const sellEdge = quote.bid - fairValue - feePerUnit;
  const edge = Math.max(buyEdge, sellEdge, 0);
  if (edge < edgeThreshold) return { edge, optimalAction: 'skip' };
  return { edge, optimalAction: buyEdge >= sellEdge ? 'buy' : 'sell' };
}
