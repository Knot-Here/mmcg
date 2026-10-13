import React, { useRef, useState } from 'react';
import { Box, Text } from 'ink';
import { useKeys } from './keys.js';
import { PRESETS, type GameConfig } from '../engine/config.js';

type Field = {
  label: string;
  show: (c: GameConfig) => string;
  step: (c: GameConfig, dir: 1 | -1) => GameConfig;
};

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

function num(
  label: string,
  get: (c: GameConfig) => number,
  set: (c: GameConfig, v: number) => GameConfig,
  lo: number,
  hi: number,
  step = 1,
  suffix = '',
): Field {
  return {
    label,
    show: (c) => `${get(c)}${suffix}`,
    step: (c, d) => set(c, clamp(get(c) + d * step, lo, hi)),
  };
}

function bool(label: string, get: (c: GameConfig) => boolean, set: (c: GameConfig, v: boolean) => GameConfig): Field {
  return { label, show: (c) => (get(c) ? 'on' : 'off'), step: (c) => set(c, !get(c)) };
}

const FIELDS: Field[] = [
  num('cards per hand (min)', (c) => c.cardsMin, (c, v) => ({ ...c, cardsMin: v, cardsMax: Math.max(v, c.cardsMax) }), 1, 8),
  num('cards per hand (max)', (c) => c.cardsMax, (c, v) => ({ ...c, cardsMax: v, cardsMin: Math.min(v, c.cardsMin) }), 1, 8),
  num('face-up (min)', (c) => c.faceUpMin, (c, v) => ({ ...c, faceUpMin: v, faceUpMax: Math.max(v, c.faceUpMax) }), 0, 8),
  num('face-up (max)', (c) => c.faceUpMax, (c, v) => ({ ...c, faceUpMax: v, faceUpMin: Math.min(v, c.faceUpMin) }), 0, 8),
  num('decision timer', (c) => c.decisionSeconds, (c, v) => ({ ...c, decisionSeconds: v }), 5, 180, 5, 's'),
  num('report timer', (c) => c.reportSeconds, (c, v) => ({ ...c, reportSeconds: v }), 5, 180, 5, 's'),
  {
    label: 'reveal duration',
    show: (c) => (c.revealSeconds === null ? 'stays up' : `${c.revealSeconds}s flash`),
    step: (c, d) => {
      const cur = c.revealSeconds ?? 0;
      const next = clamp(cur + d, 0, 30);
      return { ...c, revealSeconds: next === 0 ? null : next };
    },
  },
  bool('show sum on reveal', (c) => c.showRealizedSum, (c, v) => ({ ...c, showRealizedSum: v })),
  bool('balance visible', (c) => c.balanceVisible, (c, v) => ({
    ...c,
    balanceVisible: v,
    // Blind play validates against the notional so rejections cannot leak the balance.
    validationMode: v ? 'actual' : 'notional',
  })),
  bool('deck depletion', (c) => c.depletion, (c, v) => ({ ...c, depletion: v })),
  bool('market events', (c) => c.marketEvents, (c, v) => ({ ...c, marketEvents: v })),
  num('starting balance', (c) => c.startingBalance, (c, v) => ({ ...c, startingBalance: v }), 50, 100000, 50),
  num('report penalty', (c) => c.reportPenalty, (c, v) => ({ ...c, reportPenalty: v }), 0, 200, 5),
  num('max units', (c) => c.maxUnits, (c, v) => ({ ...c, maxUnits: v }), 1, 9999, 10),
  num('mispricing S', (c) => c.quote.mispricing, (c, v) => ({ ...c, quote: { ...c.quote, mispricing: v } }), 0, 40),
  num('min spread', (c) => c.quote.minSpread, (c, v) => ({ ...c, quote: { ...c.quote, minSpread: v, maxSpread: Math.max(v, c.quote.maxSpread) } }), 1, 40),
  num('max spread', (c) => c.quote.maxSpread, (c, v) => ({ ...c, quote: { ...c.quote, maxSpread: v, minSpread: Math.min(v, c.quote.minSpread) } }), 1, 40),
  num('howler chance', (c) => Math.round(c.quote.howlerProb * 100), (c, v) => ({ ...c, quote: { ...c.quote, howlerProb: v / 100 } }), 0, 100, 5, '%'),
  num('edge threshold', (c) => c.quote.edgeThreshold, (c, v) => ({ ...c, quote: { ...c.quote, edgeThreshold: v } }), 0, 20),
];

export function Settings({
  seed,
  onStart,
  onBack,
}: {
  seed: string;
  onStart: (cfg: GameConfig) => void;
  onBack: () => void;
}) {
  const [cfg, setCfg] = useState<GameConfig>({ ...PRESETS.medium, seed, difficulty: 'custom' });
  const [cursor, setCursor] = useState(0);

  // Mirrored into a ref so several keys arriving in one chunk see the latest cursor.
  const cursorRef = useRef(0);
  const move = (d: 1 | -1) => {
    cursorRef.current = (cursorRef.current + d + FIELDS.length) % FIELDS.length;
    setCursor(cursorRef.current);
  };

  useKeys((input, k) => {
    if (k.escape || input === 'q') return onBack();
    if (k.return) return onStart(cfg);
    if (k.up || input === 'k') return move(-1);
    if (k.down || input === 'j') return move(1);
    if (k.left || input === 'h') return setCfg((c) => FIELDS[cursorRef.current]!.step(c, -1));
    if (k.right || input === 'l' || input === ' ') return setCfg((c) => FIELDS[cursorRef.current]!.step(c, 1));
    if (input === '1') return setCfg({ ...PRESETS.easy, seed, difficulty: 'custom' });
    if (input === '2') return setCfg({ ...PRESETS.medium, seed, difficulty: 'custom' });
    if (input === '3') return setCfg({ ...PRESETS.hard, seed, difficulty: 'custom' });
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold>  settings  </Text>
      <Text dimColor>arrows move and change · 1/2/3 load a preset · enter play · esc back</Text>
      <Box flexDirection="column" marginY={1}>
        {FIELDS.map((f, i) => (
          <Text key={f.label} color={i === cursor ? 'cyan' : undefined}>
            {i === cursor ? '>' : ' '} {f.label.padEnd(22)}
            <Text bold>{f.show(cfg)}</Text>
          </Text>
        ))}
      </Box>
    </Box>
  );
}
