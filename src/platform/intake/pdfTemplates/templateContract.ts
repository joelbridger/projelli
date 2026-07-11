import type { FactKind } from '../types';

/** Only static forms and advisor-reviewed overlays are supported in Wave 8. */
export type PdfTemplateKind = 'acroform' | 'overlay';

/** A Wave 8 form can collect data, but it can never collect a signature. */
export type PdfFieldType =
  | 'text'
  | 'date'
  | 'checkbox'
  | 'number'
  | 'money'
  | 'radio'
  | 'select';

export interface PdfFieldOption {
  /** A reviewed structural choice, never a client-entered value. */
  value: string;
  label: string;
}

interface PdfFieldMapEntryBase {
  /** Stable identifier from the reviewed PDF/overlay map. */
  field_id: string;
  fact_kind?: FactKind;
  required?: boolean;
}

type PdfNonChoiceField = {
  pdf_field_type: Exclude<PdfFieldType, 'radio' | 'select'>;
  options?: never;
};

type PdfChoiceField = {
  pdf_field_type: Extract<PdfFieldType, 'radio' | 'select'>;
  options: PdfFieldOption[];
};

export type PdfAcroFormFieldMapEntry = PdfFieldMapEntryBase &
  (PdfNonChoiceField | PdfChoiceField) & {
    kind: 'acroform';
    /** The exact reviewed AcroForm widget name in this pinned PDF version. */
    acroform_field: string;
  };

export interface PdfOverlayRect {
  /** Normalized page coordinates. Every component is greater than zero. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PdfOverlayFont {
  /** Built-in local PDF font only. URLs and arbitrary font names are forbidden. */
  family: 'Helvetica' | 'Times-Roman' | 'Courier';
  size: number;
  color?: `#${string}`;
}

export type PdfOverlayFieldMapEntry = PdfFieldMapEntryBase &
  (PdfNonChoiceField | PdfChoiceField) & {
    kind: 'overlay';
    page: number;
    rect: PdfOverlayRect;
    font: PdfOverlayFont;
    alignment: 'left' | 'center' | 'right';
    /** Long answers wrap only in a reviewed box, or the client must stop. */
    overflow: 'wrap' | 'stop';
  };

export type PdfFieldMapEntry =
  | PdfAcroFormFieldMapEntry
  | PdfOverlayFieldMapEntry;

/** This map is sealed inside the checklist. It is never relay metadata. */
export type PdfFieldMap = Record<string, PdfFieldMapEntry>;

/**
 * Immutable sealed snapshot of one advisor-approved source PDF. A caller must
 * issue a new descriptor when the source bytes or reviewed map changes.
 */
export interface PdfTemplateDescriptor {
  templateId: string;
  version: number;
  kind: PdfTemplateKind;
  sourceSha256: string;
  /** Opaque sealed-artifact handle, never a URL or a filesystem path. */
  sourceArtifactRef: string;
  /** Safe code-generated stem, not a client-supplied output filename. */
  outputFileStem: string;
  /** Device-resource guard. Validation caps this at 50 MiB. */
  maxOutputBytes: number;
  fields: PdfFieldMap;
}

/** A sealed integrity record. It makes no signature or identity claim. */
export interface PdfCompletionReceipt {
  templateId: string;
  templateVersion: number;
  sourceSha256: string;
  completedSha256: string;
  completedAt: string;
  pageVersion: string;
}
