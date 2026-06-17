// Multi-Interview Synthesis Workflow Template (M8)
//
// A lightweight template declaration that the app wires to the
// MultiInterviewSynthesisPanel UI.  The template.steps array is kept
// minimal (a single "generate" step) so the existing WorkflowEngine
// fallback works out of the box; the UI component handles the actual
// Phase A / Phase B orchestration before writing the output file.

import type { WorkflowTemplate, GenerateStepConfig } from '@/platform/types/workflow';

const promptTemplate = `You are synthesizing insights across multiple customer interview transcripts.
The UI has already attached the transcripts; produce a structured synthesis
matching the UserInterviewsSynthesis schema:

- themes (name, frequency, quotes)
- killer_quotes
- contradictions (statement_a, statement_b, sources)
- jtbd_frameworks (job, current_solution, friction)
- priority_ranked_features (feature, frequency, urgency, supporting_quotes)

Transcripts are attached below.`;

export const UserInterviewsSynthesis: WorkflowTemplate = {
  id: 'user-interviews-synthesis',
  name: 'Customer Interviews — Multi-transcript synthesis',
  description:
    'Analyze 3+ interview transcripts together and surface themes, contradictions, jobs-to-be-done, and priority-ranked features.',
  version: '1.0.0',
  category: 'analysis',
  steps: [
    {
      id: 'synthesize',
      type: 'generate',
      name: 'Synthesize transcripts',
      description: 'Aggregate themes, contradictions, JTBD, and features',
      config: {
        outputFile: 'INTERVIEW_SYNTHESIS.md',
        promptTemplate,
        systemPrompt:
          'You are a senior product researcher synthesizing across customer interviews. Ground every claim in a direct quote.',
      } as GenerateStepConfig,
    },
  ],
  requiredInputs: [],
  outputs: ['INTERVIEW_SYNTHESIS.md'],
  // M7 — this template consumes transcripts and common_themes produced by
  // UserInterviews runs (or forwarded into a chain).
  namedInputs: [
    {
      id: 'transcripts',
      name: 'Interview transcripts',
      schema: 'array',
      acceptsOutputFrom: ['transcripts'],
    },
  ],
  // M8 structured fields — downstream templates can key off these.
  namedOutputs: [
    { id: 'themes', name: 'Themes' },
    { id: 'killer_quotes', name: 'Killer quotes' },
    { id: 'priority_ranked_features', name: 'Priority features' },
  ],
};

export default UserInterviewsSynthesis;
