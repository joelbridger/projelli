import { copyRequestBlueprint } from './blueprintValidation';
import type { RequestBlueprint } from './blueprintTypes';

const NEW_HOUSEHOLD_NEXT_STEP =
  'Your advisor reviews each item and follows up only if something needs a second look.';

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

/**
 * The first built-in blueprint. The copy is intentionally platform-owned so
 * the reusable blueprint registry never reaches upward into a feature module.
 */
export const NEW_HOUSEHOLD_BLUEPRINT: RequestBlueprint = deepFreeze({
  blueprintId: 'new_household_v1',
  schemaVersion: 1,
  label: 'New household',
  source: 'built_in',
  defaultKind: 'onboarding',
  items: [
    {
      t: 'readonly_card', item_id: 'welcome', label: 'Welcome', help_text: '', required: false, subject: 'household',
      body: 'This is your secure onboarding page with [firm_name]. We use it to collect the few things we need, show where you are in the process, and keep you clear on what happens next.\n\nStart with the first item below. You can come back to this page with the same link.',
    },
    {
      t: 'typed_field', item_id: 'dob', label: 'Date of birth', help_text: 'Use month, day, and year.', required: true, subject: 'primary', fact_kind: 'dob', input: 'date',
    },
    {
      t: 'typed_field', item_id: 'ssn', label: 'Social Security number', help_text: 'This is write-only. It is masked after you enter it.', required: true, subject: 'primary', fact_kind: 'ssn', input: 'ssn', placeholder: '•••-••-••••',
    },
    {
      t: 'doc_upload', item_id: 'drivers_license', label: "Driver's license", help_text: 'Upload the front and back. Phone photos are fine.', required: true, subject: 'primary', accepted_mime_types: ['image/jpeg', 'image/png', 'application/pdf'], max_files: 2, max_bytes: 100 * 1024 * 1024,
    },
    {
      t: 'guided_question', item_id: 'income', label: 'Income', help_text: "Share a number, a range, or say you don't know. You can add a pay stub or last year's tax return.", required: true, subject: 'household', prompt: 'What is your annual household income?', response_format: 'money', fact_kind: 'income_annual',
    },
    {
      t: 'guided_question', item_id: 'spending', label: 'Spending', help_text: 'A rough monthly guess is genuinely useful. You refine this together.', required: true, subject: 'household', prompt: 'About how much does your household spend each month?', response_format: 'range', fact_kind: 'spending_monthly',
    },
    {
      t: 'readonly_card', item_id: 'next', label: 'What happens next', help_text: '', required: false, subject: 'household',
      body: 'Our team is reviewing it now. If we need anything else, [support_first_name] will reach out.\n\nYou can return to this page to see where things stand.',
    },
  ],
});

export const NEW_HOUSEHOLD_NEXT_STEPS = [NEW_HOUSEHOLD_NEXT_STEP];

const BUILT_INS = [NEW_HOUSEHOLD_BLUEPRINT];

/** Returns a fresh copy so callers can never mutate a built-in blueprint. */
export function listBuiltInRequestBlueprints(): RequestBlueprint[] {
  return BUILT_INS.map(copyRequestBlueprint);
}

export function getBuiltInRequestBlueprint(blueprintId: string): RequestBlueprint | undefined {
  const blueprint = BUILT_INS.find((candidate) => candidate.blueprintId === blueprintId);
  return blueprint ? copyRequestBlueprint(blueprint) : undefined;
}
