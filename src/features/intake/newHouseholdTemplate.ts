import type { FormRequest, RequestItem } from '@/platform/intake/types';

export const NEW_HOUSEHOLD_BLUEPRINT = 'new_household_v1';

export function defaultNewHouseholdItems(): RequestItem[] {
  return [
    {
      t: 'readonly_card',
      item_id: 'welcome',
      label: 'Welcome',
      help_text: '',
      required: false,
      subject: 'household',
      body: 'Seven short steps and a few documents. Stop anytime and pick up where you left off.',
    },
    {
      t: 'typed_field',
      item_id: 'dob',
      label: 'Date of birth',
      help_text: 'Use month, day, and year.',
      required: true,
      subject: 'primary',
      fact_kind: 'dob',
      input: 'date',
    },
    {
      t: 'typed_field',
      item_id: 'ssn',
      label: 'Social Security number',
      help_text: 'This is write-only. It is masked after you enter it.',
      required: true,
      subject: 'primary',
      fact_kind: 'ssn',
      input: 'ssn',
      placeholder: '•••-••-••••',
    },
    {
      t: 'doc_upload',
      item_id: 'drivers_license',
      label: "Driver's license",
      help_text: 'Upload the front and back. Phone photos are fine.',
      required: true,
      subject: 'primary',
      accepted_mime_types: ['image/jpeg', 'image/png', 'application/pdf'],
      max_files: 2,
      max_bytes: 100 * 1024 * 1024,
    },
    {
      t: 'guided_question',
      item_id: 'income',
      label: 'Income',
      help_text: "Share a number, a range, or say you don't know. You can add a pay stub or last year's tax return.",
      required: true,
      subject: 'household',
      prompt: 'What is your annual household income?',
      response_format: 'money',
    },
    {
      t: 'guided_question',
      item_id: 'spending',
      label: 'Spending',
      help_text: 'A rough monthly guess is genuinely useful. You refine this together.',
      required: true,
      subject: 'household',
      prompt: 'About how much does your household spend each month?',
      response_format: 'range',
    },
    {
      t: 'readonly_card',
      item_id: 'next',
      label: 'What happens next',
      help_text: '',
      required: false,
      subject: 'household',
      body: 'Your advisor reviews each item and follows up only if something needs a second look.',
    },
  ];
}

export function buildNewHouseholdRequest(args: {
  requestId: string;
  matterId: string;
  items?: RequestItem[];
}): FormRequest {
  return {
    request_id: args.requestId,
    schema_version: 1,
    matter_id: args.matterId,
    kind: 'onboarding',
    blueprint_ref: NEW_HOUSEHOLD_BLUEPRINT,
    items: args.items ?? defaultNewHouseholdItems(),
  };
}
