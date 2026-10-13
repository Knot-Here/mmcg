import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import type { SessionStats } from './engine/scoring.js';
import type { Difficulty } from './engine/config.js';

export interface StoredSession extends SessionStats {
  playedAt: string;
  seed: string;
  difficulty: Difficulty;
  balanceGuess: number | null;
  balanceGuessCorrect: boolean | null;
}

const dir = join(
  process.env['XDG_DATA_HOME'] ?? join(homedir(), '.local', 'share'),
  'mm-game',
);
const file = join(dir, 'stats.json');

export function loadHistory(): StoredSession[] {
  try {
    if (!existsSync(file)) return [];
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    return Array.isArray(raw) ? (raw as StoredSession[]) : [];
  } catch {
    return [];
  }
}

export function saveSession(s: StoredSession): void {
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, JSON.stringify([...loadHistory(), s], null, 2));
  } catch {
    // Stats are a nice-to-have; never let persistence break a session.
  }
}

export const statsPath = file;
