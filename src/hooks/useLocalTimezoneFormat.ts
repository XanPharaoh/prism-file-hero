import { useMemo } from 'react';

interface LocalTimezoneResult {
  localTime: string;
  timezoneAbbr: string;
  timezoneName: string;
  formatted: string;
}

/**
 * useLocalTimezoneFormat — Translates a UTC date string to the user's local timezone.
 * 
 * Example: If SAST reset is "2026-07-07T22:00:00Z" and user is in New York (UTC-4),
 * returns: { localTime: "6:00 PM", timezoneAbbr: "EDT", formatted: "Resets at 6:00 PM EDT (12:00 AM SAST)" }
 */
export function useLocalTimezoneFormat(utcDate?: Date | string | number | null): LocalTimezoneResult {
  // useMemo must always run; invalid/missing dates use a stable fallback.
  return useMemo(() => {
    const userTz = Intl.DateTimeFormat().resolvedOptions().timeZone;

    if (utcDate == null || utcDate === '') {
      return {
        localTime: '--:--',
        timezoneAbbr: userTz,
        timezoneName: userTz,
        formatted: 'Reset time unavailable',
      };
    }

    const date = new Date(utcDate);
    if (Number.isNaN(date.getTime())) {
      return {
        localTime: '--:--',
        timezoneAbbr: userTz,
        timezoneName: userTz,
        formatted: 'Reset time unavailable',
      };
    }

    // Format the local time
    const localTimeFormatter = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: userTz,
    });

    // Get timezone abbreviation (e.g., "EST", "EDT", "JST")
    const tzAbbrFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: userTz,
      timeZoneName: 'short',
    });
    const tzParts = tzAbbrFormatter.formatToParts(date);
    const timezoneAbbr = tzParts.find(p => p.type === 'timeZoneName')?.value ?? userTz;

    // Get full timezone name
    const tzNameFormatter = new Intl.DateTimeFormat('en-US', {
      timeZone: userTz,
      timeZoneName: 'long',
    });
    const tzNameParts = tzNameFormatter.formatToParts(date);
    const timezoneName = tzNameParts.find(p => p.type === 'timeZoneName')?.value ?? userTz;

    const localTime = localTimeFormatter.format(date);

    return {
      localTime,
      timezoneAbbr,
      timezoneName,
      formatted: `Resets at ${localTime} ${timezoneAbbr} (12:00 AM SAST)`,
    };
  }, [utcDate]);
}

export default useLocalTimezoneFormat;
