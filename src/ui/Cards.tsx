import React from 'react';
import { Box, Text } from 'ink';
import { rankLabel, type Card } from '../engine/deck.js';

const RED = new Set(['♥', '♦']);

function CardBox({ card, faceUp }: { card: Card; faceUp: boolean }) {
  if (!faceUp) {
    return (
      <Box flexDirection="column" marginRight={1}>
        <Text dimColor>┌───┐</Text>
        <Text color="blue">│▒▒▒│</Text>
        <Text dimColor>└───┘</Text>
      </Box>
    );
  }
  const label = `${rankLabel(card.rank)}${card.suit}`.padEnd(3);
  return (
    <Box flexDirection="column" marginRight={1}>
      <Text>┌───┐</Text>
      <Text>
        │<Text color={RED.has(card.suit) ? 'red' : 'white'} bold>{label}</Text>│
      </Text>
      <Text>└───┘</Text>
    </Box>
  );
}

export function Hand({ cards, faceUpMask }: { cards: Card[]; faceUpMask: boolean[] }) {
  return (
    <Box>
      {cards.map((c, i) => (
        <CardBox key={i} card={c} faceUp={faceUpMask[i] ?? false} />
      ))}
    </Box>
  );
}

export function DiscardTray({ seen }: { seen: Card[] }) {
  if (seen.length === 0) return null;
  const counts = new Map<number, number>();
  for (const c of seen) counts.set(c.rank, (counts.get(c.rank) ?? 0) + 1);
  const strip = [...counts.keys()]
    .sort((a, b) => a - b)
    .map((r) => `${rankLabel(r)}${counts.get(r)! > 1 ? `x${counts.get(r)}` : ''}`)
    .join(' ');
  return (
    <Text dimColor>
      seen {seen.length}: {strip}
    </Text>
  );
}
