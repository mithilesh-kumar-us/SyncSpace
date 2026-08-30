const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31536000],
  ["month", 2592000],
  ["day", 86400],
  ["hour", 3600],
  ["minute", 60],
];

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

export function formatRelativeTime(isoDate: string): string {
  const seconds = (Date.now() - new Date(isoDate).getTime()) / 1000;
  if (seconds < 30) return "just now";

  for (const [unit, secondsInUnit] of UNITS) {
    const value = Math.floor(seconds / secondsInUnit);
    if (value >= 1) return rtf.format(-value, unit);
  }
  return rtf.format(-Math.floor(seconds), "second");
}
