// src/platform/clientMap/guidedInterview.ts
import type { ClientMap, GapQuestion } from './types';
import { useClientMapStore } from './clientMapStore';

/**
 * Returns the ordered list of gap questions for this map, each tagged with the
 * section its answer should file into. The `completeness.ask` list is the
 * primary source (already section-tagged). Empty custom sections contribute
 * their prompt as an additional question, tagged with that section's own key,
 * appended after the completeness gaps.
 */
export function interviewQuestions(map: ClientMap): GapQuestion[] {
  const gaps: GapQuestion[] = map.completeness.ask.slice();
  for (const sec of map.sections) {
    if (sec.kind === 'custom' && sec.prompt && sec.items.length === 0) {
      gaps.push({ text: sec.prompt, sectionKey: sec.key });
    }
  }
  return gaps;
}

/**
 * Records the user's answer to a gap question by adding a sovereign
 * (user-origin) item to the given section of the map.
 */
export function answerQuestion(matterId: string, sectionKey: string, text: string): void {
  useClientMapStore.getState().addUserItem(matterId, sectionKey, text);
}

/**
 * Flags a question to ask the client by adding it to the per-matter
 * client-questions list.
 */
export function flagForClient(matterId: string, question: string): void {
  useClientMapStore.getState().addClientQuestion(matterId, question);
}
