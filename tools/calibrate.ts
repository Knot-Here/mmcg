/**
 * Measures what fraction of rounds are genuinely tradeable for a given set of
 * quote params. The target band is 40-60%; below it the game feels like an
 * endless skip, above it every round is a freebie.
 */
import { PRESETS, makeConfig, type Difficulty } from '../src/engine/config.js';
import { Session } from '../src/engine/session.js';

const N = 20000;

function measure(diff: Exclude<Difficulty, 'custom'>, mispricing?: number) {
  const cfg = makeConfig(diff, `cal-${diff}-${mispricing ?? 'base'}`);
  if (mispricing !== undefined) cfg.quote = { ...cfg.quote, mispricing };
  const s = new Session(cfg);
  let tradeable = 0;
  let howler = 0;
  let edgeSum = 0;
  let spreadSum = 0;
  for (let i = 0; i < N; i++) {
    const r = s.nextRound();
    if (r.optimalAction !== 'skip') tradeable++;
    if (r.howler) howler++;
    edgeSum += r.edge;
    spreadSum += r.quote.ask - r.quote.bid;
    s.shoe.discard(r.cards);
  }
  return {
    tradeablePct: (tradeable / N) * 100,
    howlerPct: (howler / N) * 100,
    meanEdge: edgeSum / N,
    meanSpread: spreadSum / N,
  };
}

const diffs: Exclude<Difficulty, 'custom'>[] = ['easy', 'medium', 'hard'];
const sweep = process.argv.includes('--sweep');

for (const d of diffs) {
  if (sweep) {
    console.log(`\n${d}  (spread ${PRESETS[d].quote.minSpread}-${PRESETS[d].quote.maxSpread})`);
    for (const S of [4, 5, 6, 7, 8, 9, 10, 11, 12]) {
      const m = measure(d, S);
      const flag = m.tradeablePct >= 40 && m.tradeablePct <= 60 ? ' <-- in band' : '';
      console.log(
        `  S=${String(S).padStart(2)}  tradeable ${m.tradeablePct.toFixed(1)}%  ` +
          `meanEdge ${m.meanEdge.toFixed(2)}  meanSpread ${m.meanSpread.toFixed(1)}${flag}`,
      );
    }
  } else {
    const m = measure(d);
    console.log(
      `${d.padEnd(7)} S=${PRESETS[d].quote.mispricing}  tradeable ${m.tradeablePct.toFixed(1)}%  ` +
        `howler ${m.howlerPct.toFixed(1)}%  meanEdge ${m.meanEdge.toFixed(2)}  ` +
        `meanSpread ${m.meanSpread.toFixed(1)}`,
    );
  }
}
