import type {
  IntakeChecklistState,
  IntakeRecord,
  IntakeStatus,
} from './intakeStore';
import type { OnboardingConfig } from './nudgeTypes';

const DAY_MS = 24 * 60 * 60 * 1000;

export type LinkSignalKind =
  | 'active'
  | 'expires_soon'
  | 'expired'
  | 'revoked'
  | 'new_device'
  | 'duplicate'
  | 'integrity_mismatch'
  | 'routing_failed'
  | 'regenerate_available';

export interface LinkSignal {
  kind: LinkSignalKind;
  severity: 'info' | 'attention' | 'integrity';
  at?: string;
  dismissible: boolean;
}

export interface NudgeEligibility {
  eligible: boolean;
  reason:
    | 'ok'
    | 'nothing_missing'
    | 'cadence_wait'
    | 'link_inactive'
    | 'max_unanswered_suggest_call';
  nextSequence: number;
  suggestCall: boolean;
  daysUntilEligible?: number;
}

export interface OnboardingRow {
  matterId: string;
  requestId: string;
  clientFirstName: string;
  kind: 'onboarding';
  requiredCount: number;
  receivedCount: number;
  missingItemIds: string[];
  missingItemLabels: string[];
  lastActivityAt?: string;
  stalledDays: number;
  isStalled: boolean;
  pendingReviewCount: number;
  status: IntakeStatus;
  linkSignals: LinkSignal[];
  nudgeEligibility: NudgeEligibility;
  sortBucket: number;
}

function parseTimeMs(value: string | undefined): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

function daysSince(value: string | undefined, now: Date): number {
  const start = parseTimeMs(value);
  if (start == null) return 0;
  const diff = now.getTime() - start;
  if (diff <= 0) return 0;
  return Math.floor(diff / DAY_MS);
}

function missingItems(items: IntakeChecklistState[]): IntakeChecklistState[] {
  return items.filter((item) => item.state === 'not_started' || item.state === 'needs_followup');
}

function receivedItems(items: IntakeChecklistState[]): IntakeChecklistState[] {
  return items.filter((item) => item.state === 'received' || item.state === 'accepted');
}

function pendingReviewItems(items: IntakeChecklistState[]): IntakeChecklistState[] {
  return items.filter((item) => item.state === 'received');
}

function isLinkActive(intake: IntakeRecord, now: Date): boolean {
  const expiresAt = parseTimeMs(intake.expiresAt);
  return intake.status === 'active' && (expiresAt == null || expiresAt > now.getTime());
}

function hasActionSignal(signals: LinkSignal[]): boolean {
  return signals.some((signal) => signal.severity === 'attention' || signal.severity === 'integrity');
}

function sortBucketForRow(input: {
  pendingReviewCount: number;
  isStalled: boolean;
  linkSignals: LinkSignal[];
  missingCount: number;
}): number {
  if (input.pendingReviewCount > 0) return 1;
  if (input.isStalled) return 2;
  if (hasActionSignal(input.linkSignals)) return 3;
  if (input.missingCount > 0) return 4;
  return 5;
}

export function deriveLinkSignals(
  intake: IntakeRecord,
  now: Date,
  cfg: OnboardingConfig,
): LinkSignal[] {
  const expiresAt = parseTimeMs(intake.expiresAt);
  const expiresSoonMs = cfg.expiresSoonDays * DAY_MS;
  const linkSignal: LinkSignal =
    intake.status === 'revoked'
      ? {
          kind: 'revoked',
          severity: 'attention',
          at: intake.expiresAt,
          dismissible: false,
        }
      : intake.status === 'expired' || (expiresAt != null && expiresAt <= now.getTime())
        ? {
            kind: 'expired',
            severity: 'attention',
            at: intake.expiresAt,
            dismissible: false,
          }
        : expiresAt != null && expiresAt - now.getTime() <= expiresSoonMs
          ? {
              kind: 'expires_soon',
              severity: 'attention',
              at: intake.expiresAt,
              dismissible: true,
            }
          : {
              kind: 'active',
              severity: 'info',
              at: intake.expiresAt,
              dismissible: true,
            };

  const flagSignals = intake.flags.flatMap<LinkSignal>((flag) => {
    switch (flag.kind) {
      case 'new_device':
      case 'duplicate':
        return [{
          kind: flag.kind,
          severity: 'attention',
          at: flag.at,
          dismissible: true,
        }];
      case 'routing_failed':
        return [{
          kind: 'routing_failed',
          severity: 'attention',
          at: flag.at,
          dismissible: false,
        }];
      case 'integrity_mismatch':
        return [{
          kind: 'integrity_mismatch',
          severity: 'integrity',
          at: flag.at,
          dismissible: false,
        }];
      case 'stale_overwrite':
      case 'vault_off_nudge':
        return [];
    }
  });

  const regenerateSignal: LinkSignal[] =
    (linkSignal.kind === 'expired' || linkSignal.kind === 'revoked') &&
    (receivedItems(intake.items).length > 0 || intake.receivedItems.length > 0)
      ? [{
          kind: 'regenerate_available',
          severity: 'info',
          at: intake.expiresAt,
          dismissible: false,
        }]
      : [];

  return [linkSignal, ...regenerateSignal, ...flagSignals];
}

export function deriveNudgeEligibility(
  intake: IntakeRecord,
  now: Date,
  cfg: OnboardingConfig,
): NudgeEligibility {
  const nextSequence = Math.max(0, ...intake.nudges.map((attempt) => attempt.sequence)) + 1;
  if (!isLinkActive(intake, now)) {
    return {
      eligible: false,
      reason: 'link_inactive',
      nextSequence,
      suggestCall: false,
    };
  }

  if (missingItems(intake.items).length === 0) {
    return {
      eligible: false,
      reason: 'nothing_missing',
      nextSequence,
      suggestCall: false,
    };
  }

  const lastActivityMs = parseTimeMs(intake.lastClientActivityAt) ?? Number.NEGATIVE_INFINITY;
  const emailAttempts = intake.nudges.filter((attempt) => attempt.channel === 'email_draft');
  const unansweredCount = emailAttempts.filter((attempt) => {
    const attemptMs = parseTimeMs(attempt.at);
    return attemptMs != null && attemptMs > lastActivityMs;
  }).length;
  if (unansweredCount >= cfg.maxUnanswered) {
    return {
      eligible: false,
      reason: 'max_unanswered_suggest_call',
      nextSequence,
      suggestCall: true,
    };
  }

  const lastEmail = emailAttempts
    .map((attempt) => parseTimeMs(attempt.at))
    .filter((time): time is number => time != null)
    .sort((a, b) => b - a)[0];
  if (lastEmail != null) {
    const elapsedDays = Math.floor(Math.max(0, now.getTime() - lastEmail) / DAY_MS);
    if (elapsedDays < cfg.cadenceDays) {
      return {
        eligible: false,
        reason: 'cadence_wait',
        nextSequence,
        suggestCall: false,
        daysUntilEligible: cfg.cadenceDays - elapsedDays,
      };
    }
  }

  return {
    eligible: true,
    reason: 'ok',
    nextSequence,
    suggestCall: false,
  };
}

export function deriveOnboardingRow(
  intake: IntakeRecord,
  now: Date,
  cfg: OnboardingConfig,
): OnboardingRow {
  const requiredItems = intake.items.filter((item) => item.state !== 'not_needed');
  const missing = missingItems(requiredItems);
  const received = receivedItems(requiredItems);
  const pendingReviewCount = pendingReviewItems(requiredItems).length;
  const stalledDays = daysSince(intake.lastClientActivityAt, now);
  const linkSignals = deriveLinkSignals(intake, now, cfg);
  const nudgeEligibility = deriveNudgeEligibility(intake, now, cfg);
  const isStalled = missing.length > 0 && stalledDays >= cfg.stallDays;
  const sortBucket = sortBucketForRow({
    pendingReviewCount,
    isStalled,
    linkSignals,
    missingCount: missing.length,
  });

  return {
    matterId: intake.matterId,
    requestId: intake.intakeId,
    clientFirstName: intake.clientFirstName,
    kind: 'onboarding',
    requiredCount: requiredItems.length,
    receivedCount: received.length,
    missingItemIds: missing.map((item) => item.itemId),
    missingItemLabels: missing.map((item) => item.label),
    ...(intake.lastClientActivityAt ? { lastActivityAt: intake.lastClientActivityAt } : {}),
    stalledDays,
    isStalled,
    pendingReviewCount,
    status: intake.status,
    linkSignals,
    nudgeEligibility,
    sortBucket,
  };
}

export function sortOnboardingRows(rows: OnboardingRow[]): OnboardingRow[] {
  return [...rows].sort((a, b) => {
    const bucket = a.sortBucket - b.sortBucket;
    if (bucket !== 0) return bucket;
    const stalled = b.stalledDays - a.stalledDays;
    if (stalled !== 0) return stalled;
    return a.clientFirstName.localeCompare(b.clientFirstName);
  });
}
