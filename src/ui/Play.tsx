import React, { useEffect, useRef, useState } from 'react';
import { Box, Text } from 'ink';
import { useKeys, type KeyFlags } from './keys.js';
import { Hand, DiscardTray } from './Cards.js';
import { bar, useCountdown } from './useCountdown.js';
import { Session } from '../engine/session.js';
import { describeEvent, fireEvent, type Round } from '../engine/round.js';
import { rankLabel } from '../engine/deck.js';
import type { RoundRecord, SessionStats } from '../engine/scoring.js';

type UiPhase = 'decision' | 'reveal' | 'report' | 'verdict';

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));
const signed = (n: number) => (n > 0 ? `+${fmt(n)}` : fmt(n));

function fairBreakdown(r: Round): string {
  const v = r.valuation;
  const ups = r.cards.filter((_, i) => r.faceUpMask[i]).map((c) => rankLabel(c.rank));
  const parts: string[] = [];
  if (ups.length) parts.push(ups.join(' + '));
  if (v.hiddenCount) parts.push(`${v.hiddenCount} x ${fmt(v.hiddenMean)}`);
  return `${fmt(v.fairValue)} = ${parts.join(' + ')}`;
}

function pnlArithmetic(rec: RoundRecord): string {
  if (rec.playerAction === 'skip') return 'skipped, 0';
  const { quote, realizedSum, units, feePerUnit } = rec;
  const core =
    rec.playerAction === 'buy'
      ? `(${realizedSum} - ${quote.ask}) x ${units}`
      : `(${quote.bid} - ${realizedSum}) x ${units}`;
  const gross =
    rec.playerAction === 'buy'
      ? (realizedSum - quote.ask) * units
      : (quote.bid - realizedSum) * units;
  return feePerUnit
    ? `${core} - ${feePerUnit} x ${units} fee = ${signed(gross - feePerUnit * units)}`
    : `${core} = ${signed(gross)}`;
}

export function Play({ session, onEnd }: { session: Session; onEnd: () => void }) {
  const cfg = session.cfg;
  const [round, setRound] = useState<Round>(() => session.nextRound());
  const [phase, setPhase] = useState<UiPhase>('decision');
  const [size, setSize] = useState('');
  const [armed, setArmed] = useState<'buy' | 'sell' | null>(null);
  const [report, setReport] = useState('');
  // Terminals can deliver several keystrokes in one chunk. Mirroring the text
  // buffers into refs keeps a same-chunk Enter from reading a stale value.
  const sizeRef = useRef('');
  const reportRef = useRef('');
  const armedRef = useRef<'buy' | 'sell' | null>(null);
  const phaseRef = useRef<UiPhase>('decision');
  phaseRef.current = phase;
  const putSize = (v: string) => {
    sizeRef.current = v;
    setSize(v);
  };
  const putReport = (v: string) => {
    reportRef.current = v;
    setReport(v);
  };
  const putArmed = (v: 'buy' | 'sell' | null) => {
    armedRef.current = v;
    setArmed(v);
  };
  const [error, setError] = useState<string | null>(null);
  const [record, setRecord] = useState<RoundRecord | null>(null);
  const [reHidden, setReHidden] = useState(false);
  const [, setTick] = useState(0);

  const key = `${round.index}:${phase}`;
  const bump = () => setTick((t) => t + 1);

  const settle = (r: Round) => {
    const rec = session.settle(r);
    setRecord(rec);
    setReHidden(false);
    setPhase('verdict');
  };

  const leaveDecision = () => {
    setPhase('reveal');
    setReHidden(false);
  };

  const afterReveal = () => {
    if (round.action === 'skip') {
      settle(round);
    } else {
      if (cfg.revealSeconds !== null) setReHidden(true);
      session.toReport(round);
      setPhase('report');
    }
  };

  const nextRound = () => {
    if (session.bust) return onEnd();
    setRound(session.nextRound());
    setPhase('decision');
    phaseRef.current = 'decision';
    putSize('');
    putArmed(null);
    putReport('');
    setError(null);
    setRecord(null);
    setReHidden(false);
  };

  const decision = useCountdown(cfg.decisionSeconds, phase === 'decision', key, () => {
    session.skip(round, true);
    leaveDecision();
  });
  useCountdown(cfg.revealSeconds, phase === 'reveal' && cfg.revealSeconds !== null, key, afterReveal);
  const reportClock = useCountdown(cfg.reportSeconds, phase === 'report', key, () => {
    session.reportTimeout(round, cfg.reportSeconds);
    settle(round);
  });

  // Timed market events fire against the decision clock.
  useEffect(() => {
    if (phase !== 'decision') return;
    const e = round.event;
    if (!e || round.eventFired) return;
    if ('atSecond' in e && decision.elapsed >= e.atSecond) {
      if (fireEvent(round, cfg)) bump();
    }
  }, [decision.elapsed, phase]);

  const units = Number.parseInt(size || '1', 10);
  const maxBuy = session.maxUnitsFor(round, 'buy');
  const maxSell = session.maxUnitsFor(round, 'sell');

  const handleKey = (input: string, k: KeyFlags) => {
    const phaseNow = phaseRef.current;

    if (phaseNow === 'decision') {
      if (/^[0-9]$/.test(input)) return putSize((sizeRef.current + input).slice(0, 4));
      if (k.backspace) return putSize(sizeRef.current.slice(0, -1));
      if (input === 'b') return putArmed('buy');
      if (input === 's') return putArmed('sell');
      if (input === 'k' || input === ' ') {
        session.skip(round);
        phaseRef.current = 'reveal';
        return leaveDecision();
      }
      if (k.return && armedRef.current) {
        const dir = armedRef.current;
        const n = Number.parseInt(sizeRef.current || '1', 10);
        const res = session.tryPlace(round, dir, n);
        if (!res.ok) return setError(res.reason);
        setError(null);
        phaseRef.current = 'reveal';
        return leaveDecision();
      }
      return;
    }

    if (phaseNow === 'reveal') {
      if (cfg.revealSeconds === null && (k.return || input === ' ')) {
        phaseRef.current = round.action === 'skip' ? 'verdict' : 'report';
        afterReveal();
      }
      return;
    }

    if (phaseNow === 'report') {
      if (/^[0-9]$/.test(input)) return putReport((reportRef.current + input).slice(0, 8));
      if (input === '-') {
        const cur = reportRef.current;
        return putReport(cur.startsWith('-') ? cur.slice(1) : '-' + cur);
      }
      if (k.backspace) return putReport(reportRef.current.slice(0, -1));
      if (k.return) {
        const raw = reportRef.current;
        const val = Number.parseInt(raw === '' || raw === '-' ? 'NaN' : raw, 10);
        if (Number.isNaN(val)) return setError('Enter a number.');
        setError(null);
        session.report(round, val, reportClock.elapsed);
        phaseRef.current = 'verdict';
        settle(round);
      }
      return;
    }

    if (phaseNow === 'verdict') {
      if (input === 'q') return onEnd();
      if (k.return || input === ' ') {
        phaseRef.current = 'decision';
        nextRound();
      }
    }
  };

  useKeys(handleKey);

  const stats = session.stats;
  const showBalance = cfg.balanceVisible;
  const allFaceUp = round.cards.map(() => true);
  const faceMask = phase === 'decision' || reHidden ? round.faceUpMask : allFaceUp;

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box justifyContent="space-between">
        <Text>
          {showBalance ? (
            <>
              <Text dimColor>P&L </Text>
              <Text color={stats.pnl >= 0 ? 'green' : 'red'} bold>
                {signed(stats.pnl)}
              </Text>
            </>
          ) : (
            <Text dimColor>P&L hidden</Text>
          )}
          <Text dimColor>  ·  decisions </Text>
          <Text bold>
            {stats.decisionScore}/{stats.rounds}
          </Text>
        </Text>
        <Text>
          {phase === 'decision' && decision.remaining !== null && (
            <Text color={decision.remaining <= 5 ? 'red' : 'yellow'}>
              {bar(decision.remaining, cfg.decisionSeconds)} {decision.remaining}s
            </Text>
          )}
          {phase === 'report' && reportClock.remaining !== null && (
            <Text color={reportClock.remaining <= 5 ? 'red' : 'yellow'}>
              {bar(reportClock.remaining, cfg.reportSeconds)} {reportClock.remaining}s
            </Text>
          )}
        </Text>
      </Box>

      <Box justifyContent="space-between">
        <Text dimColor>
          Round {round.index}
          {round.reshuffled ? '  (reshuffled)' : ''}
        </Text>
        {cfg.depletion && <Text dimColor>shoe {session.shoe.remainingCount}</Text>}
      </Box>

      <Box marginY={1}>
        <Hand cards={round.cards} faceUpMask={faceMask} />
      </Box>

      {cfg.depletion && (
        <Box marginBottom={1}>
          <DiscardTray seen={session.shoe.seen} />
        </Box>
      )}

      {round.quotePulled ? (
        <Text color="red">The quote has been pulled.</Text>
      ) : (
        <Text>
          The market maker quotes <Text bold color="red">{round.quote.bid}</Text> at{' '}
          <Text bold color="green">{round.quote.ask}</Text>.
        </Text>
      )}
      {round.event && round.eventFired && (
        <Text color="magenta">! {describeEvent(round.event)}</Text>
      )}

      {phase === 'decision' && (
        <Box flexDirection="column" marginTop={1}>
          <Text>
            Size <Text bold color="cyan">{size || '1'}</Text>
            <Text dimColor>   max buy {maxBuy} · max sell {maxSell}</Text>
          </Text>
          <Text>
            {armed ? (
              <Text color={armed === 'buy' ? 'green' : 'red'} bold>
                {armed.toUpperCase()} {units} armed - enter to send
              </Text>
            ) : (
              <Text dimColor>b buy · s sell · k/space skip · digits size · enter send</Text>
            )}
          </Text>
        </Box>
      )}

      {phase === 'reveal' && (
        <Box flexDirection="column" marginTop={1}>
          <Text>
            {cfg.showRealizedSum ? (
              <>
                Sum <Text bold>{round.realizedSum}</Text>
              </>
            ) : (
              <Text dimColor>Cards up{round.action === 'skip' ? '' : ' - add them yourself'}</Text>
            )}
            {round.action !== 'skip' && (
              <Text dimColor>
                {'  '}you {round.action} {round.units}
              </Text>
            )}
          </Text>
          {cfg.revealSeconds === null && <Text dimColor>enter to continue</Text>}
        </Box>
      )}

      {phase === 'report' && (
        <Box flexDirection="column" marginTop={1}>
          <Text>
            You {round.action === 'buy' ? 'bought' : 'sold'} {round.units} at{' '}
            {round.action === 'buy' ? round.quote.ask : round.quote.bid}.
          </Text>
          <Text>
            What was your P&L this round? <Text bold color="cyan">{report || '_'}</Text>
          </Text>
          {reHidden && <Text dimColor>(cards re-hidden - from memory)</Text>}
        </Box>
      )}

      {phase === 'verdict' && record && (
        <Verdict
          record={record}
          round={round}
          stats={stats}
          penalty={cfg.reportPenalty}
          showBalance={showBalance}
        />
      )}

      {error && <Text color="red">{error}</Text>}

      {showBalance && (
        <Text dimColor>
          Balance {session.balance}
        </Text>
      )}
    </Box>
  );
}

function Verdict({
  record,
  round,
  stats,
  penalty,
  showBalance,
}: {
  record: RoundRecord;
  round: Round;
  stats: SessionStats;
  penalty: number;
  showBalance: boolean;
}) {
  const good = record.decisionPoint === 1;
  return (
    <Box flexDirection="column" marginTop={1} borderStyle="round" paddingX={1} borderColor={good ? 'green' : 'yellow'}>
      {record.playerAction !== 'skip' && (
        <Text>
          {record.reportCorrect ? (
            <Text color="green">Report correct.</Text>
          ) : (
            <Text color="red">
              Report wrong{record.reportedPnl === null ? ' (timed out)' : ` (you said ${signed(record.reportedPnl)})`}
              , -{penalty} penalty.
            </Text>
          )}
          <Text> {pnlArithmetic(record)}</Text>
        </Text>
      )}
      <Text>
        <Text dimColor>Fair </Text>
        {fairBreakdown(round)}
        <Text dimColor>  ·  sum </Text>
        {record.realizedSum}
      </Text>
      <Text>
        <Text dimColor>Optimal </Text>
        <Text bold color={record.optimalAction === 'skip' ? 'gray' : record.optimalAction === 'buy' ? 'green' : 'red'}>
          {record.optimalAction}
        </Text>
        {record.optimalAction !== 'skip' && <Text> at {signed(record.edge)}/unit</Text>}
        {record.howler && <Text color="magenta"> (arbitrage!)</Text>}
        <Text dimColor>  ·  you </Text>
        <Text bold>{record.playerAction}</Text>
        {record.playerAction !== 'skip' && record.units > 0 && (
          <Text color={record.evTaken >= 0 ? 'green' : 'red'}>
            {' '}
            at {signed(record.evTaken / record.units)}/unit
          </Text>
        )}
        <Text dimColor>  ·  </Text>
        {good ? <Text color="green">+1</Text> : <Text color="red">+0</Text>}
      </Text>
      {record.sizingFlag && (
        <Text color="yellow">
          {record.sizingFlag === 'undersized'
            ? `Undersized: ${signed(record.edge)}/unit and you took ${record.units}.`
            : `Oversized: only ${signed(record.edge)}/unit at that size.`}
        </Text>
      )}
      <Text dimColor>
        decisions {stats.decisionScore}/{stats.rounds} ({stats.decisionPct.toFixed(0)}%)
        {showBalance ? ` · balance ${stats.balance}` : ''} · enter next · q end
      </Text>
    </Box>
  );
}
