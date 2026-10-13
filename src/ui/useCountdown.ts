import { useEffect, useRef, useState } from 'react';

/**
 * One interval per phase, torn down whenever the phase key changes, so a timer
 * from a finished phase can never fire into the next one.
 */
export function useCountdown(
  total: number | null,
  active: boolean,
  resetKey: string,
  onExpire: () => void,
): { elapsed: number; remaining: number | null } {
  const [elapsed, setElapsed] = useState(0);
  const fired = useRef(false);
  const cb = useRef(onExpire);
  cb.current = onExpire;

  useEffect(() => {
    setElapsed(0);
    fired.current = false;
  }, [resetKey]);

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(id);
  }, [active, resetKey]);

  useEffect(() => {
    if (!active || total === null || fired.current) return;
    if (elapsed >= total) {
      fired.current = true;
      cb.current();
    }
  }, [elapsed, active, total]);

  return { elapsed, remaining: total === null ? null : Math.max(0, total - elapsed) };
}

export function bar(remaining: number, total: number, width = 12): string {
  const filled = Math.max(0, Math.min(width, Math.round((remaining / total) * width)));
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}
