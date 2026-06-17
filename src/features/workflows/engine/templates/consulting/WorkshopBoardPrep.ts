// Consulting Practice Pack v2.3 (shipped). Built with input from practicing consultants.
// Can ship without formal advisor review (no statutory claims).
// Recommend one experienced consultant read-through before production.

import type { WorkflowTemplate, InterviewStepConfig, GenerateStepConfig } from '@/types/workflow';

const interviewQuestions: InterviewStepConfig['questions'] = [
  {
    id: 'sessionType',
    question: 'Session type',
    description: 'What kind of session is this?',
    type: 'select',
    required: true,
    options: [
      'Working session / workshop',
      'Board meeting',
      'Leadership offsite',
      'Steering committee',
      'Other',
    ],
  },
  {
    id: 'sessionObjectives',
    question: 'Session objectives',
    description: 'What does this session need to accomplish? List 2–4 specific, concrete outcomes.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., 1. Align on the two strategic priorities for 2027. 2. Choose between the build / buy / partner options for the digital platform. 3. Assign ownership for the top 3 initiatives.',
  },
  {
    id: 'participants',
    question: 'Participants',
    description: 'Who will be in the room? Include names and roles where relevant. Note if there are any important dynamics (e.g., new board member, tension between two executives, first time the full leadership team has met).',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., CEO (Rachel Torres), CFO (David Kim), COO (Maria Reyes), 3 board members (independent). First session with the new board members appointed in March. Rachel and David have historically disagreed on technology investment pace.',
  },
  {
    id: 'keyQuestionsToResolve',
    question: 'Key questions to resolve',
    description: 'What are the specific decisions or questions this session must answer? These become the agenda anchor points.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Which two strategic priorities get resourced in 2027? Build, buy, or partner for the digital platform? Who owns each initiative and what is their mandate?',
  },
  {
    id: 'knownTensions',
    question: 'Known tensions or landmines',
    description: 'Any known disagreements, sensitivities, political dynamics, or topics that are likely to generate conflict or derailment. These shape the facilitation notes.',
    type: 'textarea',
    required: false,
    placeholder: "e.g., The build vs. buy question is emotionally charged — the CTO built the last system and takes 'buy' as a personal critique. One board member has already signaled opposition to the digital initiative.",
  },
  {
    id: 'sessionDuration',
    question: 'Session duration',
    description: 'How long is the session?',
    type: 'text',
    required: true,
    placeholder: 'e.g., Half day (4 hours), Full day (8 hours), 2 hours',
  },
  {
    id: 'preReadContext',
    question: 'Background materials participants should have (optional)',
    description: 'Any documents, data, or context that participants should review before the session.',
    type: 'textarea',
    required: false,
    placeholder: 'e.g., Q1 2026 performance dashboard, competitive landscape summary, digital platform options analysis (3-page brief)',
  },
];

const workshopBoardPrepPrompt = `You are assisting a consultant in preparing a complete session-prep package for a strategy session. Produce a practical, facilitation-ready package — not a theoretical agenda template.

Session type: {{sessionType}}
Session duration: {{sessionDuration}}
Session objectives: {{sessionObjectives}}
Participants: {{participants}}
Key questions to resolve: {{keyQuestionsToResolve}}
Known tensions or landmines: {{knownTensions}}
Background materials: {{preReadContext}}

Produce a complete session-prep package in Markdown. At the top, include the draft notice.

> **Draft document** — Review the agenda and facilitation notes against the session's specific context and participants before use.

---

# Session Prep Package
**FACILITATOR COPY — Not for distribution to participants without review.**

**Session type:** {{sessionType}}
**Duration:** {{sessionDuration}}
**Prepared:** [date]

---

## Session Objectives

[Restate the session objectives clearly, as outcomes the session must produce:]

1. [Objective 1]
2. [Objective 2]
3. [Objective 3]

---

## Section 1: Session Agenda

[Produce a detailed agenda with timing. The total time blocks must sum to the session duration. Include:]
- Opening / framing (ground rules, objectives, how decisions will be made)
- Working blocks for each key question, with appropriate time allocation
- Breaks where appropriate
- Decision synthesis / close
- Clear labels for which blocks are discussion vs. decision vs. input

| Time | Block | Format | Facilitator note |
|---|---|---|---|
| 0:00–0:15 | Opening and framing | Facilitated | [Note: e.g., "Set norms early — especially decision rights"] |
| 0:15–0:45 | [Block 1 label] | [Discussion / Workshop / Decision] | [Facilitation note] |
| 0:45–1:30 | [Block 2 label] | [Discussion / Workshop / Decision] | [Facilitation note] |
| 1:30–1:45 | Break | | |
| 1:45–2:30 | [Block 3 label] | [Discussion / Workshop / Decision] | [Facilitation note] |
| 2:30–2:50 | Decision synthesis and ownership assignment | Decision | [Note] |
| 2:50–3:00 | Close and next steps | | |

[Adjust blocks, durations, and labels to reflect the actual objectives and key questions provided. Do not use placeholder labels — use the real content from the inputs.]

---

## Section 2: Pre-Read Structure

[Produce a recommended pre-read package structure — what participants should receive before the session and in what order. Include a brief note on the purpose of each item.]

### Recommended Pre-Read Package

1. **Session objectives and agenda** (1 page) — so participants arrive knowing what they are expected to decide
2. **[Background document 1 from inputs]** — [purpose: e.g., "grounds the competitive context discussion"]
3. **[Background document 2 from inputs]** — [purpose]
4. **Key questions brief** (1 page) — [the 2–3 questions the session must answer, stated precisely]
5. **Decision rights note** (half page) — [who decides what: consulting role vs. board role vs. management role]

[If background materials were provided in the inputs, reference them specifically. If not, suggest what would strengthen the pre-read based on the session objectives.]

---

## Section 3: Facilitation Notes by Agenda Item

[For each major agenda block, provide practical facilitation guidance:]

### Opening and Framing

**Objective for this block:** Orient participants, establish norms, make decision rights explicit.

**Suggested opening framing:**
[Draft 3–5 sentences the facilitator can use to open, state the objectives, and set the working norms. Reference the specific objectives and key questions.]

**Watch for:**
[Any dynamic from the inputs worth managing at the start — e.g., "If tensions between participants surfaced in the inputs, name the working norm of direct engagement early."]

---

### [Agenda Block 1 — use the real label from the agenda]

**Objective for this block:** [What this block must produce.]

**Suggested facilitation approach:**
[How to run this block: e.g., framing question, breakout vs. plenary, display format, time-boxing]

**Suggested discussion starter:**
"[Draft a specific, non-leading opening question that surfaces the key question without predetermining the answer]"

**Watch for:**
[Any specific tension or landmine from the inputs relevant to this block. If none, note the general facilitation risk for this type of block.]

**If discussion stalls:**
[A reframe or redirect the facilitator can use to restart movement.]

---

### [Agenda Block 2 — repeat structure for each major block]

**Objective for this block:**

**Suggested facilitation approach:**

**Suggested discussion starter:**

**Watch for:**

**If discussion stalls:**

---

### Decision Synthesis and Ownership Assignment

**Objective for this block:** Produce crisp, recorded decisions with named owners before the session ends.

**Suggested approach:**
[How to capture decisions in real time — e.g., "Keep a running 'Decisions Made' list visible to the room throughout, not just at the close."]

**Watch for:**
[Common failure modes at close: faux consensus, undocumented decisions, ownership left ambiguous. Name them and suggest how to address each.]

---

## Section 4: Analytical Framework

[Based on the key questions provided, produce one of the following if it would genuinely help the discussion:]

[INSTRUCTION: Choose the more appropriate option based on the key questions:]
- If the question involves a strategic trade-off between options: produce a **2x2 matrix** with labeled axes
- If the question involves understanding what drives an outcome: produce a **driver tree** from outcome to 2–3 levels of drivers
- If neither clearly applies: produce a **decision criteria table** with the options as rows and the key criteria as columns

[Produce the framework here with labeled axes/columns/nodes. Use the actual content from the inputs, not generic placeholder text. Explain in 2 sentences what this framework is for and how to use it in the session.]

---

## Facilitator Quick Reference

**The three decisions this session must produce:**
1. [Key question 1 — stated as a decision]
2. [Key question 2 — stated as a decision]
3. [Key question 3 — stated as a decision]

**Watch list for this specific group:**
[Bullet list of the specific dynamics from the inputs worth tracking throughout the session.]

---

*This prep package is a draft for the facilitator's review. It reflects the information provided and should be reviewed against the actual session context, participants, and latest developments before use.*`;

export const WorkshopBoardPrep: WorkflowTemplate = {
  id: 'consulting-workshop-board-prep',
  name: 'Workshop and Board Session Prep',
  description: 'Structures agenda, pre-read, facilitation notes, and 2x2 / driver-tree frameworks for a strategy session or board meeting. Produces a complete session-prep package.',
  version: '1.0.0',
  category: 'consulting',
  requiresVerification: true,
  verificationNote: 'Review the agenda and facilitation notes against the session\'s specific context and participants before use.',
  steps: [
    {
      id: 'interview',
      type: 'interview',
      name: 'Session Information',
      description: 'Provide the session type, objectives, participants, key questions, and any known tensions',
      config: {
        questions: interviewQuestions,
      } as InterviewStepConfig,
    },
    {
      id: 'generate-session-prep',
      type: 'generate',
      name: 'Generate Session Prep Package',
      description: 'Produce a complete session-prep package: agenda, pre-read structure, facilitation notes, and analytical framework',
      config: {
        outputFile: 'SESSION_PREP_PACKAGE.md',
        promptTemplate: workshopBoardPrepPrompt,
        systemPrompt: 'You are a consulting practice assistant helping an experienced facilitator prepare for a strategy session or board meeting. You produce practical, facilitation-ready packages — not theoretical agenda templates. The agenda has realistic timing that actually sums to the session duration. The facilitation notes address the specific dynamics and tensions provided, not generic facilitation advice. The analytical framework (2x2, driver tree, or decision criteria table) is purpose-built for the specific key question, using the actual content from the inputs. You always make decision rights explicit and surface the common failure modes at close — faux consensus, undocumented decisions, ambiguous ownership.',
      } as GenerateStepConfig,
    },
  ],
  requiredInputs: [],
  outputs: ['SESSION_PREP_PACKAGE.md'],
  namedOutputs: [
    { id: 'session_agenda', name: 'Session agenda with timing', schema: 'string' },
    { id: 'pre_read_structure', name: 'Pre-read package structure', schema: 'array' },
    { id: 'facilitation_notes', name: 'Facilitation notes by agenda item', schema: 'array' },
  ],
};

export default WorkshopBoardPrep;
