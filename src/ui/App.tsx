import React, { useState } from 'react';
import { useApp } from 'ink';
import { Menu } from './Menu.js';
import { Play } from './Play.js';
import { Summary } from './Summary.js';
import { Settings } from './Settings.js';
import { Session } from '../engine/session.js';
import { makeConfig, type Difficulty, type GameConfig } from '../engine/config.js';

export function App({ seed, difficulty }: { seed: string; difficulty?: Exclude<Difficulty, 'custom'> }) {
  const { exit } = useApp();
  const [session, setSession] = useState<Session | null>(() =>
    difficulty ? new Session(makeConfig(difficulty, seed)) : null,
  );
  const [done, setDone] = useState(false);
  const [settings, setSettings] = useState(false);

  if (!session) {
    if (settings) {
      return (
        <Settings
          seed={seed}
          onStart={(cfg: GameConfig) => setSession(new Session(cfg))}
          onBack={() => setSettings(false)}
        />
      );
    }
    return (
      <Menu
        seed={seed}
        onStart={(d) => setSession(new Session(makeConfig(d, seed)))}
        onCustom={() => setSettings(true)}
        onQuit={exit}
      />
    );
  }
  if (done) return <Summary session={session} onExit={exit} />;
  return <Play session={session} onEnd={() => setDone(true)} />;
}
