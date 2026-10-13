import { FRESH_MAX, FRESH_MEAN, FRESH_MIN, FRESH_VARIANCE, mean, populationVariance, sumExtreme } from './deck.js';

export interface Valuation {
  faceUpSum: number;
  hiddenCount: number;
  /** Expected value of one hidden card given everything public. */
  hiddenMean: number;
  fairValue: number;
  minPossibleSum: number;
  maxPossibleSum: number;
  /** Std dev of the hidden sum, for sizing feedback. */
  hiddenStd: number;
}

/**
 * Fair value from public information only.
 *
 * Depletion off: a hidden card is worth exactly 8 and spans [2,14]. This is the
 * naive model the drill is teaching, and matches the spec fixtures - note it
 * ignores the small within-hand effect of the face-up cards.
 *
 * Depletion on: the pool is every card the player has not seen (shoe plus this
 * round's face-down cards), so seeing cards genuinely moves the mean.
 */
export function valueHand(
  faceUpValues: number[],
  hiddenCount: number,
  unknownPool: number[] | null,
): Valuation {
  const faceUpSum = faceUpValues.reduce((a, b) => a + b, 0);

  if (unknownPool === null) {
    return {
      faceUpSum,
      hiddenCount,
      hiddenMean: FRESH_MEAN,
      fairValue: faceUpSum + FRESH_MEAN * hiddenCount,
      minPossibleSum: faceUpSum + FRESH_MIN * hiddenCount,
      maxPossibleSum: faceUpSum + FRESH_MAX * hiddenCount,
      hiddenStd: Math.sqrt(FRESH_VARIANCE * hiddenCount),
    };
  }

  const m = mean(unknownPool);
  const N = unknownPool.length;
  // Population variance scaled by the finite-population correction.
  const fpc = N > 1 ? (N - hiddenCount) / (N - 1) : 0;
  const varSum = hiddenCount * populationVariance(unknownPool) * Math.max(fpc, 0);

  return {
    faceUpSum,
    hiddenCount,
    hiddenMean: m,
    fairValue: faceUpSum + m * hiddenCount,
    minPossibleSum: faceUpSum + sumExtreme(unknownPool, hiddenCount, false),
    maxPossibleSum: faceUpSum + sumExtreme(unknownPool, hiddenCount, true),
    hiddenStd: Math.sqrt(varSum),
  };
}
