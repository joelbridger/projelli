// Contradiction Detector
// Identifies contradictions between model outputs

import type { Provider, StructuredOutputOptions, OutputSchema } from '@/modules/models/Provider';

/**
 * A detected contradiction between two statements
 */
export interface Contradiction {
  id: string;
  statement1: {
    text: string;
    source: string; // model name or document ID
    position?: number | undefined; // character position in source
  };
  statement2: {
    text: string;
    source: string;
    position?: number | undefined;
  };
  type: 'direct' | 'implicit' | 'factual' | 'logical';
  severity: 'minor' | 'moderate' | 'major';
  explanation: string;
  suggestedResolution?: string | undefined;
}

/**
 * Result of contradiction analysis
 */
export interface ContradictionAnalysis {
  contradictions: Contradiction[];
  agreementScore: number; // 0-1, how much the sources agree
  keyDisagreements: string[];
  keyAgreements: string[];
}

/**
 * Schema for AI contradiction detection
 */
const CONTRADICTION_SCHEMA: OutputSchema = {
  type: 'object',
  properties: {
    contradictions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          statement1: { type: 'string' },
          statement2: { type: 'string' },
          type: { type: 'string' },
          severity: { type: 'string' },
          explanation: { type: 'string' },
          suggestedResolution: { type: 'string' },
        },
      },
    },
    agreementScore: { type: 'number' },
    keyDisagreements: {
      type: 'array',
      items: { type: 'string' },
    },
    keyAgreements: {
      type: 'array',
      items: { type: 'string' },
    },
  },
  required: ['contradictions', 'agreementScore', 'keyDisagreements', 'keyAgreements'],
};

/**
 * Options for contradiction detection
 */
export interface DetectionOptions {
  /**
   * Minimum severity to include
   */
  minSeverity?: 'minor' | 'moderate' | 'major';

  /**
   * Include implicit contradictions
   */
  includeImplicit?: boolean;

  /**
   * Focus areas
   */
  focusAreas?: string[];
}

/**
 * ContradictionDetector identifies contradictions between model outputs
 */
export class ContradictionDetector {
  constructor(private readonly provider: Provider) {}

  /**
   * Detect contradictions between two texts
   */
  async detect(
    text1: string,
    source1: string,
    text2: string,
    source2: string,
    options: DetectionOptions = {}
  ): Promise<ContradictionAnalysis> {
    const { minSeverity = 'minor', includeImplicit = true, focusAreas } = options;

    const prompt = this.buildPrompt(text1, source1, text2, source2, includeImplicit, focusAreas);

    const structuredOptions: StructuredOutputOptions = {
      schema: CONTRADICTION_SCHEMA,
      systemPrompt: `You are an expert analyst skilled at identifying contradictions, inconsistencies, and disagreements between texts.
Be thorough but precise. Only flag genuine contradictions, not mere differences in emphasis.
For implicit contradictions, the statements must logically conflict even if not directly opposite.`,
      temperature: 0.1,
    };

    const result = await this.provider.structuredOutput<{
      contradictions: Array<{
        statement1: string;
        statement2: string;
        type: string;
        severity: string;
        explanation: string;
        suggestedResolution?: string;
      }>;
      agreementScore: number;
      keyDisagreements: string[];
      keyAgreements: string[];
    }>(prompt, structuredOptions);

    // Map and filter contradictions
    const contradictions: Contradiction[] = result.contradictions
      .map((c, index) => ({
        id: `contradiction_${index}`,
        statement1: {
          text: c.statement1,
          source: source1,
        },
        statement2: {
          text: c.statement2,
          source: source2,
        },
        type: this.normalizeType(c.type),
        severity: this.normalizeSeverity(c.severity),
        explanation: c.explanation,
        suggestedResolution: c.suggestedResolution,
      }))
      .filter((c) => this.meetsMinSeverity(c.severity, minSeverity));

    return {
      contradictions,
      agreementScore: Math.max(0, Math.min(1, result.agreementScore)),
      keyDisagreements: result.keyDisagreements,
      keyAgreements: result.keyAgreements,
    };
  }

  /**
   * Detect contradictions across multiple sources
   */
  async detectMultiple(
    sources: Array<{ text: string; source: string }>,
    options: DetectionOptions = {}
  ): Promise<{
    pairwiseAnalysis: Map<string, ContradictionAnalysis>;
    allContradictions: Contradiction[];
    overallAgreement: number;
  }> {
    const pairwiseAnalysis = new Map<string, ContradictionAnalysis>();
    const allContradictions: Contradiction[] = [];

    // Compare each pair
    for (let i = 0; i < sources.length; i++) {
      for (let j = i + 1; j < sources.length; j++) {
        const source1 = sources[i];
        const source2 = sources[j];

        if (!source1 || !source2) continue;

        const key = `${source1.source}:${source2.source}`;
        const analysis = await this.detect(
          source1.text,
          source1.source,
          source2.text,
          source2.source,
          options
        );

        pairwiseAnalysis.set(key, analysis);

        // Add contradictions with unique IDs
        for (const c of analysis.contradictions) {
          allContradictions.push({
            ...c,
            id: `${key}_${c.id}`,
          });
        }
      }
    }

    // Calculate overall agreement
    const agreements = Array.from(pairwiseAnalysis.values()).map(
      (a) => a.agreementScore
    );
    const overallAgreement =
      agreements.length > 0
        ? agreements.reduce((sum, a) => sum + a, 0) / agreements.length
        : 1;

    return {
      pairwiseAnalysis,
      allContradictions,
      overallAgreement,
    };
  }

  /**
   * Build the detection prompt
   */
  private buildPrompt(
    text1: string,
    source1: string,
    text2: string,
    source2: string,
    includeImplicit: boolean,
    focusAreas?: string[]
  ): string {
    let focusInstruction = '';
    if (focusAreas && focusAreas.length > 0) {
      focusInstruction = `\n\nFocus particularly on contradictions related to: ${focusAreas.join(', ')}.`;
    }

    const implicitNote = includeImplicit
      ? 'Include both direct contradictions and implicit logical conflicts.'
      : 'Only include direct, explicit contradictions.';

    return `Compare the following two texts and identify any contradictions or inconsistencies.

TEXT 1 (from ${source1}):
${text1}

TEXT 2 (from ${source2}):
${text2}

INSTRUCTIONS:
1. Identify statements that directly contradict each other
2. ${implicitNote}
3. Classify each contradiction by type (direct, implicit, factual, logical)
4. Rate severity (minor, moderate, major)
5. Explain why each is a contradiction
6. Suggest resolutions where possible
7. Calculate an agreement score (0-1, where 1 = complete agreement)
8. List key areas of disagreement and agreement${focusInstruction}

Provide your analysis in the structured format requested.`;
  }

  /**
   * Normalize contradiction type
   */
  private normalizeType(type: string): Contradiction['type'] {
    const normalized = type.toLowerCase();
    if (normalized.includes('direct')) return 'direct';
    if (normalized.includes('implicit')) return 'implicit';
    if (normalized.includes('fact')) return 'factual';
    if (normalized.includes('logic')) return 'logical';
    return 'direct';
  }

  /**
   * Normalize severity
   */
  private normalizeSeverity(severity: string): Contradiction['severity'] {
    const normalized = severity.toLowerCase();
    if (normalized.includes('major') || normalized.includes('high')) return 'major';
    if (normalized.includes('moderate') || normalized.includes('medium')) return 'moderate';
    return 'minor';
  }

  /**
   * Check if severity meets minimum threshold
   */
  private meetsMinSeverity(
    severity: Contradiction['severity'],
    minSeverity: Contradiction['severity']
  ): boolean {
    const order = { minor: 0, moderate: 1, major: 2 };
    return order[severity] >= order[minSeverity];
  }
}

/**
 * Create a ContradictionDetector instance
 */
export function createContradictionDetector(provider: Provider): ContradictionDetector {
  return new ContradictionDetector(provider);
}
