# market maker card game

A terminal drill for market *taking*: the computer quotes a two-sided market on
the sum of a hand of cards, you decide buy / sell / skip and a size, then you
report your own P&L from memory and the game marks it.

```
npm install
npm start                  # menu
npm start -- --difficulty hard --seed abc
npm run build && node dist/mm.js
```

`npm link` puts it on your PATH as `mm`.

## Keys

| phase    | keys |
|----------|------|
| decision | `b` arm buy · `s` arm sell · `enter` send · `k`/`space` skip · digits set size · `backspace` edit |
| reveal   | `enter` continue (only when the hand stays up) |
| report   | digits and `-` type the P&L · `enter` submit |
| verdict  | `enter` next round · `q` end session |
| settings | arrows or `hjkl` move and change · `1`/`2`/`3` load a preset · `enter` play · `esc` back |

Arming the direction before `enter` is deliberate: one stray keypress should
not send a trade.

## Difficulty

|                 | easy | medium | hard |
|-----------------|------|--------|------|
| cards           | 3    | 3-4    | 5    |
| face-up         | 1-2  | 0-2    | 0-1  |
| decision timer  | 60s  | 30s    | 15s  |
| balance         | shown | shown | blind, quizzed at the end |
| deck depletion  | off  | on     | on   |
| reveal          | stays up | 5s flash | 3s flash |
| sum on reveal   | shown | you add it up | you add it up |
| market events   | off  | off    | on   |

Press `c` at the menu for the settings screen, which exposes every knob above
plus the quote generator: mispricing `S`, spread range, howler chance, edge
threshold, starting balance, report penalty and max units.

**Sum on reveal** is worth calling out. With it off, flipping the cards does not
print the total - you add the hand up yourself before reporting the P&L, which
is how the interview version works. On medium and hard the cards also re-hide
after the flash, so you are adding from memory.

## Scoring

Two scores, deliberately separated:

- **P&L** — what you actually made. Luck-contaminated.
- **Decision score** — one point per round for matching the engine's optimal
  action, whatever the outcome. Selling a +5 edge and losing 30 still scores.

Plus **EV captured** (what fraction of the available edge you took),
**reporting accuracy** and mean report time, and sizing flags for going small
on a fat edge or maxing out on a thin one. The summary prints realized P&L
against expected P&L so luck is visible as its own line.

Sessions append to `$XDG_DATA_HOME/mm-game/stats.json`
(`~/.local/share/mm-game/stats.json`).

## Layout

```
src/engine/    pure, no I/O, deterministic given a seed
  rng.ts       seeded PRNG
  deck.ts      deck, shoe, depletion pool, discard tray
  valuation.ts fair value, min/max possible sum, hidden-sum std
  quotes.ts    quote generation, edge and optimal-action labelling
  round.ts     round state machine and market events
  scoring.ts   P&L, order validity, decision score, session stats
  session.ts   ties the above together and owns the balance
src/ui/        ink components
tools/         calibrate.ts - measures the tradeable-round rate
test/          51 tests: spec fixtures, engine, state machine
```

`npm test`, `npm run typecheck`, `npm run calibrate -- --sweep`.

## Notes on the spec

Places where the implementation departs from the written spec, and why:

1. **Howlers are built by construction.** The suggested recipe (skew of
   ±0.5-1.0 × fair value) does not reliably push the ask below the minimum
   possible sum, so it would not guarantee an arbitrage. Instead the ask is
   placed strictly below the floor, or the bid strictly above the ceiling. A
   test asserts every howler is a genuine arb.
2. **Blind mode validates against the starting notional, not the live
   balance.** Otherwise "insufficient balance to cover max loss" leaks the
   number the player is being quizzed on at the end.
3. **EV-captured uses the starting notional in its denominator.** Measuring
   available EV against the live balance would make the supposedly luck-free
   stat depend on P&L.
4. **Skipped rounds are not put through the report prompt.** The answer is
   always zero; report accuracy counts traded rounds only.
5. **With depletion off, a hidden card is worth exactly 8** and spans [2,14].
   This ignores the small effect of the face-up cards in the same hand - a
   J and Q showing really do pull the conditional mean to 7.86 - but it is the
   model the drill teaches and it is what the spec's worked examples assume.
   With depletion on, the pool is every unseen card and the conditioning is exact.
6. **Mispricing `S` was measured, not guessed.** `tools/calibrate.ts` sweeps `S`
   against each difficulty's spread range; `S` = 6 / 8 / 10 puts all three
   presets at ~51% tradeable rounds, inside the 40-60% target band. A test
   holds the band.

Not built (spec §10, post-MVP): market-making mode where the player posts the
quote, multi-asset rounds, CSV export, Elo difficulty adjustment, and the
report-only speed drill.
