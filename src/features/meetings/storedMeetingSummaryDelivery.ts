import type { DocxTextExtraction } from '@/platform/utils/docx-io';
import type { MeetingEntryHostIdentity } from './meetingEntryHostIdentity';
import type { SealedMeetingClientBoundary } from './foundation/contract';

export interface StoredMeetingSummaryContent {
  readonly summary?: string;
  readonly decisions: readonly string[];
  readonly personalNotes: readonly string[];
}

export interface StoredMeetingSummaryDelivery {
  readonly content: StoredMeetingSummaryContent;
  readonly reviewState: 'needs-review';
}

const EMPTY_CONTENT: StoredMeetingSummaryContent = Object.freeze({
  decisions: [],
  personalNotes: [],
});

function cleanLine(line: string): string {
  return line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim();
}

type SummarySection = 'summary' | 'decisions' | 'personalNotes' | 'ignored';

function headingName(line: string): SummarySection | null {
  const heading = line
    .trim()
    .replace(/^#{1,6}\s*/, '')
    .replace(/:$/, '')
    .trim()
    .toLowerCase();
  if (heading === 'summary' || heading === 'what changed') return 'summary';
  if (heading === 'decisions') return 'decisions';
  if (
    heading === 'personal notes' ||
    heading === 'personal updates' ||
    heading === 'facts worth keeping'
  ) {
    return 'personalNotes';
  }
  if (heading === 'action items' || heading === 'follow-ups') return 'ignored';
  return null;
}

/**
 * Projects the advisor's existing notes document into the Summary tab's three
 * displayed sections. This reads no files: the guarded detail host has already
 * established the exact client/meeting target and extracted the document.
 */
export function structuredSummaryFromStoredNotes(
  value: string
): StoredMeetingSummaryContent {
  const text = value.trim();
  if (!text) return EMPTY_CONTENT;
  const sections: Record<SummarySection, string[]> = {
    summary: [],
    decisions: [],
    personalNotes: [],
    ignored: [],
  };
  let current: SummarySection | null = null;
  let foundHeading = false;
  for (const rawLine of text.replace(/\r/g, '').split('\n')) {
    const heading = headingName(rawLine);
    if (heading) {
      current = heading;
      foundHeading = true;
      continue;
    }
    const line = cleanLine(rawLine);
    if (line && current) sections[current].push(line);
  }
  if (!foundHeading) {
    return { summary: text, decisions: [], personalNotes: [] };
  }

  const summary = sections.summary.join('\n').trim();
  return {
    ...(summary ? { summary } : {}),
    decisions: sections.decisions,
    personalNotes: sections.personalNotes,
  };
}

function sameBoundary(
  left: Pick<SealedMeetingClientBoundary, 'householdRef' | 'matterId'>,
  right: Pick<SealedMeetingClientBoundary, 'householdRef' | 'matterId'>
): boolean {
  return (
    left.householdRef === right.householdRef && left.matterId === right.matterId
  );
}

function hasContent(content: StoredMeetingSummaryContent): boolean {
  return Boolean(
    content.summary || content.decisions.length || content.personalNotes.length
  );
}

/**
 * Delivers a stored notes.docx summary only after the F11 host has proved its
 * sealed household/matter pair. A folder path or a raw extracted document is
 * never enough to make a summary ready.
 */
export function deliverStoredMeetingSummary(input: {
  readonly hostIdentity?: MeetingEntryHostIdentity | undefined;
  readonly clientBoundary?: SealedMeetingClientBoundary | null | undefined;
  readonly extraction: DocxTextExtraction | null;
}): StoredMeetingSummaryDelivery | null {
  const { hostIdentity, clientBoundary, extraction } = input;
  if (!hostIdentity || !clientBoundary || !extraction) return null;
  if (!sameBoundary(hostIdentity.clientBoundary, clientBoundary)) return null;
  if (
    hostIdentity.canonicalMeeting &&
    !sameBoundary(hostIdentity.canonicalMeeting, clientBoundary)
  ) {
    return null;
  }

  const content = structuredSummaryFromStoredNotes(extraction.plainText);
  return hasContent(content) ? { content, reviewState: 'needs-review' } : null;
}
