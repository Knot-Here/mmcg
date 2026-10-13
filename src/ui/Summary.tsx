import React, { useRef, useState } from 'react';
import { Box, Text } from 'ink';
import { useKeys, type KeyFlags } from './keys.js';
import type { Session } from '../engine/session.js';
import { rankLabel } from '../engine/deck.js';
import { saveSession, statsPath } from '../storage.js';

const signed = (n: number) => (n > 0 ? `+${Math.round(n)}` : String(Math.round(n)));

export function Summary({ session, onExit }: { session: Session; onExit: () => void }) {
  const cfg = session.cfg;
  const stats = session.stats;
  // Blind play settles up by quizzing the player before showing anything.
  const [quiz, setQuiz] = useState(!cfg.balanceVisible && stats.rounds > 0);
  const [guess, setGuess] = useState('');
  const [guessed, setGuessed] = useState<number | null>(null);
  const guessRef = useRef('');
  const quizRef = useRef(quiz);
  quizRef.current = quiz;
  const saved = useRef(false);

  const putGuess = (v: string) => {
    guessRef.current = v;
    setGuess(v);
  };

  const finish = (balanceGuess: number | null) => {
    if (saved.current) return;
    saved.current = true;
    saveSession({
      ...stats,
      playedAt: new Date().toISOString(),
      seed: cfg.seed,
      difficulty: cfg.difficulty,
      balanceGuess,
      balanceGuessCorrect: balanceGuess === null ? null : balanceGuess === session.balance,
    });
  };

  const handleKey = (input: string, k: KeyFlags) => {
    if (quizRef.current) {
      if (/^[0-9]$/.test(input)) return putGuess((guessRef.current + input).slice(0, 8));
      if (input === '-') {
        const cur = guessRef.current;
        return putGuess(cur.startsWith('-') ? cur.slice(1) : '-' + cur);
      }
      if (k.backspace) return putGuess(guessRef.current.slice(0, -1));
      if (k.return) {
        const raw = guessRef.current;
        const v = Number.parseInt(raw === '' || raw === '-' ? 'NaN' : raw, 10);
        if (Number.isNaN(v)) return;
        setGuessed(v);
        quizRef.current = false;
        setQuiz(false);
        finish(v);
      }
      return;
    }
    if (k.return || input === 'q') {
      finish(guessed);
      onExit();
    }
  };

  useKeys(handleKey);

  if (quiz) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text bold>Session over.</Text>
        <Text>
          You played blind. What is your balance? <Text bold color="cyan">{guess || '_'}</Text>
        </Text>
        <Text dimColor>enter to submit</Text>
      </Box>
    );
  }

  const rows = session.records.slice(-15);
  const luck = stats.pnl - stats.evTaken;

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold>  session summary  </Text>
      <Text dimColor>
        {cfg.difficulty} · seed {cfg.seed} · {stats.rounds} rounds
      </Text>

      {guessed !== null && (
        <Box marginTop={1}>
          <Text>
            Balance check: you said <Text bold>{guessed}</Text>, actual{' '}
            <Text bold>{session.balance}</Text>{' '}
            {guessed === session.balance ? (
              <Text color="green">correct</Text>
            ) : (
              <Text color="red">off by {Math.abs(session.balance - guessed)}</Text>
            )}
          </Text>
        </Box>
      )}

      <Box flexDirection="column" marginTop={1}>
        <Text>
          <Text dimColor>Decision score  </Text>
          <Text bold>
            {stats.decisionScore}/{stats.rounds}
          </Text>
          <Text dimColor> ({stats.decisionPct.toFixed(0)}%)</Text>
        </Text>
        <Text>
          <Text dimColor>Tradeable       </Text>
          {stats.tradeableTaken}/{stats.tradeableOffered} taken
          {stats.howlersOffered > 0 && (
            <Text dimColor>
              {'  '}· arbs {stats.howlersTaken}/{stats.howlersOffered}
            </Text>
          )}
        </Text>
        <Text>
          <Text dimColor>EV captured     </Text>
          <Text bold>{stats.evCapturedPct.toFixed(0)}%</Text>
          <Text dimColor>
            {'  '}({signed(stats.evTaken)} of {Math.round(stats.evAvailable)} available)
          </Text>
        </Text>
        <Text>
          <Text dimColor>Realized P&L    </Text>
          <Text bold color={stats.pnl >= 0 ? 'green' : 'red'}>
            {signed(stats.pnl)}
          </Text>
          <Text dimColor>  · decisions were worth {signed(stats.evTaken)} in expectation</Text>
        </Text>
        <Text>
          <Text dimColor>Luck            </Text>
          <Text color={luck >= 0 ? 'green' : 'red'}>{signed(luck)}</Text>
        </Text>
        <Text>
          <Text dimColor>Reporting       </Text>
          {stats.reportsTotal === 0 ? (
            <Text dimColor>no trades to report</Text>
          ) : (
            <>
              {stats.reportsCorrect}/{stats.reportsTotal} ({stats.reportPct.toFixed(0)}%)
              <Text dimColor>  · mean {stats.meanReportSeconds.toFixed(1)}s</Text>
            </>
          )}
        </Text>
        {(stats.undersized > 0 || stats.oversized > 0) && (
          <Text>
            <Text dimColor>Sizing          </Text>
            <Text color="yellow">
              {stats.undersized} undersized · {stats.oversized} oversized
            </Text>
          </Text>
        )}
      </Box>

      {rows.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>
            {'  #   '}
            {'hand'.padEnd(26)}
            {'quote'.padEnd(10)}
            {'fair'.padEnd(7)}
            {'opt'.padEnd(6)}
            {'you'.padEnd(6)}
            {'sz'.padEnd(6)}
            {'  p&l  rep'}
          </Text>
          {rows.map((r) => {
            const hand = [
              ...r.faceUp.map((v) => rankLabel(v)),
              ...r.hidden.map((v) => `(${rankLabel(v)})`),
            ].join(' ');
            return (
              <Text key={r.round}>
                {String(r.round).padStart(3)}
                {'   '}
                {hand.padEnd(26).slice(0, 26)}
                {`${r.quote.bid}@${r.quote.ask}`.padEnd(10)}
                {r.fairValue.toFixed(0).padEnd(7)}
                {r.optimalAction.padEnd(6)}
                <Text color={r.decisionPoint ? 'green' : 'red'}>{r.playerAction.padEnd(6)}</Text>
                {String(r.units).padEnd(6)}
                <Text color={r.pnl >= 0 ? 'green' : 'red'}>{signed(r.pnl).padStart(5)}</Text>
                {'  '}
                {r.playerAction === 'skip' ? (
                  <Text dimColor>-</Text>
                ) : r.reportCorrect ? (
                  <Text color="green">y</Text>
                ) : (
                  <Text color="red">n</Text>
                )}
              </Text>
            );
          })}
          <Text dimColor>(parenthesised cards were face-down)</Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor>saved to {statsPath} · enter to quit</Text>
      </Box>
    </Box>
  );
}
