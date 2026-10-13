import React from 'react';
import { render } from 'ink';
import { App } from './ui/App.js';
import { randomSeed } from './engine/rng.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

if (process.argv.includes('--help')) {
  console.log(`market maker - quote-taking drill

  mm [--difficulty easy|medium|hard] [--seed <seed>]

  b buy · s sell · k/space skip · digits set size · enter send
  report phase: digits and - to type P&L, enter to submit
`);
  process.exit(0);
}

const seed = arg('seed') ?? randomSeed();
const d = arg('difficulty');
const difficulty = d === 'easy' || d === 'medium' || d === 'hard' ? d : undefined;

render(<App seed={seed} difficulty={difficulty} />);
