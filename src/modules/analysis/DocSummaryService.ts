// Doc Summary Service
// Generates structured summaries from documents using AI

import type { DocSummary } from '@/types/analysis';
import type { Provider, StructuredOutputOptions, OutputSchema } from '@/modules/models/Provider';

/**
 * Schema for DocSummary validation
 */
const DOC_SUMMARY_SCHEMA: OutputSchema = {
  type: 'object',
  properties: {
    thesis: {
      type: 'string',
      description: 'The main thesis or central argument of the document',
    },
    bullets: {
      type: 'array',
      items: { type: 'string' },
      description: 'Key points summarized as bullet points',
    },
    assumptions: {
      type: 'array',
      items: { type: 'string' },
      description: 'Explicit and implicit assumptions made in the document',
    },
    risks: {
      type: 'array',
      items: { type: 'string' },
      description: 'Identified risks or potential problems',
    },
    open_questions: {
      type: 'array',
      items: { type: 'string' },
      description: 'Unanswered questions that need further investigation',
    },
    actions: {
      type: 'array',
      items: { type: 'string' },
      description: 'Recommended action items or next steps',
    },
    confidence: {
      type: 'number',
      description: 'Confidence score between 0 and 1',
    },
    citations: {
      type: 'array',
      items: { type: 'string' },
      description: 'Source card IDs referenced in the document',
    },
  },
  required: ['thesis', 'bullets', 'assumptions', 'risks', 'open_questions', 'actions', 'confidence', 'citations'],
};

/**
 * Options for generating a summary
 */
export interface GenerateSummaryOptions {
  /**
   * Include citation analysis
   */
  includeCitations?: boolean;

  /**
   * Maximum bullets to extract
   */
  maxBullets?: number;

  /**
   * Focus on specific aspects (assumptions, risks, etc.)
   */
  focus?: ('assumptions' | 'risks' | 'actions' | 'questions')[];
}

/**
 * DocSummaryService generates structured summaries from documents
 */
export class DocSummaryService {
  private summaries: Map<string, DocSummary> = new Map();
  private readonly storageKey: string;

  constructor(
    private readonly provider: Provider,
    workspaceId: string = 'default'
  ) {
    this.storageKey = `doc_summaries_${workspaceId}`;
    this.load();
  }

  /**
   * Generate a summary for a document
   */
  async generateSummary(
    docId: string,
    content: string,
    options: GenerateSummaryOptions = {}
  ): Promise<DocSummary> {
    const { includeCitations = true, maxBullets = 7, focus } = options;

    // Build the prompt
    const prompt = this.buildPrompt(content, includeCitations, maxBullets, focus);

    // Build structured output options
    const structuredOptions: StructuredOutputOptions = {
      schema: DOC_SUMMARY_SCHEMA,
      systemPrompt: `You are an expert business analyst. Analyze documents and extract structured insights.
Always be objective and identify both strengths and weaknesses.
For confidence scores, use 0.0-0.3 for low confidence, 0.4-0.6 for medium, 0.7-1.0 for high.
Parse any [src:ID] references as citations.`,
      temperature: 0.2,
    };

    // Generate structured summary
    const result = await this.provider.structuredOutput<Omit<DocSummary, 'doc_id'>>(
      prompt,
      structuredOptions
    );

    // Create full summary with doc_id
    const summary: DocSummary = {
      doc_id: docId,
      thesis: result.thesis,
      bullets: result.bullets.slice(0, maxBullets),
      assumptions: result.assumptions,
      risks: result.risks,
      open_questions: result.open_questions,
      actions: result.actions,
      confidence: Math.max(0, Math.min(1, result.confidence)),
      citations: result.citations,
    };

    // Store the summary
    this.summaries.set(docId, summary);
    this.persist();

    return summary;
  }

  /**
   * Get a stored summary by document ID
   */
  get(docId: string): DocSummary | undefined {
    return this.summaries.get(docId);
  }

  /**
   * Delete a summary
   */
  delete(docId: string): boolean {
    const deleted = this.summaries.delete(docId);
    if (deleted) {
      this.persist();
    }
    return deleted;
  }

  /**
   * Get all summaries
   */
  getAll(): DocSummary[] {
    return Array.from(this.summaries.values());
  }

  /**
   * Find summaries by citation
   */
  findByCitation(citationId: string): DocSummary[] {
    return this.getAll().filter((summary) =>
      summary.citations.includes(citationId)
    );
  }

  /**
   * Find summaries with low confidence
   */
  findLowConfidence(threshold: number = 0.5): DocSummary[] {
    return this.getAll().filter((summary) => summary.confidence < threshold);
  }

  /**
   * Find summaries with open questions
   */
  findWithOpenQuestions(): DocSummary[] {
    return this.getAll().filter((summary) => summary.open_questions.length > 0);
  }

  /**
   * Find summaries with high risk count
   */
  findHighRisk(minRisks: number = 3): DocSummary[] {
    return this.getAll().filter((summary) => summary.risks.length >= minRisks);
  }

  /**
   * Compare two summaries
   */
  compare(docId1: string, docId2: string): {
    commonAssumptions: string[];
    conflictingAssumptions: string[];
    commonRisks: string[];
    uniqueRisks: { doc1: string[]; doc2: string[] };
  } | undefined {
    const summary1 = this.get(docId1);
    const summary2 = this.get(docId2);

    if (!summary1 || !summary2) {
      return undefined;
    }

    // Find common assumptions (fuzzy match)
    const commonAssumptions = summary1.assumptions.filter((a1) =>
      summary2.assumptions.some((a2) => this.fuzzyMatch(a1, a2))
    );

    // Find potentially conflicting assumptions
    const conflictingAssumptions: string[] = [];
    for (const a1 of summary1.assumptions) {
      for (const a2 of summary2.assumptions) {
        if (this.mightConflict(a1, a2)) {
          conflictingAssumptions.push(`"${a1}" vs "${a2}"`);
        }
      }
    }

    // Find common risks
    const commonRisks = summary1.risks.filter((r1) =>
      summary2.risks.some((r2) => this.fuzzyMatch(r1, r2))
    );

    // Find unique risks
    const uniqueRisks = {
      doc1: summary1.risks.filter(
        (r1) => !summary2.risks.some((r2) => this.fuzzyMatch(r1, r2))
      ),
      doc2: summary2.risks.filter(
        (r2) => !summary1.risks.some((r1) => this.fuzzyMatch(r1, r2))
      ),
    };

    return {
      commonAssumptions,
      conflictingAssumptions,
      commonRisks,
      uniqueRisks,
    };
  }

  /**
   * Export summaries to JSON
   */
  exportJSON(): string {
    return JSON.stringify(this.getAll(), null, 2);
  }

  /**
   * Clear all summaries
   */
  clear(): void {
    this.summaries.clear();
    this.persist();
  }

  /**
   * Build the analysis prompt
   */
  private buildPrompt(
    content: string,
    includeCitations: boolean,
    maxBullets: number,
    focus?: string[]
  ): string {
    let focusInstruction = '';
    if (focus && focus.length > 0) {
      focusInstruction = `\n\nPay special attention to: ${focus.join(', ')}.`;
    }

    let citationInstruction = '';
    if (includeCitations) {
      citationInstruction = `

Look for citation references in the format [src:ID] and include them in the citations array.`;
    }

    return `Analyze the following business document and extract structured insights.

DOCUMENT:
${content}

INSTRUCTIONS:
1. Identify the main thesis or central argument
2. Extract up to ${maxBullets} key points as bullet summaries
3. List any explicit or implicit assumptions
4. Identify risks or potential problems
5. Note any open questions that need investigation
6. Suggest action items or next steps
7. Assign a confidence score (0-1) based on how well-supported the claims are${citationInstruction}${focusInstruction}

Provide your analysis in the structured format requested.`;
  }

  /**
   * Fuzzy match two strings (case-insensitive, similar words)
   */
  private fuzzyMatch(s1: string, s2: string): boolean {
    const normalize = (s: string) =>
      s.toLowerCase().replace(/[^\w\s]/g, '').trim();

    const n1 = normalize(s1);
    const n2 = normalize(s2);

    // Exact match
    if (n1 === n2) return true;

    // Substring match
    if (n1.includes(n2) || n2.includes(n1)) return true;

    // Word overlap
    const words1 = new Set(n1.split(/\s+/));
    const words2 = new Set(n2.split(/\s+/));
    const overlap = [...words1].filter((w) => words2.has(w)).length;
    const minWords = Math.min(words1.size, words2.size);

    return overlap / minWords > 0.6;
  }

  /**
   * Check if two assumptions might conflict
   */
  private mightConflict(a1: string, a2: string): boolean {
    const n1 = a1.toLowerCase();
    const n2 = a2.toLowerCase();

    // Look for negation patterns
    const negations = ['not', 'no', "won't", "can't", "doesn't", 'never', 'unlikely'];

    // Check if one contains negation of similar concept
    for (const neg of negations) {
      if ((n1.includes(neg) && !n2.includes(neg)) ||
          (!n1.includes(neg) && n2.includes(neg))) {
        // Check if they discuss similar topics
        const words1 = new Set(n1.replace(/\b(not|no|won't|can't|doesn't|never|unlikely)\b/g, '').split(/\s+/));
        const words2 = new Set(n2.replace(/\b(not|no|won't|can't|doesn't|never|unlikely)\b/g, '').split(/\s+/));
        const overlap = [...words1].filter((w) => words2.has(w) && w.length > 3).length;

        if (overlap >= 2) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Load from localStorage
   */
  private load(): void {
    if (typeof localStorage === 'undefined') return;

    try {
      const data = localStorage.getItem(this.storageKey);
      if (data) {
        const summaries = JSON.parse(data) as DocSummary[];
        this.summaries.clear();
        for (const summary of summaries) {
          this.summaries.set(summary.doc_id, summary);
        }
      }
    } catch {
      // Ignore load errors
    }
  }

  /**
   * Persist to localStorage
   */
  private persist(): void {
    if (typeof localStorage === 'undefined') return;

    try {
      const data = this.getAll();
      localStorage.setItem(this.storageKey, JSON.stringify(data));
    } catch {
      // Ignore storage errors
    }
  }
}

/**
 * Create a DocSummaryService instance
 */
export function createDocSummaryService(
  provider: Provider,
  workspaceId?: string
): DocSummaryService {
  return new DocSummaryService(provider, workspaceId);
}
