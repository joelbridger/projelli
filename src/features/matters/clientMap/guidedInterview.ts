// src/platform/clientMap/guidedInterview.ts
import type { ClientMap, GapQuestion } from '@/platform/clientMap/types';
import { useClientMapStore } from '@/platform/clientMap/clientMapStore';

function normalizeGap(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

function withoutResolvedGaps(map: ClientMap, gaps: GapQuestion[]): GapQuestion[] {
  const resolved = new Set((map.resolvedGaps ?? []).map(normalizeGap));
  return gaps.filter((g) => !resolved.has(normalizeGap(g.text)));
}

/**
 * `completeness.ask`, pruned of gaps the user has already answered or flagged
 * (tracked in `map.resolvedGaps`, BUG-106). This is what the "What I'm
 * missing" panel (D1) should render — `completeness.ask` itself is the raw
 * AI-detected gap list and is not re-filtered as gaps get resolved.
 */
export function unresolvedAskGaps(map: ClientMap): GapQuestion[] {
  return withoutResolvedGaps(map, map.completeness.ask);
}

/**
 * Returns the ordered list of gap questions for this map, each tagged with the
 * section its answer should file into. The `completeness.ask` list is the
 * primary source (already section-tagged). Empty custom sections contribute
 * their prompt as an additional question, tagged with that section's own key,
 * appended after the completeness gaps.
 *
 * BUG-106: gaps the user has already answered or flagged (tracked in
 * `map.resolvedGaps`) are pruned, so re-opening the Guided Interview does not
 * replay them; a still-populated custom section also drops out naturally.
 */
export function interviewQuestions(map: ClientMap): GapQuestion[] {
  const gaps: GapQuestion[] = map.completeness.ask.slice();
  for (const sec of map.sections) {
    if (sec.kind === 'custom' && sec.prompt && sec.items.length === 0) {
      gaps.push({ text: sec.prompt, sectionKey: sec.key });
    }
  }
  return withoutResolvedGaps(map, gaps);
}

/**
 * Records the user's answer to a gap question by adding a sovereign
 * (user-origin) item to the given section of the map. When the originating gap
 * text is supplied, the gap is marked resolved so the interview stops asking it
 * (BUG-106).
 */
export function answerQuestion(matterId: string, sectionKey: string, text: string, gapText?: string): void {
  useClientMapStore.getState().addUserItem(matterId, sectionKey, text);
  if (gapText !== undefined) useClientMapStore.getState().markGapResolved(matterId, gapText);
}

/**
 * Flags a question to ask the client by adding it to the per-matter
 * client-questions list, and marks the gap resolved so the interview stops
 * asking it (BUG-106).
 */
export function flagForClient(matterId: string, question: string): void {
  useClientMapStore.getState().addClientQuestion(matterId, question);
  useClientMapStore.getState().markGapResolved(matterId, question);
}
