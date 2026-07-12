import type { FactValue } from './types';
import type { DocumentKind, LicenseSide } from './documentDetectiveTypes';

export interface IntakeDocumentSourceRef {
  kind: 'document';
  /** Workspace path, always confined to the matched client folder. */
  path: string;
  /** One-based document page number. */
  page?: number;
  snippet: string;
  extraction?: 'text' | 'ocr';
  /** Mean OCR word confidence on the 0-100 scale. */
  confidence?: number;
}

export type DocumentReadResult =
  | {
      status: 'read';
      pages: Array<{
        page: number;
        text: string;
        extraction: 'text' | 'ocr';
        confidence?: number;
      }>;
    }
  | { status: 'unreadable'; reason: string };

export interface DocumentClassification {
  kind: DocumentKind;
  side?: LicenseSide;
  confidence: 'high' | 'medium' | 'low';
  sourceRefs: IntakeDocumentSourceRef[];
  evidence: string[];
}

/** Shared Lane 2/3 contract. Lane 2 only reads and classifies, never writes one. */
export interface DocumentExtractionProposal {
  proposal_id: string;
  matter_id: string;
  request_id: string;
  intake_id: string;
  item_id?: string;
  source: IntakeDocumentSourceRef;
  kind: 'classification' | 'fact';
  fact_kind?: 'income_annual' | 'spending_monthly';
  proposed_value?: FactValue;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
  status: 'pending' | 'accepted' | 'dismissed' | 'stale' | 'failed';
  created_at: string;
}

export type { DocumentKind, LicenseSide };
