import type { FactKind, RequestItem } from './types';
import type { FactMatchEntry } from './factsStore';

export interface AskOnceSuppression {
  itemId: string;
  reason: 'already_on_file';
}

export interface AskOnceResolution {
  visibleItems: RequestItem[];
  suppressed: AskOnceSuppression[];
}

function factKindForRequestItem(item: RequestItem): FactKind | null {
  if (item.t === 'typed_field') return item.fact_kind;
  if (item.t === 'guided_question') return item.fact_kind ?? null;
  return null;
}

/**
 * Resolve the checklist without looking at a fact value. Only explicit item
 * mappings qualify: the same subject and the same fact kind must both match.
 */
export function resolveAskOnce(
  items: RequestItem[],
  matches: FactMatchEntry[],
): AskOnceResolution {
  const activeMatches = new Set(
    matches
      .filter((match) => match.status === 'active')
      .map((match) => `${match.subject}\u0000${match.kind}`),
  );
  const visibleItems: RequestItem[] = [];
  const suppressed: AskOnceSuppression[] = [];

  for (const item of items) {
    const factKind = factKindForRequestItem(item);
    if (factKind && activeMatches.has(`${item.subject}\u0000${factKind}`)) {
      suppressed.push({ itemId: item.item_id, reason: 'already_on_file' });
      continue;
    }
    visibleItems.push(item);
  }
  return { visibleItems, suppressed };
}
