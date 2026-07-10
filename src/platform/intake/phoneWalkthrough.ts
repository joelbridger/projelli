import type { IntakeFactUpsertInput } from './factsStore';
import type { IntakeChecklistState } from './intakeStore';
import {
  FACT_KIND_SENSITIVITY,
  type FactKind,
  type FactValue,
  type RequestItem,
} from './types';

export interface PhoneWalkthroughItem {
  item: RequestItem;
  checklist: IntakeChecklistState;
  state: IntakeChecklistState['state'];
  completed: boolean;
  canReplace: boolean;
}

export type PhoneWalkthroughAnswer = string | {
  min?: string | number;
  max?: string | number;
  currency?: string;
  mode?: 'unknown';
};

const COMPLETED_STATES = new Set<IntakeChecklistState['state']>([
  'provided',
  'received',
  'accepted',
  'not_needed',
]);

export function derivePhoneWalkthroughItems(
  requestItems: RequestItem[],
  checklist: IntakeChecklistState[],
): PhoneWalkthroughItem[] {
  return requestItems.map((item) => {
    const existing = checklist.find((candidate) => candidate.itemId === item.item_id);
    const itemState = existing ?? {
      itemId: item.item_id,
      label: item.label,
      state: 'not_started' as const,
    };
    const completed = COMPLETED_STATES.has(itemState.state);
    return {
      item,
      checklist: itemState,
      state: itemState.state,
      completed,
      canReplace: completed && item.t !== 'readonly_card',
    };
  });
}

export function factKindForPhoneItem(item: RequestItem): FactKind | null {
  if (item.t === 'typed_field') return item.fact_kind;
  if (item.t === 'doc_upload') return item.item_id === 'drivers_license' ? 'drivers_license' : null;
  if (item.t !== 'guided_question') return null;
  if (item.item_id === 'income') return 'income_annual';
  if (item.item_id === 'spending') return 'spending_monthly';
  return null;
}

function numberValue(value: string | number | undefined): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/[$,\s]/gu, '');
  if (!/^-?(?:\d+|\d*\.\d+)$/u.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function stringValue(value: PhoneWalkthroughAnswer): string {
  if (typeof value === 'string') return value.trim();
  return value.mode === 'unknown' ? "I don't know yet" : '';
}

export function phoneFactValue(
  item: RequestItem,
  answer: PhoneWalkthroughAnswer,
): FactValue {
  const kind = factKindForPhoneItem(item);
  if (!kind) throw new Error('This checklist item does not write a client fact.');
  if (typeof answer !== 'string' && answer.mode === 'unknown') {
    return { t: 'string', v: "I don't know yet" };
  }
  if (kind === 'dob') return { t: 'date', v: stringValue(answer) };
  if (item.t === 'guided_question' && item.response_format === 'range') {
    const range = typeof answer === 'string' ? {} : answer;
    const min = numberValue(range.min);
    const max = numberValue(range.max);
    if (min == null && max == null) throw new Error('Enter at least one end of the range.');
    return {
      t: 'range',
      v: {
        ...(min != null ? { min } : {}),
        ...(max != null ? { max } : {}),
        ...(range.currency?.trim() ? { currency: range.currency.trim().toUpperCase() } : {}),
      },
    };
  }
  if (
    (item.t === 'guided_question' && item.response_format === 'money') ||
    (item.t === 'typed_field' && item.input === 'money')
  ) {
    const amount = numberValue(typeof answer === 'string' ? answer : undefined);
    if (amount == null) throw new Error('Enter an amount.');
    return { t: 'money', v: { amount, currency: 'USD' } };
  }
  return { t: 'string', v: stringValue(answer) };
}

export function buildPhoneFactWrite(input: {
  matterId: string;
  item: RequestItem;
  answer: PhoneWalkthroughAnswer;
  advisorId: string;
  at: string;
}): IntakeFactUpsertInput {
  const kind = factKindForPhoneItem(input.item);
  if (!kind) throw new Error('This checklist item does not write a client fact.');
  return {
    matter_id: input.matterId,
    subject: input.item.subject || 'primary',
    kind,
    value: phoneFactValue(input.item, input.answer),
    sensitivity: FACT_KIND_SENSITIVITY[kind],
    provenance: {
      channel: 'phone_walkthrough',
      source_ref: input.item.item_id,
      entered_by: input.advisorId,
      at: input.at,
    },
    verification: 'advisor_confirmed',
  };
}
