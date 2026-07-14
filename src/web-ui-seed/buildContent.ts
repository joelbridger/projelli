/**
 * web-ui-seed — pure content builders.
 *
 * Turns one generated household record (src/web-ui-seed/data/households.generated.json)
 * into the markdown documents written to OPFS and the ClientMap shown in the
 * Client Map tab. Every ClientMap citation snippet is a literal substring of
 * the document it cites (same contract as sampleClientMap.ts's hand-authored
 * Hendricks map) — built from the SAME line strings used in the markdown, so
 * [source] chips always resolve to a real passage instead of drifting out of
 * sync with hand-copied text.
 *
 * Dev-only module (imported only from WebUiSeedBootstrap.ts, which is only
 * reached behind `import.meta.env.DEV`). No Tauri/runtime imports here beyond
 * the browser-safe ClientMap/matter types, so this stays trivially testable.
 */
import type {
  ClientMap,
  ClientMapItem,
  ClientMapSection,
  CoreSectionKey,
  SourceRef,
} from '@/platform/clientMap/types';
import { CORE_SECTION_ORDER, CORE_SECTION_TITLE } from '@/platform/clientMap/types';
import type { MeetingCalendarEventMeta, MeetingMeta } from '@/features/meetings/meetingStore';

export interface SeedMember {
  name: string;
  born: number | null;
  email: string;
  role: string;
}
export interface SeedAccount {
  type: string;
  owner: string;
  balance: number;
  numberMasked: string;
}
export interface SeedStoryline {
  topic: string;
  status: string;
  details: string;
}
export interface SeedTimelineEntry {
  date: string;
  event: string;
}
export interface SeedEmail {
  date: string;
  subject: string;
  fromName: string;
  fromEmail: string;
  toName: string;
  toEmail: string;
  body: string;
}
export interface SeedMeeting {
  folderName: string;
  startedAt: string;
  durationMs: number | null;
  calendarTitle: string;
  customTitle: string;
  typeId: string;
  reviewedAt: string | null;
  consent: { mode: 'one-party' | 'two-party'; confirmedBy: string; confirmedAt: string; note?: string } | null;
  calendarEvent: MeetingCalendarEventMeta | null;
}
export interface SeedHousehold {
  id: string;
  folderName: string;
  name: string;
  client: string;
  slug: string;
  tier: 'full' | 'light';
  segment: string;
  custodian: string;
  risk: string;
  aumTotal: number | null;
  members: SeedMember[];
  accounts: SeedAccount[];
  goals: string[];
  concerns: string[];
  storylines: SeedStoryline[];
  timeline: SeedTimelineEntry[];
  family: string;
  meeting: SeedMeeting | null;
  emails: SeedEmail[];
}

const money = (n: number): string => `$${n.toLocaleString('en-US')}`;

function memberLine(m: SeedMember): string {
  const age = m.born ? `, born ${String(m.born)}` : '';
  const role = m.role ? ` (${m.role}${age})` : age ? ` (${age.replace(', ', '')})` : '';
  return `${m.name}${role}${m.email ? ` — ${m.email}` : ''}`;
}

function accountLine(a: SeedAccount): string {
  return `${a.type} (${a.owner}): ${money(a.balance)}${a.numberMasked ? ` (${a.numberMasked})` : ''}`;
}

function storylineLine(s: SeedStoryline): string {
  return `${s.details} [${s.topic}, ${s.status}]`;
}

function timelineLine(t: SeedTimelineEntry): string {
  return `${t.date}: ${t.event}`;
}

/** The Household Overview document — written for every seeded household. */
export function buildHouseholdOverviewMarkdown(h: SeedHousehold): string {
  const memberLines = h.members.map(memberLine);
  const accountLines = h.accounts.map(accountLine);
  const storylineLines = h.storylines.map(storylineLine);
  const timelineLines = h.timeline.map(timelineLine);
  const totalLine = h.aumTotal !== null ? `Total assets under management: approximately ${money(h.aumTotal)}.` : '';

  return [
    `# ${h.name} — Household Overview`,
    '',
    '## Household',
    h.family || 'Household details on file.',
    '',
    'Members:',
    ...memberLines.map((l) => `- ${l}`),
    '',
    `Segment: ${h.segment || 'unclassified'}. Risk tolerance: ${h.risk || 'unassessed'}. Custodian: ${h.custodian || 'unassigned'}.`,
    '',
    '## Goals',
    ...(h.goals.length ? h.goals.map((g) => `- ${g}`) : ['- No goals recorded yet.']),
    '',
    '## Concerns',
    ...(h.concerns.length ? h.concerns.map((c) => `- ${c}`) : ['- No concerns recorded yet.']),
    '',
    '## Money and Accounts',
    ...(accountLines.length ? accountLines.map((l) => `- ${l}`) : ['- No accounts on file yet.']),
    totalLine,
    '',
    '## Follow-ups',
    ...(storylineLines.length ? storylineLines.map((l) => `- ${l}`) : ['- No open follow-ups.']),
    '',
    '## Timeline',
    ...(timelineLines.length ? timelineLines.map((l) => `- ${l}`) : ['- No recorded activity yet.']),
    '',
  ].join('\n');
}

/** Account Summary document — full-tier households only. */
export function buildAccountSummaryMarkdown(h: SeedHousehold): string {
  const accountLines = h.accounts.map(accountLine);
  return [
    `# ${h.name} — Account Summary`,
    '',
    `Custodian: ${h.custodian || 'unassigned'}.`,
    '',
    '## Account Holdings',
    ...accountLines.map((l) => `- ${l}`),
    '',
    h.aumTotal !== null ? `Total assets under management: approximately ${money(h.aumTotal)}.` : '',
    '',
  ].join('\n');
}

/** Email Thread document (rendered from the household's outbox emails) — full-tier only. */
export function buildEmailThreadMarkdown(h: SeedHousehold): string {
  const parts = [`# ${h.name} — Email Thread`, ''];
  h.emails.forEach((e, i) => {
    parts.push(`## Email ${String(i + 1)} — ${e.date}`);
    parts.push(`From: ${e.fromName} <${e.fromEmail}>`);
    parts.push(`To: ${e.toName} <${e.toEmail}>`);
    parts.push(`Subject: ${e.subject}`);
    parts.push('');
    parts.push(e.body);
    parts.push('');
  });
  if (h.emails.length === 0) parts.push('No emails on file yet.', '');
  return parts.join('\n');
}

/** Meeting notes markdown — source for the generated notes.docx, full-tier only. */
export function buildMeetingNotesMarkdown(h: SeedHousehold): string {
  const meeting = h.meeting;
  if (!meeting) return `# ${h.name} — Meeting Notes\n\nNo meetings on file yet.\n`;
  const title = meeting.customTitle || meeting.calendarTitle || `${h.name} review`;
  const date = meeting.startedAt.slice(0, 10);
  const storylineLines = h.storylines.map(storylineLine);
  return [
    `# ${title}`,
    '',
    `Date: ${date}`,
    `Type: ${meeting.typeId}`,
    '',
    '## Discussion',
    ...(storylineLines.length ? storylineLines.map((l) => `- ${l}`) : ['- General check-in, no open items.']),
    '',
    '## Decisions and Follow-ups',
    ...(h.concerns.length ? h.concerns.map((c) => `- ${c}`) : ['- None recorded.']),
    '',
  ].join('\n');
}

/** meeting.json contents for the seeded Meetings/<folder>/ entry. */
export function buildMeetingMeta(h: SeedHousehold, matterId: string): MeetingMeta | null {
  const meeting = h.meeting;
  if (!meeting) return null;
  return {
    matterId,
    startedAt: meeting.startedAt,
    consent: meeting.consent ?? {
      mode: 'two-party',
      confirmedBy: 'Advisor',
      confirmedAt: meeting.startedAt,
      note: 'Seed data for browser UI review only.',
    },
    ...(meeting.durationMs !== null ? { durationMs: meeting.durationMs } : {}),
    ...(meeting.reviewedAt ? { reviewedAt: meeting.reviewedAt } : {}),
    ...(meeting.typeId ? { typeId: meeting.typeId } : {}),
    ...(meeting.calendarTitle ? { calendarTitle: meeting.calendarTitle } : {}),
    ...(meeting.customTitle ? { customTitle: meeting.customTitle } : {}),
    ...(meeting.calendarEvent ? { calendarEvent: meeting.calendarEvent } : {}),
  };
}

function doc(file: string, snippet: string): SourceRef {
  return { kind: 'document', ref: file, snippet };
}

let itemSeq = 0;
function mkItem(text: string, sources: SourceRef[], asOf: string): ClientMapItem {
  itemSeq += 1;
  return {
    id: `webseed-it-${String(itemSeq)}`,
    text,
    origin: 'ai',
    isAssumption: false,
    sources,
    updatedAt: asOf,
  };
}

const SEED_TS = '2026-07-13T09:00:00.000Z';

/**
 * Build the ClientMap for one seeded household. `overviewFile` /
 * `accountsFile` are the workspace-relative document names actually written
 * for this household (accountsFile is null for light-tier households, which
 * fold accounts into the overview doc instead).
 */
export function buildClientMap(
  h: SeedHousehold,
  matterId: string,
  overviewFile: string,
  accountsFile: string | null,
): ClientMap {
  const moneyFile = accountsFile ?? overviewFile;

  const byKey: Record<CoreSectionKey, ClientMapItem[]> = {
    household: [
      mkItem(h.family || `${h.name} — household details on file.`, [doc(overviewFile, h.family || h.name)], SEED_TS),
      ...h.members
        .slice(0, 2)
        .map((m) => mkItem(memberLine(m), [doc(overviewFile, memberLine(m))], SEED_TS)),
      mkItem(
        `Segment: ${h.segment || 'unclassified'}. Risk tolerance: ${h.risk || 'unassessed'}. Custodian: ${h.custodian || 'unassigned'}.`,
        [doc(overviewFile, `Segment: ${h.segment || 'unclassified'}. Risk tolerance: ${h.risk || 'unassessed'}. Custodian: ${h.custodian || 'unassigned'}.`)],
        SEED_TS,
      ),
    ],
    goals: h.goals.length
      ? h.goals.map((g) => mkItem(g, [doc(overviewFile, g)], SEED_TS))
      : [mkItem('No goals recorded yet.', [doc(overviewFile, 'No goals recorded yet.')], SEED_TS)],
    money: [
      ...h.accounts.map((a) => mkItem(accountLine(a), [doc(moneyFile, accountLine(a))], SEED_TS)),
      ...(h.aumTotal !== null
        ? (() => {
            const line = `Total assets under management: approximately ${money(h.aumTotal)}.`;
            return [mkItem(line, [doc(moneyFile, line)], SEED_TS)];
          })()
        : []),
    ],
    followups: [
      ...h.storylines.map((s) => mkItem(storylineLine(s), [doc(overviewFile, storylineLine(s))], SEED_TS)),
      ...h.concerns.map((c) => mkItem(c, [doc(overviewFile, c)], SEED_TS)),
    ],
  };

  const sections: ClientMapSection[] = CORE_SECTION_ORDER.map((key) => ({
    id: key,
    kind: 'core' as const,
    key,
    title: CORE_SECTION_TITLE[key],
    items: byKey[key],
  }));

  const headline = h.goals[0] ?? (h.family || `${h.name} — profile on file.`);

  return {
    matterId,
    sections,
    completeness: {
      level: h.tier === 'full' ? 'solid' : 'getting-there',
      know: [mkItem(headline, [doc(overviewFile, headline)], SEED_TS)],
      assuming: [],
      ask: [],
    },
    pendingUpdates: [],
    lastBuiltAt: SEED_TS,
    lastSourceFingerprint: `web-ui-seed-${h.id}`,
  };
}
