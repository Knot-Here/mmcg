import { describe, expect, it } from 'vitest';
import { makeConfig, PRESETS } from '../src/engine/config.js';
import { Session } from '../src/engine/session.js';
import { dealRound, fireEvent, describeEvent, relabel } from '../src/engine/round.js';
import { Shoe } from '../src/engine/deck.js';
import { makeRng } from '../src/engine/rng.js';

describe('market events', () => {
  it('a quote shift moves the market and re-labels the edge', () => {
    const cfg = makeConfig('easy', 'shift');
    const s = new Session(cfg);
    const r = s.nextRound();
    const before = { ...r.quote };
    r.event = { kind: 'quote_shift', atSecond: 3, delta: 5 };
    r.eventFired = false;
    expect(fireEvent(r, cfg)).toBe(true);
    expect(r.quote.bid).toBe(before.bid + 5);
    expect(r.quote.ask).toBe(before.ask + 5);
    expect(r.eventFired).toBe(true);
    // A second call is a no-op: an event fires exactly once.
    expect(fireEvent(r, cfg)).toBe(false);
  });

  it('a pulled quote blocks orders', () => {
    const cfg = makeConfig('easy', 'pull');
    const s = new Session(cfg);
    const r = s.nextRound();
    r.event = { kind: 'quote_pulled', atSecond: 2 };
    r.eventFired = false;
    fireEvent(r, cfg);
    expect(r.quotePulled).toBe(true);
    expect(s.tryPlace(r, 'buy', 1).ok).toBe(false);
  });

  it('a fee is charged per unit and can erase a thin edge', () => {
    const cfg = makeConfig('easy', 'fee');
    const s = new Session(cfg);
    const r = s.nextRound();
    r.quote = { bid: 1, ask: Math.round(r.valuation.fairValue) - 1 };
    r.feePerUnit = 0;
    relabel(r, cfg);
    expect(r.optimalAction).toBe('buy');
    r.feePerUnit = 3;
    relabel(r, cfg);
    expect(r.optimalAction).toBe('skip');

    s.tryPlace(r, 'buy', 2);
    const gross = (r.realizedSum - r.quote.ask) * 2;
    expect(r.truePnl).toBe(gross - 6);
  });

  it('size limits and fees only come from events, and are described', () => {
    const cfg = { ...makeConfig('hard', 'ev'), marketEvents: true };
    const shoe = new Shoe(makeRng('ev'), true);
    const rng = makeRng('ev');
    let sawTimed = false;
    let sawStatic = false;
    for (let i = 0; i < 300; i++) {
      const r = dealRound(i, shoe, cfg, rng);
      if (r.event) {
        expect(describeEvent(r.event)).toBeTruthy();
        if ('atSecond' in r.event) {
          sawTimed = true;
          expect(r.eventFired).toBe(false);
          expect(r.event.atSecond).toBeLessThanOrEqual(cfg.decisionSeconds - 3);
        } else {
          sawStatic = true;
          expect(r.eventFired).toBe(true); // applies from the start of the round
        }
      }
      shoe.discard(r.cards);
    }
    expect(sawTimed).toBe(true);
    expect(sawStatic).toBe(true);
  });

  it('no events at all when the setting is off', () => {
    const cfg = makeConfig('easy', 'noev');
    expect(PRESETS.easy.marketEvents).toBe(false);
    const shoe = new Shoe(makeRng('noev'), false);
    const rng = makeRng('noev');
    for (let i = 0; i < 200; i++) {
      const r = dealRound(i, shoe, cfg, rng);
      expect(r.event).toBeNull();
      expect(r.feePerUnit).toBe(0);
      expect(r.sizeLimit).toBeNull();
    }
  });
});

describe('timeouts', () => {
  it('a decision timeout is a forced skip worth zero', () => {
    const s = new Session(makeConfig('hard', 'to1'));
    const r = s.nextRound();
    s.skip(r, true);
    expect(r.timedOutDecision).toBe(true);
    expect(r.action).toBe('skip');
    expect(r.truePnl).toBe(0);
    const rec = s.settle(r);
    expect(rec.pnl).toBe(0);
    expect(s.balance).toBe(500); // a skip never triggers the report penalty
  });

  it('a report timeout counts as an incorrect report', () => {
    const s = new Session(makeConfig('easy', 'to2'));
    const r = s.nextRound();
    s.tryPlace(r, 'buy', 1);
    s.reportTimeout(r, 30);
    expect(r.reportCorrect).toBe(false);
    expect(r.reportedPnl).toBeNull();
    const rec = s.settle(r);
    expect(rec.pnl).toBe(r.truePnl - 10);
  });
});

describe('state machine order', () => {
  it('walks DEAL -> DECIDE -> REVEAL -> REPORT -> SETTLE', () => {
    const s = new Session(makeConfig('easy', 'fsm'));
    const r = s.nextRound();
    expect(r.phase).toBe('AWAITING_DECISION');
    s.tryPlace(r, 'buy', 1);
    expect(r.phase).toBe('REVEALED');
    s.toReport(r);
    expect(r.phase).toBe('AWAITING_REPORT');
    s.report(r, r.truePnl, 4);
    expect(r.phase).toBe('SETTLED');
    expect(r.reportCorrect).toBe(true);
  });

  it('a skip goes straight from reveal to settle', () => {
    const s = new Session(makeConfig('easy', 'fsm2'));
    const r = s.nextRound();
    s.skip(r);
    expect(r.phase).toBe('REVEALED');
    const rec = s.settle(r);
    expect(rec.playerAction).toBe('skip');
    expect(rec.reportSeconds).toBe(0);
  });
});

describe('sizing flag', () => {
  it('is judged against the balance the player had when deciding', () => {
    const s = new Session(makeConfig('easy', 'sizing'));
    const r = s.nextRound();
    // Force a fat buy edge and a size that is exactly 20% of what 500 affords.
    r.quote = { bid: 1, ask: 10 };
    r.feePerUnit = 0;
    relabel(r, s.cfg);
    expect(r.optimalAction).toBe('buy');
    r.realizedSum = 6; // the trade loses 40, dropping the balance to 460
    s.tryPlace(r, 'buy', 10);
    s.report(r, r.truePnl, 1);
    const rec = s.settle(r);
    // 10 of the 50 affordable at decision time is undersized; 10 of 46 after the loss would not be.
    expect(rec.sizingFlag).toBe('undersized');
  });
});
