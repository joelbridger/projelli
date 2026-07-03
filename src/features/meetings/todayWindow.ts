/**
 * Local-midnight-to-local-midnight window, converted to UTC instants, for
 * "what's on the calendar today" queries. Extracted to its own module (the
 * wave-1 plan originally put this inside TodaysMeetingsStrip.tsx, Task 13)
 * because Task 18 (brief staleness) needs it and was built before Task 13
 * per the coordinator's build-order call — both now import from here.
 */

export function todayWindowUtc(now: Date = new Date()): {
  fromUtc: string;
  toUtc: string;
} {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start.getTime() + 24 * 3600 * 1000);
  return { fromUtc: start.toISOString(), toUtc: end.toISOString() };
}
