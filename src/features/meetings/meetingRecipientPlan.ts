import type { Matter } from '@/platform/types/matter';
import type { MeetingMeta } from './meetingStore';

export const MEETING_ARTIFACTS = ['audio', 'transcript', 'summary', 'notes'] as const;

export type MeetingArtifact = (typeof MEETING_ARTIFACTS)[number];

export type MeetingRecipientSource = 'calendar' | 'contact' | 'manual' | 'saved';

export interface MeetingRecipient {
  email: string;
  name?: string;
  source: MeetingRecipientSource;
}

export type MeetingRecipientArtifacts = Record<MeetingArtifact, MeetingRecipient[]>;

export interface MeetingDeliveryPlan {
  version: 1;
  artifacts: MeetingRecipientArtifacts;
  updatedAt: string;
}

interface MeetingRecipientCalendarEvent {
  attendees?: Array<{ email?: string; name?: string }>;
}

interface MeetingPlanWorkspace {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
}

export interface MeetingRecipientPlanValidationIssue {
  artifact: MeetingArtifact;
  email: string;
  message: string;
}

export function emptyMeetingRecipientArtifacts(): MeetingRecipientArtifacts {
  return {
    audio: [],
    transcript: [],
    summary: [],
    notes: [],
  };
}

export function normalizeEmailAddress(raw: string): string | null {
  const extracted = raw.trim().match(/<([^<>]+)>/)?.[1] ?? raw.trim();
  const email = extracted.toLowerCase();
  if (!isValidEmailAddress(email)) return null;
  return email;
}

export function isValidEmailAddress(email: string): boolean {
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email.trim());
}

export function normalizeMeetingRecipient(recipient: MeetingRecipient): MeetingRecipient | null {
  const email = normalizeEmailAddress(recipient.email);
  if (!email) return null;
  const name = recipient.name?.trim();
  return {
    email,
    ...(name ? { name } : {}),
    source: recipient.source,
  };
}

export function normalizeMeetingDeliveryPlan(
  plan: Partial<MeetingDeliveryPlan> | null | undefined,
  nowIso: string = new Date().toISOString(),
): MeetingDeliveryPlan {
  const artifacts = emptyMeetingRecipientArtifacts();
  for (const artifact of MEETING_ARTIFACTS) {
    const seen = new Set<string>();
    for (const recipient of plan?.artifacts?.[artifact] ?? []) {
      const normalized = normalizeMeetingRecipient(recipient);
      if (!normalized || seen.has(normalized.email)) continue;
      seen.add(normalized.email);
      artifacts[artifact].push(normalized);
    }
  }
  return {
    version: 1,
    artifacts,
    updatedAt: plan?.updatedAt ?? nowIso,
  };
}

export function validateMeetingDeliveryPlan(
  plan: Partial<MeetingDeliveryPlan> | null | undefined,
): MeetingRecipientPlanValidationIssue[] {
  const issues: MeetingRecipientPlanValidationIssue[] = [];
  for (const artifact of MEETING_ARTIFACTS) {
    for (const recipient of plan?.artifacts?.[artifact] ?? []) {
      if (!normalizeEmailAddress(recipient.email)) {
        issues.push({
          artifact,
          email: recipient.email,
          message: 'Enter a real email address.',
        });
      }
    }
  }
  return issues;
}

export function addRecipientToArtifact(
  plan: MeetingDeliveryPlan,
  artifact: MeetingArtifact,
  recipient: MeetingRecipient,
  nowIso: string = new Date().toISOString(),
): MeetingDeliveryPlan {
  const normalized = normalizeMeetingRecipient(recipient);
  if (!normalized) throw new Error('Enter a real email address.');
  return normalizeMeetingDeliveryPlan(
    {
      version: 1,
      updatedAt: nowIso,
      artifacts: {
        ...plan.artifacts,
        [artifact]: [...plan.artifacts[artifact], normalized],
      },
    },
    nowIso,
  );
}

export function removeRecipientFromArtifact(
  plan: MeetingDeliveryPlan,
  artifact: MeetingArtifact,
  email: string,
  nowIso: string = new Date().toISOString(),
): MeetingDeliveryPlan {
  const normalizedEmail = normalizeEmailAddress(email);
  return normalizeMeetingDeliveryPlan(
    {
      version: 1,
      updatedAt: nowIso,
      artifacts: {
        ...plan.artifacts,
        [artifact]: plan.artifacts[artifact].filter((recipient) => recipient.email !== normalizedEmail),
      },
    },
    nowIso,
  );
}

export function buildMeetingRecipientSuggestions(
  meta: {
    deliveryPlan?: MeetingDeliveryPlan;
    calendarEvent?: MeetingRecipientCalendarEvent;
  } | null,
  matter: Matter | null | undefined,
): MeetingRecipient[] {
  const suggestions: MeetingRecipient[] = [];
  const makeRecipient = (
    email: string | undefined,
    name: string | undefined,
    source: MeetingRecipientSource,
  ): MeetingRecipient => ({
    email: email ?? '',
    ...(name?.trim() ? { name: name.trim() } : {}),
    source,
  });
  const add = (recipient: MeetingRecipient) => {
    const normalized = normalizeMeetingRecipient(recipient);
    if (!normalized) return;
    if (suggestions.some((existing) => existing.email === normalized.email)) return;
    suggestions.push(normalized);
  };

  for (const attendee of meta?.calendarEvent?.attendees ?? []) {
    add(makeRecipient(attendee.email, attendee.name, 'calendar'));
  }

  for (const key of matter?.meetingKeys ?? []) {
    add({ email: key, source: 'contact' });
  }

  for (const artifact of MEETING_ARTIFACTS) {
    for (const recipient of meta?.deliveryPlan?.artifacts[artifact] ?? []) {
      add({ ...recipient, source: 'saved' });
    }
  }

  return suggestions.sort((a, b) => (a.name ?? a.email).localeCompare(b.name ?? b.email));
}

export async function saveMeetingRecipientPlan(
  ws: MeetingPlanWorkspace,
  meetingDir: string,
  expectedMatterId: string,
  plan: Partial<MeetingDeliveryPlan>,
  nowIso: string = new Date().toISOString(),
): Promise<MeetingMeta> {
  const issues = validateMeetingDeliveryPlan(plan);
  if (issues.length > 0) throw new Error(issues[0]?.message ?? 'Check the recipient emails.');

  const raw = await ws.readFile(`${meetingDir}/meeting.json`);
  const base = JSON.parse(raw) as MeetingMeta;
  if (base.matterId !== expectedMatterId) {
    throw new Error('This meeting belongs to a different client.');
  }

  const deliveryPlan = normalizeMeetingDeliveryPlan({ ...plan, updatedAt: nowIso }, nowIso);
  const savedMeta: MeetingMeta = { ...base, deliveryPlan };
  await ws.writeFile(
    `${meetingDir}/meeting.json`,
    JSON.stringify(savedMeta, null, 2),
  );
  return savedMeta;
}
