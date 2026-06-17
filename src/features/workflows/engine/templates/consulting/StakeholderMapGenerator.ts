// Consulting Practice Pack v2.3 (shipped). Built with input from practicing consultants.
// Can ship without formal advisor review (no statutory claims).
// Recommend one experienced consultant read-through before production.

import type { WorkflowTemplate, InterviewStepConfig, GenerateStepConfig } from '@/platform/types/workflow';

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
    id: 'engagementType',
    question: 'Engagement type',
    description: 'The broad category or nature of the work.',
    type: 'text',
    required: true,
    placeholder: 'e.g., Strategy, Org design, M&A integration, Product launch',
  },
  {
    id: 'knownStakeholders',
    question: 'Known stakeholders',
    description: 'List the people you know are involved or have influence. Include their names and titles.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Rachel Torres (CFO), Marcus Chen (VP Operations), Board chair: David Park',
  },
  {
    id: 'decisionMakingStructure',
    question: 'Decision-making structure',
    description: 'How are major decisions made in this organization?',
    type: 'select',
    required: true,
    options: ['Centralized', 'Committee-based', 'Federated'],
    defaultValue: 'Committee-based',
  },
  {
    id: 'keyInfluencers',
    question: 'Key influencers',
    description: 'People whose buy-in or blessing matters, even if they do not have formal authority.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Elena Rodriguez (CTO, technically respected), Jim Walsh (long-tenure finance manager, trusted by finance team)',
  },
  {
    id: 'politicalLandmines',
    question: 'Political landmines or sensitivities (optional)',
    description: 'Known tensions, past failures, turf wars, or sensitive relationships to navigate.',
    type: 'textarea',
    required: false,
    placeholder: 'e.g., CEO wants this but board has concerns. CFO and COO have not agreed on direction. Recent layoffs have made staff skeptical of change.',
  },
];

const stakeholderMapGeneratorPrompt = `You are assisting a consultant in mapping the stakeholder landscape for a client engagement. This is an internal document - write it for the consultant's strategic use, not for sharing with the client.

Client organization: {{clientOrganizationName}}
Engagement type: {{engagementType}}
Known stakeholders: {{knownStakeholders}}
Decision-making structure: {{decisionMakingStructure}}
Key influencers: {{keyInfluencers}}
Political landmines: {{politicalLandmines}}

Produce a stakeholder map in Markdown. At the top, include the draft notice.

> **Draft document** - Review and edit before delivery.

---

# Stakeholder Map

**Client:** {{clientOrganizationName}}
**Engagement type:** {{engagementType}}
**Decision structure:** {{decisionMakingStructure}}
**Date prepared:** [Date]

---

## Overview

[Brief narrative (2-3 sentences) summarizing the stakeholder landscape: Who holds decision authority? Who are the key influencers? What is the political shape of this organization?]

---

## Stakeholder Matrix

| Name | Role | Formal Authority | Stance | Influence | Engagement Approach |
|------|------|------------------|--------|-----------|----------------------|
| [Name] | [Title] | [High/Medium/Low] | [Champion/Neutral/Skeptic] | [High/Medium/Low] | [How to engage this person] |

[Include all known stakeholders. For each:]
- **Formal Authority:** Does this person have final say, veto power, or advisory input?
- **Stance:** Are they enthusiastic (Champion), neutral, or resistant (Skeptic)?
- **Influence:** Can they sway others or block decisions?
- **Engagement Approach:** What does this person need to hear? One-on-one? Data? Peer feedback? How often should you touch base?

---

## Decision Makers

[List primary decision authority and the decision structure:]

**Primary decision-maker:** [Name, title, what they care about]
**Approval structure:** [Who else must agree? Board vote? Committee sign-off? Sponsor discretion?]
**Decision timeline:** [Is there urgency or political pressure?]

---

## Key Influencers

[Identify people who may not hold formal authority but shape opinion. Include how they influence and what they care about.]

1. **[Name]:** [Title, why they matter, what they care about, how to engage]
2. **[Name]:** [Title, why they matter, what they care about, how to engage]

[Continue for all identified influencers]

---

## Political Landscape

[If political sensitivities were provided, map them:]

### Known Tensions
- [Tension 1 and how to navigate it]
- [Tension 2 and how to navigate it]

### Past Outcomes (if relevant)
- [Prior initiatives that succeeded or failed, and what people learned from them]

### Staff Sentiment
[Are people skeptical, cautious, excited, or burned out? How does this shape receptivity?]

---

## Engagement Strategy

[Based on the stakeholder map, recommend a sequence for stakeholder engagement:]

1. **Phase 1:** [Who to engage first, why, and what to accomplish]
2. **Phase 2:** [Broaden to secondary stakeholders]
3. **Phase 3:** [Full-group alignment or decision]

---

*This map is based on available information as of the engagement start. Stakeholder positions may shift as work unfolds. Update this map if you discover new players or changed dynamics.*`;

export const StakeholderMapGenerator: WorkflowTemplate = {
  id: 'consulting-stakeholder-map',
  name: 'Stakeholder Map Generator',
  description: 'Maps key client stakeholders with their formal authority, stance, influence, and recommended engagement approach. Surfaces political sensitivities and decision structures.',
  version: '1.0.0',
  category: 'consulting',
  requiresVerification: true,
  verificationNote: 'Review stakeholder characterizations for accuracy before using in a client engagement.',
  steps: [
    {
      id: 'interview',
      type: 'interview',
      name: 'Stakeholder Information',
      description: 'Provide information about known stakeholders, decision structure, and political sensitivities',
      config: {
        questions: interviewQuestions,
      } as InterviewStepConfig,
    },
    {
      id: 'generate-stakeholder-map',
      type: 'generate',
      name: 'Generate Stakeholder Map',
      description: 'Create a structured stakeholder map with engagement strategies',
      config: {
        outputFile: '{{clientOrganizationName}}-stakeholder-map.md',
        promptTemplate: stakeholderMapGeneratorPrompt,
        systemPrompt: 'You are a consulting practice assistant helping an experienced consultant map stakeholders for an engagement. You identify formal authority, influence, and likely position based on context clues. You take political sensitivities seriously and surface them explicitly. You recommend engagement approaches that are respectful of both formal and informal power structures. You avoid naive assumptions about organizational charts.',
      } as GenerateStepConfig,
    },
  ],
  requiredInputs: [],
  outputs: ['{{clientOrganizationName}}-stakeholder-map.md'],
  namedOutputs: [
    { id: 'stakeholders', name: 'Stakeholder list', schema: 'array' },
    { id: 'key_influencers', name: 'Key influencers', schema: 'array' },
    { id: 'engagement_sequence', name: 'Engagement sequence', schema: 'array' },
  ],
};

export default StakeholderMapGenerator;
