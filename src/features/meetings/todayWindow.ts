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
  // COORDINATOR FINDING (P2): `start.getTime() + 24h` is wrong on a DST
  // transition day (23h "spring forward" / 25h "fall back") — the result
  // lands an hour before or after the NEXT day's actual local midnight,
  // either cutting off or over-including an hour of events. Building `end`
  // from local calendar components (day + 1) instead of a fixed millisecond
  // offset lets the Date constructor do the DST-correct thing: it rolls
  // day/month/year correctly AND resolves to the real local midnight of the
  // next calendar date regardless of how many wall-clock hours that is away.
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return { fromUtc: start.toISOString(), toUtc: end.toISOString() };
}
