// Board Meeting Prep Workflow Template
// Generates an agenda, metrics review, decisions queue, and discussion prep
// for a board meeting (whether formal board, advisory board, or practice leadership meeting).

import type { WorkflowTemplate, InterviewStepConfig, GenerateStepConfig } from '@/types/workflow';

const interviewQuestions: InterviewStepConfig['questions'] = [
  {
    id: 'meetingDate',
    question: 'When is the meeting?',
    description: 'Date and time of the board meeting',
    type: 'text',
    required: true,
    placeholder: 'April 15, 2026 — 2:00 PM ET',
  },
  {
    id: 'meetingType',
    question: 'What type of meeting?',
    description: 'Board, advisory, or operational',
    type: 'select',
    required: true,
    options: ['Formal board meeting', 'Advisory board meeting', 'Practice leadership meeting', 'Client advisory board', 'Operational leadership team'],
    defaultValue: 'Formal board meeting',
  },
  {
    id: 'attendees',
    question: 'Who will be there?',
    description: 'Names and roles. The agenda gets shaped by who\'s in the room.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Jane Smith (outside counsel / board advisor), Bob Lee (independent board member), me (managing partner)',
  },
  {
    id: 'topics',
    question: 'Topics to cover',
    description: 'What needs to be discussed? Brain-dump everything; the agenda will be sequenced for you.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Q1 financial review, hiring plan for next 6 months, fundraising timeline, customer concentration risk, board approval for new equity grants',
  },
  {
    id: 'metricsReview',
    question: 'Metrics to review',
    description: 'What numbers will you bring to the meeting?',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Revenue: $85K (+12% QoQ), Active client matters: 34, New engagements: 3, Pipeline: $120K, Realization rate: 91%, Avg days to collect: 38',
  },
  {
    id: 'decisions',
    question: 'Decisions needed',
    description: 'What does the board need to formally approve or weigh in on?',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Approve 2026 operating budget; approve bringing on a junior associate; weigh in on practice area expansion; approve updated fee schedule',
  },
  {
    id: 'risks',
    question: 'What are you worried about?',
    description: 'Risks and concerns the board should know. Don\'t hide these — surface them.',
    type: 'textarea',
    required: false,
    placeholder: 'e.g., One client represents 35% of revenue and their retainer is up for renewal; we\'re at capacity and turning away work without additional help',
  },
  {
    id: 'duration',
    question: 'Meeting duration',
    description: 'How long is the meeting?',
    type: 'select',
    required: true,
    options: ['30 minutes', '60 minutes', '90 minutes', '2 hours', '3 hours'],
    defaultValue: '60 minutes',
  },
];

const agendaPrompt = `You are helping a professional prepare a board meeting agenda.

Meeting type: {{meetingType}}
Date: {{meetingDate}}
Duration: {{duration}}
Attendees: {{attendees}}

Topics the professional wants to cover:
{{topics}}

Decisions needed:
{{decisions}}

Generate a clean, time-boxed agenda in Markdown format. The agenda should:

1. Start with a header: "# Board Meeting — {{meetingDate}}"
2. List attendees and meeting type
3. Have a time-boxed agenda where the total adds up to the meeting duration
4. Sequence topics intelligently:
   - Open with a brief practice update (5 min)
   - Metrics review next (so context is set)
   - Strategic discussion topics
   - Decision items (actual votes/approvals)
   - Closed session (board or advisors only) at the end if relevant
   - Action items review at the very end (5 min)
5. For each agenda item, include:
   - Time allocation
   - Who is leading the item
   - Whether it's "Discuss," "Decide," or "Inform"
6. Keep it crisp — no fluff, just the structure

Format:

| Time | Topic | Lead | Type |
|---|---|---|---|
| 2:00-2:05 | Opening + recent highlights | Lead | Inform |
| 2:05-2:20 | Q1 financials review | Lead | Discuss |
| ... | ... | ... | ... |

After the table, include a "Pre-read" section listing any documents the board should review before the meeting.`;

const briefingPrompt = `You are helping a professional draft a pre-read briefing document for board members.

Meeting type: {{meetingType}}
Date: {{meetingDate}}
Attendees: {{attendees}}

Topics to cover:
{{topics}}

Metrics:
{{metricsReview}}

Decisions needed:
{{decisions}}

Risks/concerns:
{{risks}}

Generate a professional pre-read briefing in Markdown that board members can read in 10 minutes before the meeting. Structure:

1. **# Board Pre-read — {{meetingDate}}**
2. **Executive summary** — 3 sentences covering: where we are, what we want from this meeting, what's at stake
3. **Metrics dashboard** — clean table or bullet list of the key numbers, with QoQ or MoM comparisons where relevant
4. **What's working** — 2-3 bullets on what's going well, with proof
5. **What's not** — 2-3 bullets on what isn't working, with what we're doing about it
6. **Strategic decisions for the board** — for each decision the board needs to make, write a 1-paragraph framing that includes: the question, the context, the professional's recommendation, and the alternatives considered
7. **Risks worth surfacing** — bullet list of the top 3-5 risks, each with a one-sentence mitigation plan
8. **Asks of the board** — specific things you need from board members between now and the next meeting

Tone guidelines:
- Concise. Board members are busy; this should be readable in <10 minutes.
- Honest about challenges. Don't minimize, don't catastrophize.
- Specific. Use real numbers, real names, real dates.
- Action-oriented. End every section with something the reader can act on.
- No corporate jargon. Write like you're talking to a smart friend who cares about the company.`;

export const BoardMeetingPrep: WorkflowTemplate = {
  id: 'board-meeting-prep',
  name: 'Board Meeting Prep',
  description: 'Generate a time-boxed board meeting agenda and a pre-read briefing document covering metrics, decisions, and risks.',
  version: '1.0.0',
  category: 'planning',
  steps: [
    {
      id: 'interview',
      type: 'interview',
      name: 'Meeting Interview',
      description: 'Answer questions about the meeting, attendees, topics, and decisions',
      config: {
        questions: interviewQuestions,
      } as InterviewStepConfig,
    },
    {
      id: 'generate-agenda',
      type: 'generate',
      name: 'Generate Agenda',
      description: 'Create a time-boxed agenda',
      config: {
        outputFile: 'board/{{meetingDate}}-agenda.md',
        promptTemplate: agendaPrompt,
        systemPrompt: 'You are an experienced executive assistant who has drafted hundreds of board meeting agendas. You know how to sequence topics for maximum clarity and how to time-box discussions to keep meetings on schedule.',
      } as GenerateStepConfig,
    },
    {
      id: 'generate-briefing',
      type: 'generate',
      name: 'Generate Pre-read Briefing',
      description: 'Draft the pre-read document for board members',
      config: {
        outputFile: 'board/{{meetingDate}}-briefing.md',
        promptTemplate: briefingPrompt,
        systemPrompt: 'You are a senior chief of staff who has prepared briefing documents for executive boards. You know what board members actually want to read: numbers, decisions, risks, and asks. You never write filler.',
      } as GenerateStepConfig,
    },
  ],
  requiredInputs: [],
  outputs: ['board/{{meetingDate}}-agenda.md', 'board/{{meetingDate}}-briefing.md'],
};

export default BoardMeetingPrep;
