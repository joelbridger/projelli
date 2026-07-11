import type { DocumentKind } from './documentDetectiveTypes';
import type { PdfTemplateDescriptor } from './pdfTemplates/templateContract';

export type {
  PdfCompletionReceipt,
  PdfFieldMap,
  PdfFieldMapEntry,
  PdfFieldType,
  PdfTemplateDescriptor,
  PdfTemplateKind,
} from './pdfTemplates/templateContract';

export type FactKind =
  | 'dob'
  | 'ssn'
  | 'income_annual'
  | 'spending_monthly'
  | 'drivers_license'
  | 'address'
  | 'citizenship'
  | 'employer'
  | 'beneficiary';

export type FactValue =
  | { t: 'date'; v: string }
  | { t: 'string'; v: string }
  | { t: 'money'; v: { amount: number; currency: string } }
  | { t: 'range'; v: { min?: number; max?: number; unit?: string; currency?: string } }
  | { t: 'doc_ref'; v: { path: string; page?: number; content_type?: string } };

export type Sensitivity = 'restricted' | 'confidential' | 'standard';

export const FACT_KIND_SENSITIVITY: Record<FactKind, Sensitivity> = {
  dob: 'confidential',
  ssn: 'restricted',
  income_annual: 'confidential',
  spending_monthly: 'confidential',
  drivers_license: 'restricted',
  address: 'standard',
  citizenship: 'standard',
  employer: 'standard',
  beneficiary: 'confidential',
};

export interface ClientFact {
  fact_id: string;
  matter_id: string;
  subject: string;
  kind: FactKind;
  value: FactValue;
  sensitivity: 'restricted' | 'confidential' | 'standard';
  provenance: {
    channel: 'intake_link' | 'email_reply' | 'phone_walkthrough' | 'doc_extraction' | 'manual';
    source_ref?: string;
    // Contract mirrors ARCHITECTURE §9: the literal marks client-entered facts.
    // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
    entered_by: 'client' | string;
    confirmed_by?: string;
    at: string;
  };
  verification: 'client_stated' | 'document_verified' | 'advisor_confirmed';
  status: 'active' | 'superseded';
  superseded_by?: string;
}

export type FormRequestKind = 'onboarding' | 'standing';

export interface FormRequest {
  request_id: string;
  schema_version: number;
  matter_id: string;
  kind: FormRequestKind;
  blueprint_ref?: string;
  items: RequestItem[];
}

export type RequestItemType =
  | 'typed_field'
  | 'doc_upload'
  | 'guided_question'
  | 'readonly_card'
  | 'pdf_fill'
  | 'signature';

export interface RequestItemBase {
  t: RequestItemType;
  item_id: string;
  label: string;
  help_text: string;
  required: boolean;
  subject: string;
}

export type TypedFieldInputFormat =
  | 'date'
  | 'ssn'
  | 'money'
  | 'number'
  | 'text'
  | 'textarea'
  | 'file_ref'
  | 'select';

export interface TypedFieldRequestItem extends Omit<RequestItemBase, 't'> {
  t: 'typed_field';
  fact_kind: FactKind;
  input: TypedFieldInputFormat;
  placeholder?: string;
}

export interface DocUploadRequestItem extends Omit<RequestItemBase, 't'> {
  t: 'doc_upload';
  accepted_mime_types?: string[];
  max_files?: number;
  max_bytes?: number;
  expected_doc_types?: DocumentKind[];
  expected_license_slots?: Array<'front' | 'back'>;
}

export type GuidedQuestionResponseFormat = 'number' | 'money' | 'range' | 'text' | 'choice';

export interface GuidedQuestionRequestItem extends Omit<RequestItemBase, 't'> {
  t: 'guided_question';
  prompt: string;
  response_format: GuidedQuestionResponseFormat;
  choices?: Array<{ value: string; label: string }>;
  /** Optional for legacy onboarding items; new request items set this when they write a fact. */
  fact_kind?: FactKind;
}

export interface ReadonlyCardRequestItem extends Omit<RequestItemBase, 't'> {
  t: 'readonly_card';
  body: string;
  acknowledgement_required?: boolean;
}

export interface PdfFillRequestItem extends Omit<RequestItemBase, 't'> {
  t: 'pdf_fill';
  /** Immutable, sealed-by-value approval snapshot. Never a live library reference. */
  template: PdfTemplateDescriptor;
  prefill: PdfPrefill[];
  /** Base64 source PDF bytes for an issued request only. Populate at compose/send time, never in a persisted reusable blueprint. */
  sealed_source_pdf_b64?: string;
}

export interface SignatureRequestItem extends Omit<RequestItemBase, 't'> {
  t: 'signature';
  grade: 'docusign' | 'native_clicksign';
  document_ref?: string;
}

export type RequestItem =
  | TypedFieldRequestItem
  | DocUploadRequestItem
  | GuidedQuestionRequestItem
  | ReadonlyCardRequestItem
  | PdfFillRequestItem
  | SignatureRequestItem;

export type PrefillMode = 'blank' | 'hidden_confirm' | 'visible_prefill';

interface PdfPrefillCommon {
  field_id: string;
  fact_id?: string;
  fact_kind: FactKind;
}

type HiddenPrefillMode = Exclude<PrefillMode, 'visible_prefill'>;
type LinkVisibleSensitivity = Exclude<Sensitivity, 'restricted'>;

export type PdfPrefill =
  | (PdfPrefillCommon & {
      sensitivity: 'restricted';
      mode: HiddenPrefillMode;
      value_page_ciphertext?: never;
    })
  | (PdfPrefillCommon & {
      sensitivity: LinkVisibleSensitivity;
      mode: 'visible_prefill';
      value_page_ciphertext: string;
    })
  | (PdfPrefillCommon & {
      sensitivity: LinkVisibleSensitivity;
      mode: HiddenPrefillMode;
      value_page_ciphertext?: never;
    });

export function assertPrefillLegal(p: PdfPrefill): void {
  const incoming = p as { sensitivity: Sensitivity; mode: PrefillMode };
  if (incoming.sensitivity === 'restricted' && incoming.mode === 'visible_prefill') {
    throw new Error('Restricted facts can never be sent as visible prefills.');
  }
}
