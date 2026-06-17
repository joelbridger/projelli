// Analysis Types

/**
 * Structured summary of a document
 */
export interface DocSummary {
  doc_id: string;
  thesis: string;
  bullets: string[];
  assumptions: string[];
  risks: string[];
  open_questions: string[];
  actions: string[];
  confidence: number;
  citations: string[];
}
