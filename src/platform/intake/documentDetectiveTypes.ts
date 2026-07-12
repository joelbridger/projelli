export type DocumentKind =
  | 'drivers_license'
  | 'tax_return'
  | 'pay_stub'
  | 'bank_statement'
  | 'brokerage_statement'
  | 'ira_statement'
  | 'credit_card_statement'
  | 'other_financial'
  | 'unknown';

export type LicenseSide = 'front' | 'back' | 'unknown';

export type Tier1WarningReason =
  | 'wrong_doc'
  | 'wrong_side_of_license'
  | 'duplicate_license_side'
  | 'unsupported_or_unreadable';

export type ExpectedDocument = { kind: DocumentKind; side?: 'front' | 'back' };

export interface Tier1ClassifyInput {
  item: {
    item_id: string;
    label: string;
    help_text?: string;
    expected_doc_types?: DocumentKind[];
    expected_license_slots?: Array<'front' | 'back'>;
  };
  slotIndex: number;
  slotRole: 'front' | 'back' | 'file';
  file: { name: string; mimeType: string; byteSize: number; textSample?: string };
  siblingLicenseSide?: LicenseSide;
}

export type Tier1Classification =
  | { verdict: 'ok'; observed: DocumentKind; side?: LicenseSide; evidence: string[] }
  | {
      verdict: 'warn';
      reason: Tier1WarningReason;
      expected: ExpectedDocument;
      observed: DocumentKind;
      side?: LicenseSide;
      evidence: string[];
    }
  | { verdict: 'unknown'; evidence: string[] };

export type { DocumentDetectiveManifestEntry } from './intakeContract';
