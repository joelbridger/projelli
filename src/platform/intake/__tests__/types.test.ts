import { describe, expect, it } from 'vitest';

import {
  FACT_KIND_SENSITIVITY,
  assertPrefillLegal,
  type ClientFact,
  type FormRequest,
  type PdfPrefill,
  type RequestItem,
} from '@/platform/intake/types';

describe('intake fact and request contracts', () => {
  it('locks the sensitivity tier for every Wave 1 fact kind', () => {
    expect(FACT_KIND_SENSITIVITY).toEqual({
      dob: 'confidential',
      ssn: 'restricted',
      income_annual: 'confidential',
      spending_monthly: 'confidential',
      drivers_license: 'restricted',
      address: 'standard',
      citizenship: 'standard',
      employer: 'standard',
      beneficiary: 'confidential',
    });
  });

  it('accepts the ClientFact shape from the architecture contract', () => {
    const fact: ClientFact = {
      fact_id: 'fact-1',
      matter_id: 'matter-1',
      subject: 'primary',
      kind: 'ssn',
      value: { t: 'string', v: '123-45-6789' },
      sensitivity: 'restricted',
      provenance: {
        channel: 'intake_link',
        source_ref: 'item-ssn',
        entered_by: 'client',
        at: '2026-07-10T00:00:00.000Z',
      },
      verification: 'client_stated',
      status: 'active',
    };

    expect(fact.matter_id).toBe('matter-1');
    expect(fact.kind).toBe('ssn');
  });

  it('declares every request item type needed by later waves', () => {
    const items: RequestItem[] = [
      {
        t: 'typed_field',
        item_id: 'dob',
        label: 'Date of birth',
        help_text: 'Use the date on your government ID.',
        required: true,
        subject: 'primary',
        fact_kind: 'dob',
        input: 'date',
      },
      {
        t: 'doc_upload',
        item_id: 'license',
        label: 'Driver license photos',
        help_text: 'Add the front and back.',
        required: true,
        subject: 'primary',
        accepted_mime_types: ['image/jpeg', 'image/png'],
        max_files: 2,
      },
      {
        t: 'guided_question',
        item_id: 'spending',
        label: 'Monthly spending',
        help_text: 'An estimate is fine.',
        required: false,
        subject: 'household',
        prompt: 'About how much do you spend each month?',
        response_format: 'money',
      },
      {
        t: 'readonly_card',
        item_id: 'next',
        label: 'What happens next',
        help_text: 'Review this before you finish.',
        required: false,
        subject: 'household',
        body: 'Your advisor will review these items.',
      },
      {
        t: 'pdf_fill',
        item_id: 'schwab',
        label: 'Custodian form',
        help_text: 'Review the filled fields.',
        required: true,
        subject: 'primary',
        template: {
          templateId: 'template_types_01',
          version: 1,
          kind: 'acroform',
          sourceSha256: 'a'.repeat(64),
          sourceArtifactRef: 'sealed-artifact:typestemplate0001',
          outputFileStem: 'custodian-form',
          maxOutputBytes: 1024 * 1024,
          fields: {
            dob_field: {
              kind: 'acroform', field_id: 'dob_field', fact_kind: 'dob',
              acroform_field: 'Date.Of.Birth', pdf_field_type: 'date',
            },
          },
        },
        prefill: [
          {
            field_id: 'dob_field',
            fact_id: 'fact-dob',
            fact_kind: 'dob',
            sensitivity: 'confidential',
            mode: 'hidden_confirm',
          },
        ],
      },
      {
        t: 'signature',
        item_id: 'sign',
        label: 'Signature',
        help_text: 'Sign after review.',
        required: true,
        subject: 'primary',
        grade: 'native_clicksign',
      },
    ];

    const request: FormRequest = {
      request_id: 'intake-1',
      schema_version: 1,
      matter_id: 'matter-1',
      kind: 'onboarding',
      blueprint_ref: 'new-household',
      items,
    };

    expect(request.items.map((item) => item.t)).toEqual([
      'typed_field',
      'doc_upload',
      'guided_question',
      'readonly_card',
      'pdf_fill',
      'signature',
    ]);
  });

  it('rejects restricted visible prefills at runtime and at the type level', () => {
    // @ts-expect-error restricted prefills must never be visible in a link.
    const illegalPrefill: PdfPrefill = {
      field_id: 'ssn_field',
      fact_id: 'fact-ssn',
      fact_kind: 'ssn',
      sensitivity: 'restricted',
      mode: 'visible_prefill',
      value_page_ciphertext: 'sealed-value',
    };

    expect(() => {
      assertPrefillLegal(illegalPrefill);
    }).toThrow(/restricted/i);

    const legalPrefill: PdfPrefill = {
      field_id: 'ssn_field',
      fact_id: 'fact-ssn',
      fact_kind: 'ssn',
      sensitivity: 'restricted',
      mode: 'hidden_confirm',
    };

    expect(() => {
      assertPrefillLegal(legalPrefill);
    }).not.toThrow();
  });
});
