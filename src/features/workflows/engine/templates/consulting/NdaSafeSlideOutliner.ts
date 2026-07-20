// Consulting Practice Pack v2.3 (shipped). Built with input from practicing consultants.
// Can ship without formal advisor review (no statutory claims).
// Recommend one experienced consultant read-through before production.

import type { WorkflowTemplate, InterviewStepConfig, GenerateStepConfig } from '@/platform/types/workflow';
import { BRAND } from '@/config/brand';

const interviewQuestions: InterviewStepConfig['questions'] = [
  {
    id: 'clientOrganizationName',
    question: 'Client organization name',
    description: 'Name of the client organization.',
    type: 'text',
    required: true,
    placeholder: 'e.g., Meridian Financial Group',
  },
  {
    id: 'presentationPurpose',
    question: 'Presentation purpose',
    description: 'What is this presentation for?',
    type: 'select',
    required: true,
    options: ['Board update', 'Interim findings', 'Final readout', 'Kick-off', 'Other'],
    defaultValue: 'Final readout',
  },
  {
    id: 'intendedAudience',
    question: 'Intended audience',
    description: 'Who will be in the room. Include their roles and level.',
    type: 'text',
    required: true,
    placeholder: 'e.g., CFO, COO, Finance team',
  },
  {
    id: 'keyMessages',
    question: 'Key messages',
    description: 'The main points this presentation must convey.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., The current pricing structure undervalues the mid-market segment. Competitors have shifted to tiered models. A test repricing showed client retention.',
  },
  {
    id: 'whatCannotBeDisclosed',
    question: 'What cannot be disclosed (NDA-restricted material)',
    description: 'Sensitive, confidential, or NDA-restricted information that slides must avoid.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Internal cost structures, specific client names or data, competitive pricing details from interviews',
  },
  {
    id: 'numberofSlides',
    question: 'Number of slides requested',
    description: 'Target slide count for the deck.',
    type: 'select',
    required: true,
    options: ['10', '15', '20', '25'],
    defaultValue: '15',
  },
];

const ndaSafeSlideOutlinerPrompt = `You are assisting a consultant in outlining a client presentation. The outline respects the NDA restrictions provided and never includes the restricted material flagged.

Client organization: {{clientOrganizationName}}
Presentation purpose: {{presentationPurpose}}
Intended audience: {{intendedAudience}}
Key messages: {{keyMessages}}
What cannot be disclosed: {{whatCannotBeDisclosed}}
Number of slides: {{numberofSlides}}

Produce a slide-by-slide outline in Markdown. At the top, include the draft notice.

> **Draft document** - Review and edit before delivery.

---

# Presentation Outline

**Client:** {{clientOrganizationName}}
**Purpose:** {{presentationPurpose}}
**Audience:** {{intendedAudience}}
**Slide target:** {{numberofSlides}} slides
**Prepared:** [date]

---

## NDA Compliance Notice

**Do not include the following restricted material in any slides:**
{{whatCannotBeDisclosed}}

Every slide outline below is designed to convey the key messages without disclosing restricted content. Verify before creating the actual deck.

---

## Narrative Arc

[2-3 sentences describing the presentation's throughline: where it starts, how it moves, where it lands. This is the logic the presenter should hold in mind while building slides.]

---

## Slide-by-Slide Outline

[For each slide, provide:]

### Slide [N]: [Title]

**Purpose:** [One sentence describing what this slide accomplishes in the narrative]

**Content bullets:**
- [Bullet 1]
- [Bullet 2]
- [Bullet 3 if needed - keep to 2-3 bullets per slide]

**Speaker notes:** [What the presenter should say to give life to the slide. 1-3 sentences.]

---

[Continue for all slides. Ensure the deck respects the NDA restrictions: no restricted material in titles, bullets, or notes.]

---

## NDA Compliance Checklist

[For each restricted item provided, confirm it does not appear in the outline above. Mark with checkboxes:]

- [ ] [Restricted item 1 - verified absent from outline]
- [ ] [Restricted item 2 - verified absent from outline]

---

*Before building the actual deck, confirm all restricted material remains off-limits. Test each slide against the NDA restrictions list.*

---

After the Markdown outline above, output a JSON code block with the following exact format. This powers the one-click "Download structured deck" export in ${BRAND.name}.

\`\`\`json
[
  {
    "title": "Slide title",
    "layout": "bullets",
    "bullets": ["Bullet 1", "Bullet 2"],
    "speakerNotes": "Speaker notes for this slide",
    "tableData": null
  }
]
\`\`\`

Rules for the JSON block:
- Include every content slide (not the cover or NDA checklist section).
- Use \`"table"\` layout and populate \`tableData\` with \`headers\` + \`rows\` when a comparison, matrix, or structured data slide is appropriate.
- Use \`"two-column"\` layout when side-by-side content is clearer than a single list.
- Use \`"title-only"\` for transition or section-divider slides with no body content.
- Default to \`"bullets"\` for all other slides.
- Always include \`speakerNotes\` (even if brief). These should match the speaker notes in the Markdown outline above.
- Set \`tableData\` to \`null\` for any non-table slide.`;

export const NdaSafeSlideOutliner: WorkflowTemplate = {
  id: 'consulting-slide-outliner',
  name: 'NDA-Safe Slide Outliner',
  description: 'Outlines a slide deck that avoids disclosing confidential details. Produces a numbered slide outline with purpose, content bullets, speaker notes, and an NDA compliance checklist.',
  version: '1.0.0',
  category: 'consulting',
  requiresVerification: true,
  verificationNote: 'Review this outline for client-specific accuracy before building your final presentation.',
  steps: [
    {
      id: 'interview',
      type: 'interview',
      name: 'Presentation Details',
      description: 'Describe the purpose, audience, key messages, and NDA restrictions',
      config: {
        questions: interviewQuestions,
      } as InterviewStepConfig,
    },
    {
      id: 'generate-slide-outline',
      type: 'generate',
      name: 'Generate Slide Outline',
      description: 'Build the slide-by-slide outline that respects NDA restrictions',
      config: {
        outputFile: '{{clientOrganizationName}}-slide-outline.md',
        promptTemplate: ndaSafeSlideOutlinerPrompt,
        systemPrompt: 'You are a consulting practice assistant helping an experienced consultant outline a client presentation that respects NDA restrictions. You never include the restricted material in any part of the outline. You think about narrative structure and flow. Your slide titles are specific and claim-based. You provide speaker notes that bring each slide to life. You include a compliance checklist at the end.',
      } as GenerateStepConfig,
    },
  ],
  requiredInputs: [],
  outputs: ['{{clientOrganizationName}}-slide-outline.md'],
  namedOutputs: [
    { id: 'slide_outline', name: 'Slide-by-slide outline', schema: 'string' },
    { id: 'nda_compliance', name: 'NDA compliance checklist', schema: 'array' },
  ],
};

export default NdaSafeSlideOutliner;
