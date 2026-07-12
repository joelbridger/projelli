import type { IntakeRecord } from './intakeStore';
import { isReceivedChecklistItem, type OnboardingRow } from './onboardingModel';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface OnboardingKpis {
  avgDaysToComplete: number | null;
  stalledCount: number;
  completionRate: number;
  completedCount: number;
  activeCount: number;
}

function parseTimeMs(value: string | undefined): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

function round(value: number, decimalPlaces: number): number {
  const factor = 10 ** decimalPlaces;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function isChecklistComplete(record: IntakeRecord): boolean {
  const requiredItems = record.items.filter((item) => item.state !== 'not_needed');
  return requiredItems.length > 0 && requiredItems.every(isReceivedChecklistItem);
}

function latestAcceptedItemTime(record: IntakeRecord): number | null {
  const acceptedItemTimes = record.items
    .filter((item) => item.state === 'accepted')
    .map((item) => parseTimeMs(item.provenance?.at))
    .filter((time): time is number => time != null);
  return acceptedItemTimes.length > 0 ? Math.max(...acceptedItemTimes) : null;
}

function completedDurationInDays(record: IntakeRecord, row?: OnboardingRow): number | null {
  const createdAt = parseTimeMs(record.createdAt);
  const completedAt =
    (record.status === 'completed' ? parseTimeMs(record.completedAt) : null) ??
    latestAcceptedItemTime(record) ??
    parseTimeMs(row?.lastActivityAt);
  if (createdAt == null || completedAt == null || completedAt < createdAt) return null;
  return (completedAt - createdAt) / DAY_MS;
}

/**
 * Builds the onboarding-board summary using only state already held on this
 * device. No request, relay, or client-level data is involved.
 */
export function computeOnboardingKpis(
  rows: OnboardingRow[],
  records: IntakeRecord[],
): OnboardingKpis {
  const rowsByRequestId = new Map(rows.map((row) => [row.requestId, row]));
  const completedRecords = records.filter(
    (record) => record.status === 'completed' || isChecklistComplete(record),
  );
  const completedCount = completedRecords.length;
  const activeCount = records.filter(
    (record) => record.status === 'active' && !isChecklistComplete(record),
  ).length;
  const completionDurations = completedRecords
    .map((record) => completedDurationInDays(record, rowsByRequestId.get(record.intakeId)))
    .filter((duration): duration is number => duration != null);
  const totalIntakes = completedCount + activeCount;

  return {
    avgDaysToComplete:
      completionDurations.length > 0
        ? round(
            completionDurations.reduce((total, duration) => total + duration, 0) /
              completionDurations.length,
            1,
          )
        : null,
    stalledCount: rows.filter((row) => row.isStalled).length,
    completionRate: totalIntakes > 0 ? round(completedCount / totalIntakes, 2) : 0,
    completedCount,
    activeCount,
  };
}
