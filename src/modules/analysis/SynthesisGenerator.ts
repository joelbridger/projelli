// Synthesis Generator
// Generates reconciled synthesis from multiple model outputs

import type { Provider, StructuredOutputOptions, OutputSchema } from '@/modules/models/Provider';
import type { Contradiction } from './ContradictionDetector';

/**
 * A synthesized document combining multiple sources
 */
export interface Synthesis {
  id: string;
  title: string;
  content: string;
  sources: string[];
  sections: SynthesisSection[];
  resolvedContradictions: ResolvedContradiction[];
  unresolvedContradictions: string[];
  confidence: number;
  generatedAt: string;
}

/**
 * A section of the synthesis
 */
export interface SynthesisSection {
  heading: string;
  content: string;
  sourceAgreement: 'high' | 'medium' | 'low';
  citations: string[];
  notes?: string | undefined;
}

/**
 * A contradiction that has been resolved
 */
export interface ResolvedContradiction {
  contradictionId: string;
  resolution: string;
  rationale: string;
  preferredSource?: string;
}

/**
 * Schema for synthesis generation
 */
const SYNTHESIS_SCHEMA: OutputSchema = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    content: { type: 'string' },
    sections: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          heading: { type: 'string' },
          content: { type: 'string' },
          sourceAgreement: { type: 'string' },
          citations: {
            type: 'array',
            items: { type: 'string' },
          },
          notes: { type: 'string' },
        },
      },
    },
    resolvedContradictions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          contradictionId: { type: 'string' },
          resolution: { type: 'string' },
          rationale: { type: 'string' },
          preferredSource: { type: 'string' },
        },
      },
    },
    unresolvedContradictions: {
      type: 'array',
      items: { type: 'string' },
    },
    confidence: { type: 'number' },
  },
  required: ['title', 'content', 'sections', 'resolvedContradictions', 'unresolvedContradictions', 'confidence'],
};

/**
 * Options for synthesis generation
 */
export interface SynthesisOptions {
  /**
   * Title for the synthesis
   */
  title?: string;

  /**
   * Contradictions to attempt to resolve
   */
  contradictions?: Contradiction[];

  /**
   * Resolution strategy for contradictions
   */
  resolutionStrategy?: 'prefer-consensus' | 'prefer-detailed' | 'flag-all';

  /**
   * Include uncertainty markers
   */
  includeUncertainty?: boolean;

  /**
   * Output format
   */
  format?: 'narrative' | 'structured' | 'hybrid';
}

/**
 * SynthesisGenerator creates reconciled documents from multiple sources
 */
export class SynthesisGenerator {
  constructor(private readonly provider: Provider) {}

  /**
   * Generate a synthesis from multiple sources
   */
  async generate(
    sources: Array<{ text: string; source: string }>,
    options: SynthesisOptions = {}
  ): Promise<Synthesis> {
    const {
      title = 'Synthesized Analysis',
      contradictions = [],
      resolutionStrategy = 'prefer-consensus',
      includeUncertainty = true,
      format = 'hybrid',
    } = options;

    const prompt = this.buildPrompt(sources, contradictions, resolutionStrategy, includeUncertainty, format);

    const structuredOptions: StructuredOutputOptions = {
      schema: SYNTHESIS_SCHEMA,
      systemPrompt: `You are an expert at synthesizing information from multiple sources into coherent, balanced documents.
When sources disagree, be transparent about the disagreement.
When resolving contradictions, explain your reasoning.
Maintain objectivity and don't favor any source without justification.`,
      temperature: 0.3,
    };

    const result = await this.provider.structuredOutput<{
      title: string;
      content: string;
      sections: Array<{
        heading: string;
        content: string;
        sourceAgreement: string;
        citations: string[];
        notes?: string;
      }>;
      resolvedContradictions: Array<{
        contradictionId: string;
        resolution: string;
        rationale: string;
        preferredSource?: string;
      }>;
      unresolvedContradictions: string[];
      confidence: number;
    }>(prompt, structuredOptions);

    return {
      id: `synthesis_${Date.now()}`,
      title: result.title || title,
      content: result.content,
      sources: sources.map((s) => s.source),
      sections: result.sections.map((s) => ({
        heading: s.heading,
        content: s.content,
        sourceAgreement: this.normalizeAgreement(s.sourceAgreement),
        citations: s.citations,
        notes: s.notes,
      })),
      resolvedContradictions: result.resolvedContradictions,
      unresolvedContradictions: result.unresolvedContradictions,
      confidence: Math.max(0, Math.min(1, result.confidence)),
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Generate a markdown document from synthesis
   */
  toMarkdown(synthesis: Synthesis): string {
    let md = `# ${synthesis.title}\n\n`;
    md += `*Generated: ${new Date(synthesis.generatedAt).toLocaleDateString()}*\n`;
    md += `*Sources: ${synthesis.sources.join(', ')}*\n`;
    md += `*Confidence: ${(synthesis.confidence * 100).toFixed(0)}%*\n\n`;

    md += '---\n\n';

    // Add main content
    md += synthesis.content + '\n\n';

    // Add sections
    for (const section of synthesis.sections) {
      md += `## ${section.heading}\n\n`;
      md += section.content + '\n\n';

      if (section.sourceAgreement !== 'high') {
        md += `> **Source Agreement:** ${section.sourceAgreement}\n\n`;
      }

      if (section.notes) {
        md += `> *Note: ${section.notes}*\n\n`;
      }

      if (section.citations.length > 0) {
        md += `*Sources: ${section.citations.join(', ')}*\n\n`;
      }
    }

    // Add resolved contradictions
    if (synthesis.resolvedContradictions.length > 0) {
      md += '## Resolved Disagreements\n\n';
      for (const rc of synthesis.resolvedContradictions) {
        md += `### ${rc.contradictionId}\n`;
        md += `**Resolution:** ${rc.resolution}\n\n`;
        md += `*Rationale: ${rc.rationale}*\n\n`;
        if (rc.preferredSource) {
          md += `*Preferred source: ${rc.preferredSource}*\n\n`;
        }
      }
    }

    // Add unresolved contradictions
    if (synthesis.unresolvedContradictions.length > 0) {
      md += '## Unresolved Disagreements\n\n';
      md += 'The following disagreements could not be resolved and require further investigation:\n\n';
      for (const uc of synthesis.unresolvedContradictions) {
        md += `- ${uc}\n`;
      }
      md += '\n';
    }

    return md;
  }

  /**
   * Build the synthesis prompt
   */
  private buildPrompt(
    sources: Array<{ text: string; source: string }>,
    contradictions: Contradiction[],
    resolutionStrategy: string,
    includeUncertainty: boolean,
    format: string
  ): string {
    let sourcesText = '';
    for (const source of sources) {
      sourcesText += `\n--- ${source.source} ---\n${source.text}\n`;
    }

    let contradictionsText = '';
    if (contradictions.length > 0) {
      contradictionsText = '\n\nKNOWN CONTRADICTIONS:\n';
      for (const c of contradictions) {
        contradictionsText += `- [${c.id}] "${c.statement1.text}" (${c.statement1.source}) vs "${c.statement2.text}" (${c.statement2.source})\n`;
      }
    }

    const strategyInstructions = {
      'prefer-consensus': 'When sources disagree, prefer the interpretation that most sources support.',
      'prefer-detailed': 'When sources disagree, prefer the more detailed or specific interpretation.',
      'flag-all': 'Flag all disagreements clearly without attempting to resolve them.',
    };

    const formatInstructions = {
      narrative: 'Write in a flowing narrative style.',
      structured: 'Use structured sections with clear headings.',
      hybrid: 'Use a mix of narrative and structured sections as appropriate.',
    };

    const uncertaintyNote = includeUncertainty
      ? 'Include uncertainty markers like "possibly", "likely", "unclear" where appropriate.'
      : 'State conclusions confidently where sources agree.';

    return `Synthesize the following sources into a coherent, unified document.

SOURCES:${sourcesText}${contradictionsText}

INSTRUCTIONS:
1. Create a synthesized document that combines insights from all sources
2. ${strategyInstructions[resolutionStrategy as keyof typeof strategyInstructions]}
3. ${formatInstructions[format as keyof typeof formatInstructions]}
4. ${uncertaintyNote}
5. For each section, indicate the level of source agreement (high, medium, low)
6. Attempt to resolve known contradictions where possible
7. List any contradictions that cannot be resolved
8. Assign an overall confidence score (0-1)

Provide your synthesis in the structured format requested.`;
  }

  /**
   * Normalize agreement level
   */
  private normalizeAgreement(agreement: string): 'high' | 'medium' | 'low' {
    const normalized = agreement.toLowerCase();
    if (normalized.includes('high') || normalized.includes('strong')) return 'high';
    if (normalized.includes('low') || normalized.includes('weak')) return 'low';
    return 'medium';
  }
}

/**
 * Create a SynthesisGenerator instance
 */
export function createSynthesisGenerator(provider: Provider): SynthesisGenerator {
  return new SynthesisGenerator(provider);
}
