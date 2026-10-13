import React from 'react';
import { Box, Text } from 'ink';
import { useKeys } from './keys.js';
import type { Difficulty } from '../engine/config.js';
import { PRESETS } from '../engine/config.js';
import { loadHistory } from '../storage.js';

const OPTIONS: Exclude<Difficulty, 'custom'>[] = ['easy', 'medium', 'hard'];

export function Menu({
  seed,
  onStart,
  onCustom,
  onQuit,
}: {
  seed: string;
  onStart: (d: Exclude<Difficulty, 'custom'>) => void;
  onCustom: () => void;
  onQuit: () => void;
}) {
  useKeys((input) => {
    const i = Number.parseInt(input, 10);
    if (i >= 1 && i <= 3) onStart(OPTIONS[i - 1]!);
    if (input === 'c') onCustom();
    if (input === 'q') onQuit();
  });

  const history = loadHistory();
  const last = history[history.length - 1];

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold>  market maker  </Text>
      <Text dimColor>quote-taking drill · seed {seed}</Text>
      <Box flexDirection="column" marginY={1}>
        {OPTIONS.map((d, i) => {
          const p = PRESETS[d];
          const cards = p.cardsMin === p.cardsMax ? `${p.cardsMin}` : `${p.cardsMin}-${p.cardsMax}`;
          return (
            <Text key={d}>
              <Text bold color="cyan">{i + 1}</Text> {d.padEnd(7)}
              <Text dimColor>
                {cards} cards · {p.faceUpMin}-{p.faceUpMax} up · {p.decisionSeconds}s
                {p.depletion ? ' · depletion' : ''}
                {p.balanceVisible ? '' : ' · blind balance'}
                {p.revealSeconds !== null ? ` · ${p.revealSeconds}s flash` : ''}
                {p.showRealizedSum ? '' : ' · sum hidden'}
                {p.marketEvents ? ' · events' : ''}
              </Text>
            </Text>
          );
        })}
      </Box>
      {last && (
        <Text dimColor>
          last session: {last.rounds} rounds · decisions {last.decisionPct.toFixed(0)}% · EV captured{' '}
          {last.evCapturedPct.toFixed(0)}% · P&L {last.pnl >= 0 ? '+' : ''}
          {last.pnl}
        </Text>
      )}
      <Text>
        <Text bold color="cyan">c</Text> custom<Text dimColor> · every knob, including quote generation</Text>
      </Text>
      <Text dimColor>{history.length} sessions on record · q to quit</Text>
    </Box>
  );
}
