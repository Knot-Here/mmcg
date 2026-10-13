import type { Rng } from './rng.js';

export type Suit = '♠' | '♥' | '♦' | '♣';
export const SUITS: Suit[] = ['♠', '♥', '♦', '♣'];
/** Ranks 2-10 face value, J=11 Q=12 K=13 A=14. */
export const RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14] as const;

export interface Card {
  rank: number;
  suit: Suit;
}

/** Fresh-deck constants. Mean 8, min 2, max 14, per-card variance 14. */
export const FRESH_MEAN = 8;
export const FRESH_MIN = 2;
export const FRESH_MAX = 14;
export const FRESH_VARIANCE = 14;

export function rankLabel(rank: number): string {
  if (rank === 11) return 'J';
  if (rank === 12) return 'Q';
  if (rank === 13) return 'K';
  if (rank === 14) return 'A';
  return String(rank);
}

export function cardLabel(c: Card): string {
  return `${rankLabel(c.rank)}${c.suit}`;
}

export function freshDeck(): Card[] {
  const d: Card[] = [];
  for (const suit of SUITS) for (const rank of RANKS) d.push({ rank, suit });
  return d;
}

/**
 * The shoe. With depletion on it persists across rounds and the unknown pool
 * shrinks as cards are seen; with depletion off it is reshuffled every round,
 * so the player's mental model stays "8 per hidden card".
 */
export class Shoe {
  private remaining: Card[] = [];
  /** Discard tray: cards publicly revealed and out of play. */
  seen: Card[] = [];
  reshuffles = 0;

  constructor(
    private rng: Rng,
    public depletion: boolean,
  ) {
    this.reset();
  }

  reset(): void {
    this.remaining = this.rng.shuffle(freshDeck());
    this.seen = [];
  }

  get remainingCount(): number {
    return this.remaining.length;
  }

  /** Reshuffle if fewer than n cards remain, or every round when depletion is off. */
  prepare(n: number): boolean {
    if (!this.depletion) {
      this.reset();
      return false;
    }
    if (this.remaining.length < n) {
      this.reset();
      this.reshuffles++;
      return true;
    }
    return false;
  }

  deal(n: number): Card[] {
    return this.remaining.splice(0, n);
  }

  /** Return dealt cards to the discard tray once they are public. */
  discard(cards: Card[]): void {
    if (this.depletion) this.seen.push(...cards);
  }

  /**
   * Values of every card the player has not seen: the shoe plus the cards
   * currently face-down in the hand. This is the correct conditional pool
   * for a hidden slot.
   */
  unknownValues(hidden: Card[]): number[] {
    return [...this.remaining, ...hidden].map((c) => c.rank);
  }
}

export function mean(values: number[]): number {
  if (values.length === 0) return FRESH_MEAN;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function populationVariance(values: number[]): number {
  if (values.length === 0) return FRESH_VARIANCE;
  const m = mean(values);
  return values.reduce((a, b) => a + (b - m) ** 2, 0) / values.length;
}

/** Sum of the n largest / smallest values in the pool. */
export function sumExtreme(values: number[], n: number, largest: boolean): number {
  if (n <= 0) return 0;
  const sorted = values.slice().sort((a, b) => (largest ? b - a : a - b));
  return sorted.slice(0, n).reduce((a, b) => a + b, 0);
}
