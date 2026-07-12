import type {
  DocUploadRequestItem,
  GuidedQuestionRequestItem,
  ReadonlyCardRequestItem,
  RequestItem,
  TypedFieldRequestItem,
} from '../types';

export function newItemId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `item_${crypto.randomUUID()}`;
  }
  return `item_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function draftTypedField(): TypedFieldRequestItem {
  return {
    t: 'typed_field', item_id: newItemId(), label: '', help_text: '', required: false, subject: 'primary',
    fact_kind: 'dob', input: 'date',
  };
}

export function draftDocUpload(): DocUploadRequestItem {
  return {
    t: 'doc_upload', item_id: newItemId(), label: '', help_text: '', required: false, subject: 'primary',
    accepted_mime_types: ['image/jpeg', 'image/png', 'application/pdf'], max_files: 1, max_bytes: 100 * 1024 * 1024,
  };
}

export function draftGuidedQuestion(): GuidedQuestionRequestItem {
  return {
    t: 'guided_question', item_id: newItemId(), label: '', help_text: '', required: false, subject: 'primary',
    prompt: '', response_format: 'money',
  };
}

export function draftWelcomeCard(body = ''): ReadonlyCardRequestItem {
  return {
    t: 'readonly_card', item_id: `welcome_${newItemId()}`, label: 'Welcome', help_text: '', required: false, subject: 'primary', body,
  };
}

export function moveItem(items: RequestItem[], index: number, direction: 'up' | 'down'): RequestItem[] {
  const target = direction === 'up' ? index - 1 : index + 1;
  if (index < 0 || index >= items.length || target < 0 || target >= items.length) return [...items];
  const moved = [...items];
  const a = moved[index];
  const b = moved[target];
  if (a === undefined || b === undefined) return [...items];
  moved[index] = b;
  moved[target] = a;
  return moved;
}

export function insertItem(items: RequestItem[], index: number, item: RequestItem): RequestItem[] {
  const next = [...items];
  next.splice(Math.max(0, Math.min(index, next.length)), 0, item);
  return next;
}

export function removeItem(items: RequestItem[], itemId: string): RequestItem[] {
  return items.filter((item) => item.item_id !== itemId);
}
