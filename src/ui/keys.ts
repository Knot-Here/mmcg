import { useInput } from 'ink';

export interface KeyFlags {
  return: boolean;
  backspace: boolean;
  escape: boolean;
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
}

const NONE: KeyFlags = {
  return: false,
  backspace: false,
  escape: false,
  up: false,
  down: false,
  left: false,
  right: false,
};

/**
 * A terminal can hand us several keystrokes in one read - key repeat, a fast
 * typist, a paste. Plain printable runs are split and dispatched one character
 * at a time; anything containing an escape sequence is passed through to ink's
 * parser untouched so arrow keys keep working.
 */
export function useKeys(handler: (ch: string, k: KeyFlags) => void): void {
  useInput((input, key) => {
    if (input.length > 1 && /^[\x20-\x7e\r\n]+$/.test(input)) {
      for (const ch of input) {
        const enter = ch === '\r' || ch === '\n';
        handler(enter ? '' : ch, { ...NONE, return: enter });
      }
      return;
    }
    handler(input, {
      return: key.return,
      backspace: key.backspace || key.delete,
      escape: key.escape,
      up: key.upArrow,
      down: key.downArrow,
      left: key.leftArrow,
      right: key.rightArrow,
    });
  });
}
