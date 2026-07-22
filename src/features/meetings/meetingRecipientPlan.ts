import type { Matter } from '@/platform/types/matter';
import type { MeetingMeta } from './meetingStore';

export const MEETING_ARTIFACTS = ['notes', 'transcript', 'summary', 'audio'] as const;

export type MeetingArtifact = (typeof MEETING_ARTIFACTS)[number];

export type MeetingRecipientSource = 'calendar' | 'contact' | 'manual' | 'saved' | 'group';

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

export interface MeetingRecipientGroup {
  id: string;
  name: string;
  recipients: MeetingRecipient[];
  createdAt: string;
  updatedAt: string;
}

export interface MeetingRecipientGroupsFile {
  version: 1;
  groups: MeetingRecipientGroup[];
}

interface MeetingRecipientGroupsFileInput {
  version?: 1;
  groups?: Array<Partial<MeetingRecipientGroup>>;
}

interface MeetingRecipientCalendarEvent {
  attendees?: Array<{ email?: string; name?: string }>;
}

interface MeetingPlanWorkspace {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
}

interface MeetingRecipientGroupWorkspace {
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
    notes: [],
    transcript: [],
    summary: [],
    audio: [],
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

export function calendarAttendeesToRecipients(
  calendarEvent: MeetingRecipientCalendarEvent | null | undefined,
): MeetingRecipient[] {
  const recipients: MeetingRecipient[] = [];
  const seen = new Set<string>();

  for (const attendee of calendarEvent?.attendees ?? []) {
    const normalized = normalizeMeetingRecipient({
      email: attendee.email ?? '',
      ...(attendee.name?.trim() ? { name: attendee.name.trim() } : {}),
      source: 'calendar',
    });
    if (!normalized || seen.has(normalized.email)) continue;
    seen.add(normalized.email);
    recipients.push(normalized);
  }

  return recipients;
}

export function deliveryPlanForAllArtifacts(
  recipients: MeetingRecipient[],
  nowIso: string = new Date().toISOString(),
): MeetingDeliveryPlan {
  const artifacts = emptyMeetingRecipientArtifacts();
  const normalizedRecipients = uniqueRecipients(recipients);
  for (const artifact of MEETING_ARTIFACTS) {
    artifacts[artifact] = normalizedRecipients;
  }
  return { version: 1, artifacts, updatedAt: nowIso };
}

export function resolveMeetingDeliveryPlan(
  meta: Pick<MeetingMeta, 'deliveryPlan' | 'calendarEvent'> | null | undefined,
  nowIso: string = new Date().toISOString(),
): MeetingDeliveryPlan {
  if (meta?.deliveryPlan) return normalizeMeetingDeliveryPlan(meta.deliveryPlan, nowIso);

  const attendees = calendarAttendeesToRecipients(meta?.calendarEvent);
  if (attendees.length === 0) return normalizeMeetingDeliveryPlan(null, nowIso);
  return deliveryPlanForAllArtifacts(attendees, nowIso);
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

export function setRecipientForArtifact(
  plan: MeetingDeliveryPlan,
  artifact: MeetingArtifact,
  recipient: MeetingRecipient,
  included: boolean,
  nowIso: string = new Date().toISOString(),
): MeetingDeliveryPlan {
  return included
    ? addRecipientToArtifact(plan, artifact, recipient, nowIso)
    : removeRecipientFromArtifact(plan, artifact, recipient.email, nowIso);
}

export function setRecipientForEveryArtifact(
  plan: MeetingDeliveryPlan,
  recipient: MeetingRecipient,
  included: boolean,
  nowIso: string = new Date().toISOString(),
): MeetingDeliveryPlan {
  return MEETING_ARTIFACTS.reduce(
    (next, artifact) => setRecipientForArtifact(next, artifact, recipient, included, nowIso),
    plan,
  );
}

export function addGroupToMeetingDeliveryPlan(
  plan: MeetingDeliveryPlan,
  group: MeetingRecipientGroup,
  nowIso: string = new Date().toISOString(),
): MeetingDeliveryPlan {
  return uniqueRecipients(group.recipients).reduce(
    (next, recipient) => setRecipientForEveryArtifact(
      next,
      { ...recipient, source: 'group' },
      true,
      nowIso,
    ),
    plan,
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
  guard?: { readonly assertCurrentAccess: () => Promise<void> },
): Promise<MeetingMeta> {
  const issues = validateMeetingDeliveryPlan(plan);
  const firstIssue = issues[0];
  if (firstIssue) throw new Error(firstIssue.message);

  await guard?.assertCurrentAccess();
  const raw = await ws.readFile(`${meetingDir}/meeting.json`);
  const base = JSON.parse(raw) as MeetingMeta;
  if (base.matterId !== expectedMatterId) {
    throw new Error('This meeting belongs to a different client.');
  }

  const deliveryPlan = normalizeMeetingDeliveryPlan({ ...plan, updatedAt: nowIso }, nowIso);
  const savedMeta: MeetingMeta = { ...base, deliveryPlan };
  await guard?.assertCurrentAccess();
  await ws.writeFile(
    `${meetingDir}/meeting.json`,
    JSON.stringify(savedMeta, null, 2),
  );
  return savedMeta;
}

export function meetingRecipientGroupsPath(matter: Matter | null | undefined): string | null {
  const matterFolder = matter?.folderPaths[0]?.trim();
  return matterFolder ? `${matterFolder}/.lantern/meeting-recipient-groups.json` : null;
}

export function normalizeMeetingRecipientGroupsFile(
  file: MeetingRecipientGroupsFileInput | null | undefined,
): MeetingRecipientGroupsFile {
  const groups: MeetingRecipientGroup[] = [];
  const seenIds = new Set<string>();

  for (const group of file?.groups ?? []) {
    const name = group.name?.trim();
    if (!group.id || !name || seenIds.has(group.id)) continue;
    const recipients = uniqueRecipients(group.recipients ?? []);
    if (recipients.length === 0) continue;
    seenIds.add(group.id);
    groups.push({
      id: group.id,
      name,
      recipients,
      createdAt: group.createdAt || group.updatedAt || new Date().toISOString(),
      updatedAt: group.updatedAt || group.createdAt || new Date().toISOString(),
    });
  }

  return { version: 1, groups };
}

export async function loadMeetingRecipientGroups(
  ws: MeetingRecipientGroupWorkspace,
  matter: Matter | null | undefined,
): Promise<MeetingRecipientGroupsFile> {
  const path = meetingRecipientGroupsPath(matter);
  if (!path) return { version: 1, groups: [] };
  try {
    return normalizeMeetingRecipientGroupsFile(JSON.parse(await ws.readFile(path)) as Partial<MeetingRecipientGroupsFile>);
  } catch {
    return { version: 1, groups: [] };
  }
}

export async function saveMeetingRecipientGroup(
  ws: MeetingRecipientGroupWorkspace,
  matter: Matter | null | undefined,
  name: string,
  recipients: MeetingRecipient[],
  nowIso: string = new Date().toISOString(),
  idFactory: () => string = () => `group_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
): Promise<MeetingRecipientGroupsFile> {
  const path = meetingRecipientGroupsPath(matter);
  if (!path) throw new Error('Open a client folder before saving a group.');

  const label = name.trim();
  if (!label) throw new Error('Name the group first.');

  const normalizedRecipients = uniqueRecipients(recipients).map((recipient) => ({ ...recipient, source: 'manual' as const }));
  if (normalizedRecipients.length === 0) throw new Error('Add at least one person before saving a group.');

  const current = await loadMeetingRecipientGroups(ws, matter);
  const existing = current.groups.find((group) => group.name.toLowerCase() === label.toLowerCase());
  const group: MeetingRecipientGroup = {
    id: existing?.id ?? idFactory(),
    name: label,
    recipients: normalizedRecipients,
    createdAt: existing?.createdAt ?? nowIso,
    updatedAt: nowIso,
  };
  const next = normalizeMeetingRecipientGroupsFile({
    version: 1,
    groups: [...current.groups.filter((candidate) => candidate.id !== group.id), group],
  });
  await ws.writeFile(path, JSON.stringify(next, null, 2));
  return next;
}

export function recipientsInDeliveryPlan(plan: MeetingDeliveryPlan): MeetingRecipient[] {
  const recipients: MeetingRecipient[] = [];
  for (const artifact of MEETING_ARTIFACTS) {
    recipients.push(...plan.artifacts[artifact]);
  }
  return uniqueRecipients(recipients);
}

function uniqueRecipients(recipients: MeetingRecipient[]): MeetingRecipient[] {
  const normalizedRecipients: MeetingRecipient[] = [];
  const seen = new Set<string>();

  for (const recipient of recipients) {
    const normalized = normalizeMeetingRecipient(recipient);
    if (!normalized || seen.has(normalized.email)) continue;
    seen.add(normalized.email);
    normalizedRecipients.push(normalized);
  }

  return normalizedRecipients;
}
