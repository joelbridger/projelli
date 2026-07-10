export type AcatsExtractionMethod =
  | 'native-pdf'
  | 'ocr'
  | 'office'
  | 'manual'
  | 'advisor-edited';

export type AcatsRegistrationType =
  | 'individual'
  | 'joint'
  | 'trust'
  | 'traditional_ira'
  | 'roth_ira'
  | 'rollover_ira'
  | 'inherited_ira'
  | 'custodial'
  | 'tod'
  | 'unknown';

export type AcatsTaxStatus = 'taxable' | 'tax_deferred' | 'tax_free' | 'unknown';

export type AcatsTransferType = 'full' | 'partial' | 'unknown';

export type AcatsAssetAction = 'in_kind' | 'liquidate' | 'unknown';

export type AcatsReviewStatus = 'draft' | 'needs_review' | 'approved' | 'exported';

export type ExtractedField<T> = {
  value: T;
  confidence: number;
  source: {
    path: string;
    page?: number;
    textSnippet?: string;
    extraction: AcatsExtractionMethod;
  };
};

export type AcatsTransferDraft = {
  id: string;
  matterId: string;
  sourceStatementPath: string;
  sourceStatementDate?: ExtractedField<string>;
  deliveringFirm: {
    name?: ExtractedField<string>;
    normalizedName?: string;
    dtcNumber?: ExtractedField<string>;
    phone?: ExtractedField<string>;
    address?: ExtractedField<string>;
  };
  deliveringAccount: {
    accountNumber?: ExtractedField<string>;
    accountTitle?: ExtractedField<string>;
    registrationType?: ExtractedField<AcatsRegistrationType>;
    taxStatus?: ExtractedField<AcatsTaxStatus>;
    owners: ExtractedField<string>[];
  };
  receivingSchwabAccount: {
    accountNumber?: string;
    accountType?: string;
    registrationType?: string;
  };
  instruction: {
    transferType: AcatsTransferType;
    liquidateAll?: boolean;
    residualSweep?: boolean;
  };
  assets: Array<{
    description: ExtractedField<string>;
    symbol?: ExtractedField<string>;
    cusip?: ExtractedField<string>;
    quantity?: ExtractedField<string>;
    marketValue?: ExtractedField<string>;
    assetType?: ExtractedField<string>;
    action: AcatsAssetAction;
    warnings: string[];
  }>;
  missingFields: string[];
  warnings: string[];
  reviewStatus: AcatsReviewStatus;
};

export interface AcatsStatementTextPage {
  pageNumber: number;
  text: string;
  extraction: Extract<AcatsExtractionMethod, 'native-pdf' | 'ocr' | 'office'>;
  /** OCR mean confidence on a 0-100 scale when extraction is OCR. */
  ocrConfidence?: number;
}

