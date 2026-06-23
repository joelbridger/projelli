// src/platform/clientMap/completeness.ts
import type { ClientMapSection, ClientMapItem, ContextCompleteness, CompletenessLevel, GapQuestion } from './types';

export function deriveCompleteness(sections: ClientMapSection[], ask: GapQuestion[]): ContextCompleteness {
  const all: ClientMapItem[] = sections.flatMap((s) => s.items);
  const know = all.filter((i) => !i.isAssumption && i.sources.length > 0);
  const assuming = all.filter((i) => i.isAssumption);
  let level: CompletenessLevel;
  if (know.length < 3 || assuming.length > know.length) level = 'thin';
  else if (know.length >= 8 && assuming.length <= 2 && ask.length <= 2) level = 'solid';
  else level = 'getting-there';
  return { level, know, assuming, ask };
}
