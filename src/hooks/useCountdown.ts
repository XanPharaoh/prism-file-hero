import { useState, useEffect, useCallback } from 'react';

interface CountdownResult {
  hours: string;
  minutes: string;
  seconds: string;
  isExpired: boolean;
  totalSeconds: number;
}

/**
 * useCountdown — Live countdown timer hook.
 * Updates every 1000ms. Returns zero-padded hours, minutes, seconds.
 * `isExpired` becomes true when the target date has passed.
 */
export function useCountdown(targetDate?: Date | string | number | null): CountdownResult {
  // ALL hooks must run unconditionally before any early return.
  const getTotalSeconds = useCallback(() => {
    if (targetDate == null || targetDate === '') return 0;

    const target = new Date(targetDate).getTime();
    if (Number.isNaN(target)) return 0;

    const now = Date.now();
    return Math.max(0, Math.floor((target - now) / 1000));
  }, [targetDate]);

  const [totalSeconds, setTotalSeconds] = useState(getTotalSeconds);

  useEffect(() => {
    if (targetDate == null || targetDate === '') {
      setTotalSeconds(0);
      return;
    }

    setTotalSeconds(getTotalSeconds());
    const interval = setInterval(() => {
      setTotalSeconds(getTotalSeconds());
    }, 1000);
    return () => clearInterval(interval);
  }, [getTotalSeconds, targetDate]);

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return {
    hours: String(hours).padStart(2, '0'),
    minutes: String(minutes).padStart(2, '0'),
    seconds: String(seconds).padStart(2, '0'),
    isExpired: totalSeconds <= 0,
    totalSeconds,
  };
}

export default useCountdown;
