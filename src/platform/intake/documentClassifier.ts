import { classifyObservedKind } from './documentDetectiveRules';
import type {
  DocumentClassification,
  DocumentReadResult,
  IntakeDocumentSourceRef,
} from './documentExtractionTypes';

const OCR_LOW_CONFIDENCE = 60;
const SNIPPET_MAX_LENGTH = 180;

export interface ClassifyIntakeDocumentOptions {
  path: string;
  filename: string;
  readResult: DocumentReadResult;
}

function pageSnippet(text: string, signal: string): string {
  const matchIndex = text.toLowerCase().indexOf(signal.toLowerCase());
  if (matchIndex < 0) return '';
  const start = Math.max(0, matchIndex - Math.floor((SNIPPET_MAX_LENGTH - signal.length) / 2));
  return text.slice(start, start + SNIPPET_MAX_LENGTH).replace(/\s+/gu, ' ').trim();
}

function confidenceFor(
  kind: DocumentClassification['kind'],
  evidence: string[],
  readResult: Extract<DocumentReadResult, { status: 'read' }>,
): DocumentClassification['confidence'] {
  if (kind === 'unknown') return 'low';
  const ocrConfidences = readResult.pages
    .filter((page) => page.extraction === 'ocr')
    .map((page) => page.confidence ?? 0);
  if (ocrConfidences.some((confidence) => confidence < OCR_LOW_CONFIDENCE)) return 'low';
  if (ocrConfidences.length > 0) return 'medium';
  return evidence.length >= 2 ? 'high' : 'medium';
}

/**
 * Deterministic advisor-side classification only. It deliberately returns no
 * identifiers, paths to write, or fact kinds chosen from document content.
 */
export function classifyIntakeDocument(options: ClassifyIntakeDocumentOptions): DocumentClassification {
  if (options.readResult.status === 'unreadable') {
    return { kind: 'unknown', confidence: 'low', sourceRefs: [], evidence: [] };
  }

  const text = options.readResult.pages.map((page) => page.text).join('\n');
  const observed = classifyObservedKind(text, options.filename);
  const sourceRefs: IntakeDocumentSourceRef[] = [];
  for (const page of options.readResult.pages) {
    const signal = observed.evidence.find((candidate) => page.text.toLowerCase().includes(candidate.toLowerCase()));
    const snippet = signal ? pageSnippet(page.text, signal) : '';
    if (!signal || !snippet) continue;
    sourceRefs.push({
      kind: 'document',
      path: options.path,
      page: page.page,
      snippet,
      extraction: page.extraction,
      ...(page.confidence === undefined ? {} : { confidence: page.confidence }),
    });
  }

  return {
    kind: observed.kind,
    ...(observed.side === undefined ? {} : { side: observed.side }),
    confidence: confidenceFor(observed.kind, observed.evidence, options.readResult),
    sourceRefs,
    evidence: observed.evidence,
  };
}
