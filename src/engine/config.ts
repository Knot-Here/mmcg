import type { QuoteParams } from './quotes.js';

export type Difficulty = 'easy' | 'medium' | 'hard' | 'custom';

export interface GameConfig {
  seed: string;
  difficulty: Difficulty;
  startingBalance: number;
  cardsMin: number;
  cardsMax: number;
  faceUpMin: number;
  faceUpMax: number;
  decisionSeconds: number;
  reportSeconds: number;
  balanceVisible: boolean;
  depletion: boolean;
  /** Seconds the hand stays face-up before re-hiding; null = stays visible. */
  revealSeconds: number | null;
  /**
   * Whether the reveal prints the realized sum. Off means the player adds the
   * hand up themselves before reporting - which is the point of the drill.
   */
  showRealizedSum: boolean;
  marketEvents: boolean;
  quote: QuoteParams;
  /** Points deducted for a wrong P&L self-report. */
  reportPenalty: number;
  /**
   * 'actual' validates orders against the live balance. 'notional' validates
   * against the starting balance instead - used when the balance is hidden, so
   * that a rejection message cannot leak the number the player is being quizzed on.
   */
  validationMode: 'actual' | 'notional';
  /** Hard cap on units, needed because a risk-free arb has no natural limit. */
  maxUnits: number;
}

const baseQuote: QuoteParams = {
  mispricing: 6,
  minSpread: 2,
  maxSpread: 10,
  howlerProb: 0.1,
  edgeThreshold: 1,
};

export const PRESETS: Record<Exclude<Difficulty, 'custom'>, Omit<GameConfig, 'seed' | 'difficulty'>> = {
  easy: {
    startingBalance: 500,
    cardsMin: 3,
    cardsMax: 3,
    faceUpMin: 1,
    faceUpMax: 2,
    decisionSeconds: 60,
    reportSeconds: 30,
    balanceVisible: true,
    depletion: false,
    revealSeconds: null,
    showRealizedSum: true,
    marketEvents: false,
    quote: { ...baseQuote, mispricing: 6, minSpread: 2, maxSpread: 9 },
    reportPenalty: 10,
    validationMode: 'actual',
    maxUnits: 999,
  },
  medium: {
    startingBalance: 500,
    cardsMin: 3,
    cardsMax: 4,
    faceUpMin: 0,
    faceUpMax: 2,
    decisionSeconds: 30,
    reportSeconds: 30,
    balanceVisible: true,
    depletion: true,
    revealSeconds: 5,
    showRealizedSum: false,
    marketEvents: false,
    quote: { ...baseQuote, mispricing: 8, minSpread: 3, maxSpread: 11 },
    reportPenalty: 10,
    validationMode: 'actual',
    maxUnits: 999,
  },
  hard: {
    startingBalance: 500,
    cardsMin: 5,
    cardsMax: 5,
    faceUpMin: 0,
    faceUpMax: 1,
    decisionSeconds: 15,
    reportSeconds: 20,
    balanceVisible: false,
    depletion: true,
    revealSeconds: 3,
    showRealizedSum: false,
    marketEvents: true,
    quote: { ...baseQuote, mispricing: 10, minSpread: 4, maxSpread: 14 },
    reportPenalty: 10,
    validationMode: 'notional',
    maxUnits: 999,
  },
};

export function makeConfig(difficulty: Exclude<Difficulty, 'custom'>, seed: string): GameConfig {
  return { ...PRESETS[difficulty], seed, difficulty };
}
