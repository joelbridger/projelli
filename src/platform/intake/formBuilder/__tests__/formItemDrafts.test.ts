import { describe, expect, it } from 'vitest';

import { assertValidRequestBlueprint } from '../../blueprintValidation';
import type { RequestItem } from '../../types';
import {
  draftDocUpload,
  draftGuidedQuestion,
  draftTypedField,
  draftWelcomeCard,
  insertItem,
  moveItem,
  newItemId,
  removeItem,
} from '../formItemDrafts';

function valid(items: RequestItem[]) {
  return {
    blueprintId: 'draft-test', schemaVersion: 1, label: 'Draft test', source: 'firm_saved' as const,
    defaultKind: 'standing' as const,
    items: items.map((item, index) => ({ ...item, label: `Item ${String(index + 1)}` })),
  };
}

describe('form item drafts', () => {
  it('makes structurally valid drafts for every supported item kind', () => {
    const items = [draftTypedField(), draftDocUpload(), draftGuidedQuestion(), draftWelcomeCard()];
    expect(() => {
      assertValidRequestBlueprint(valid(items));
    }).not.toThrow();
    expect(items.map((item) => item.t)).toEqual(['typed_field', 'doc_upload', 'guided_question', 'readonly_card']);
    expect(draftDocUpload().accepted_mime_types).toEqual(['image/jpeg', 'image/png', 'application/pdf']);
    expect(draftTypedField()).toMatchObject({ fact_kind: 'dob', input: 'date', subject: 'primary' });
    expect(draftGuidedQuestion()).toMatchObject({ response_format: 'money' });
    expect(draftWelcomeCard('Hello')).toMatchObject({ label: 'Welcome', body: 'Hello' });
    expect(draftWelcomeCard().item_id.toLowerCase()).toContain('welcome');
  });

  it('makes unique ids and never creates excluded item kinds', () => {
    const ids = Array.from({ length: 100 }, () => newItemId());
    expect(new Set(ids).size).toBe(ids.length);
    const drafts: RequestItem[] = [draftTypedField(), draftDocUpload(), draftGuidedQuestion(), draftWelcomeCard()];
    expect(drafts.some((item) => item.t === 'pdf_fill' || item.t === 'signature')).toBe(false);
  });

  it('moves, inserts, and removes without mutating its input', () => {
    const first = { ...draftTypedField(), label: 'First' };
    const second = { ...draftDocUpload(), label: 'Second' };
    const third = { ...draftGuidedQuestion(), label: 'Third' };
    const items: RequestItem[] = [first, second];
    expect(moveItem(items, 0, 'up')).toEqual(items);
    expect(moveItem(items, 1, 'down')).toEqual(items);
    expect(moveItem(items, 0, 'down').map((item) => item.label)).toEqual(['Second', 'First']);
    expect(insertItem(items, 1, third).map((item) => item.label)).toEqual(['First', 'Third', 'Second']);
    expect(removeItem(items, first.item_id).map((item) => item.label)).toEqual(['Second']);
    expect(removeItem(items, 'not-here')).toEqual(items);
    expect(items.map((item) => item.label)).toEqual(['First', 'Second']);
  });
});
