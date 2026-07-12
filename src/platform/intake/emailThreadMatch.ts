import type { IntakeRecord } from './intakeStore';

function asStringArray(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

export function intakeThreadIds(intake: IntakeRecord): string[] {
  const loose = intake as IntakeRecord & Record<string, unknown>;
  const ids = [
    ...asStringArray(loose['threadId']),
    ...asStringArray(loose['thread_id']),
    ...asStringArray(loose['outboundThreadId']),
    ...asStringArray(loose['outboundThreadIds']),
    ...asStringArray(loose['initialThreadId']),
    ...asStringArray(loose['nudgeThreadIds']),
  ];
  for (const nudge of intake.nudges) {
    const looseNudge = nudge as typeof nudge & Record<string, unknown>;
    ids.push(...asStringArray(looseNudge['threadId']));
    ids.push(...asStringArray(looseNudge['thread_id']));
  }
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
}

export function emailThreadMatches(
  inboundThreadId: string | null | undefined,
  intake: IntakeRecord
): boolean {
  const threadId = inboundThreadId?.trim();
  if (!threadId) return false;
  return intakeThreadIds(intake).includes(threadId);
}
