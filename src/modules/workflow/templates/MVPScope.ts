// MVP Scope Definition Workflow Template
// Helps founders define their minimum viable product

import type { WorkflowTemplate, InterviewStepConfig, GenerateStepConfig } from '@/types/workflow';

const interviewQuestions: InterviewStepConfig['questions'] = [
  {
    id: 'productVision',
    question: 'What is your full product vision?',
    description: 'Describe the complete product you imagine building',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., A complete project management platform with task tracking, time tracking, invoicing, team chat, document collaboration, and AI assistance',
  },
  {
    id: 'coreValue',
    question: 'What is the ONE core value your product delivers?',
    description: 'The single most important benefit for users',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Helps freelancers get paid faster by automating invoice creation and follow-ups',
  },
  {
    id: 'targetUser',
    question: 'Who is the specific user for your MVP?',
    description: 'Narrow down to a very specific user type',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Solo freelance designers in the US who invoice 5+ clients per month',
  },
  {
    id: 'mainJob',
    question: 'What is the main job-to-be-done?',
    description: 'The primary task users hire your product to do',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Create and send professional invoices quickly without manual data entry',
  },
  {
    id: 'existingAlternatives',
    question: 'How do users currently solve this?',
    description: 'Current workarounds and alternatives',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Manual invoices in Word/Google Docs, spreadsheet templates, basic invoicing apps like Wave',
  },
  {
    id: 'constraints',
    question: 'What are your constraints?',
    description: 'Time, budget, technical skills available',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., 3 months timeline, $5K budget, solo developer, can only work nights/weekends',
  },
  {
    id: 'featureWishlist',
    question: 'List all features you have considered',
    description: 'Everything you might want to build (we will prioritize)',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Invoice creation, time tracking, expense tracking, payment processing, client portal, recurring invoices, reports, team accounts, mobile app',
  },
  {
    id: 'mustHaves',
    question: 'What MUST be in v1 for users to get value?',
    description: 'Features without which the product is useless',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Create invoice, send invoice, mark as paid - bare minimum to replace manual process',
  },
  {
    id: 'successMetric',
    question: 'How will you know if the MVP is successful?',
    description: 'The key metric that validates your hypothesis',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., 100 invoices sent through the platform in first month',
  },
];

const mvpScopePrompt = `You are helping a solo founder define their MVP scope using lean startup principles.

Based on the following information:

**Full Vision:** {{productVision}}
**Core Value:** {{coreValue}}
**Target User:** {{targetUser}}
**Main Job-to-be-Done:** {{mainJob}}
**Current Alternatives:** {{existingAlternatives}}
**Constraints:** {{constraints}}
**Feature Wishlist:** {{featureWishlist}}
**Must-Haves:** {{mustHaves}}
**Success Metric:** {{successMetric}}

Generate a comprehensive MVP Scope document in Markdown format:

# MVP Scope Definition

## Executive Summary
[2-3 paragraphs describing the MVP strategy]

## MVP Philosophy

### What is an MVP?
An MVP is the smallest version of your product that can test your core hypothesis and deliver value to early adopters.

### Our Core Hypothesis
[State the hypothesis being tested with this MVP]

### Success Criteria
**Primary Metric:** {{successMetric}}

**MVP is successful if:**
- [ ] [Quantitative measure 1]
- [ ] [Quantitative measure 2]
- [ ] [Qualitative signal]

## Target User

### MVP User Persona
- **Who:** {{targetUser}}
- **Main Job:** {{mainJob}}
- **Current Solution:** [What they use now]
- **Why They'll Switch:** [Specific pain we solve better]

### Who This MVP is NOT For
[Explicitly list who to say no to]

## Feature Prioritization

### MoSCoW Analysis

#### Must Have (MVP Core)
| Feature | Reason | Complexity |
|---------|--------|------------|
| [Feature 1] | [Why essential] | Low/Med/High |
| [Feature 2] | [Why essential] | Low/Med/High |
| [Feature 3] | [Why essential] | Low/Med/High |

#### Should Have (v1.1)
| Feature | Reason | Complexity |
|---------|--------|------------|
| [Feature 1] | [Value added] | Low/Med/High |
| [Feature 2] | [Value added] | Low/Med/High |

#### Could Have (v1.2+)
| Feature | Reason | Complexity |
|---------|--------|------------|
| [Feature 1] | [Nice to have] | Low/Med/High |
| [Feature 2] | [Nice to have] | Low/Med/High |

#### Won't Have (Future/Never)
| Feature | Reason |
|---------|--------|
| [Feature 1] | [Why cutting] |
| [Feature 2] | [Why cutting] |

### Feature Cutting Exercise
For each feature NOT in Must Have, ask:
1. Can users get core value without it? ✓ Cut it
2. Can we fake it manually at first? ✓ Fake it
3. Does it serve our target user specifically? ✗ Cut it

## MVP User Journey

### Happy Path
[Step-by-step journey of a user successfully using the MVP]

1. **Entry:** [How user finds/starts]
2. **Setup:** [Minimal onboarding]
3. **Core Action:** [Main value-delivering action]
4. **Value Moment:** [When they experience the benefit]
5. **Retention Hook:** [What brings them back]

### What We're NOT Building
[Explicit list of common features we're skipping and why]

- ❌ [Feature] - Because [reason]
- ❌ [Feature] - Because [reason]
- ❌ [Feature] - Because [reason]

## Technical Scope

### Build vs Buy vs Fake

| Capability | Approach | Rationale |
|------------|----------|-----------|
| [Capability 1] | Build/Buy/Fake | [Why] |
| [Capability 2] | Build/Buy/Fake | [Why] |
| [Capability 3] | Build/Buy/Fake | [Why] |

### Technology Constraints
- Platform: [Web/Mobile/Desktop]
- Stack: [Recommended simple stack]
- Integrations: [Essential only]

### What to Cut Technically
- No [complex feature]
- No [scaling optimization]
- No [advanced architecture]
- Manual processes acceptable for [X]

## MVP Specification

### Core Screens/Views
1. **[Screen 1]:** [Purpose, key elements]
2. **[Screen 2]:** [Purpose, key elements]
3. **[Screen 3]:** [Purpose, key elements]

### Core User Actions
1. [Action 1] - [How it works in MVP]
2. [Action 2] - [How it works in MVP]
3. [Action 3] - [How it works in MVP]

### Data Model (Simplified)
[Minimal data entities needed]

## Timeline & Milestones

### Given Constraints
{{constraints}}

### Proposed Timeline
| Week | Focus | Deliverable |
|------|-------|-------------|
| 1-2 | [Phase] | [Output] |
| 3-4 | [Phase] | [Output] |
| 5-6 | [Phase] | [Output] |
| 7-8 | [Phase] | [Output] |

### Scope Creep Prevention
**If we fall behind, cut (in order):**
1. [Feature to cut first]
2. [Feature to cut second]
3. [Feature to cut third]

## Validation Plan

### How We'll Test the MVP
1. [Validation method 1]
2. [Validation method 2]
3. [Validation method 3]

### Metrics to Track
| Metric | Target | Tool |
|--------|--------|------|
| [Metric 1] | [Target] | [How to track] |
| [Metric 2] | [Target] | [How to track] |

### When to Iterate vs Pivot
**Iterate if:**
- [Signal]

**Pivot if:**
- [Signal]

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| [Risk 1] | H/M/L | [Plan] |
| [Risk 2] | H/M/L | [Plan] |`;

const userStoriesPrompt = `You are helping a solo founder write user stories for their MVP.

Based on:
**Target User:** {{targetUser}}
**Main Job:** {{mainJob}}
**Must-Have Features:** {{mustHaves}}
**Core Value:** {{coreValue}}

Generate MVP User Stories in Markdown format:

# MVP User Stories

## Epic: Core Value Delivery

### Story 1: [Primary Action]
**As a** {{targetUser}}
**I want to** [action]
**So that** [benefit]

**Acceptance Criteria:**
- [ ] Given [context], when [action], then [result]
- [ ] Given [context], when [action], then [result]
- [ ] Given [context], when [action], then [result]

**Notes:**
- MVP simplification: [What we're cutting]
- Technical consideration: [If any]

---

### Story 2: [Secondary Action]
**As a** {{targetUser}}
**I want to** [action]
**So that** [benefit]

**Acceptance Criteria:**
- [ ] Given [context], when [action], then [result]
- [ ] Given [context], when [action], then [result]

**Notes:**
- MVP simplification: [What we're cutting]

---

[Continue with 8-12 total user stories covering MVP scope]

## Epic: User Onboarding

### Story: First-Time Setup
**As a** new user
**I want to** [minimal setup action]
**So that** I can start using the product quickly

**Acceptance Criteria:**
- [ ] User can complete setup in under [X] minutes
- [ ] No required fields except [essentials]
- [ ] Clear guidance on next steps

**MVP Note:** Skip [complex onboarding elements]. Manual onboarding acceptable.

---

## Epic: Account Management

### Story: Basic Account
**As a** user
**I want to** [basic account function]
**So that** [reason]

**Acceptance Criteria:**
- [ ] [Criteria]

**MVP Note:** [What's simplified]

---

## User Story Map

### Backbone (User Journey)
[Discovery] → [Signup] → [Setup] → [Core Action] → [Value Moment] → [Return]

### Walking Skeleton (MVP)
| Step | MVP Story | Post-MVP |
|------|-----------|----------|
| Discovery | N/A - manual | Landing page |
| Signup | Email only | Social auth |
| Setup | [Minimal] | [Full onboarding] |
| Core Action | [MVP version] | [Full version] |
| Value Moment | [MVP version] | [Enhanced] |
| Return | [Manual reminder] | [Automated] |

## Story Prioritization

### Sprint 1 (Must Ship)
1. [Story with points]
2. [Story with points]
3. [Story with points]
Total: [X] points

### Sprint 2 (Should Ship)
1. [Story with points]
2. [Story with points]
Total: [X] points

### Backlog (Nice to Have)
1. [Story]
2. [Story]

## Definition of Done (MVP)

A story is done when:
- [ ] Core functionality works
- [ ] Happy path tested manually
- [ ] No critical bugs
- [ ] Basic error handling
- [ ] Works on [target platform/browser]

**NOT required for MVP:**
- Unit tests (add post-MVP)
- Comprehensive error handling
- Performance optimization
- Accessibility compliance (basic only)
- Cross-browser testing (primary browser only)`;

export const MVPScope: WorkflowTemplate = {
  id: 'mvp-scope',
  name: 'MVP Scope Definition',
  description: 'Define your minimum viable product with feature prioritization and user stories.',
  version: '1.0.0',
  category: 'planning',
  steps: [
    {
      id: 'interview',
      type: 'interview',
      name: 'MVP Planning Interview',
      description: 'Define your vision, constraints, and priorities',
      config: {
        questions: interviewQuestions,
      } as InterviewStepConfig,
    },
    {
      id: 'generate-scope',
      type: 'generate',
      name: 'Generate MVP Scope',
      description: 'Create a comprehensive MVP scope document',
      config: {
        outputFile: 'MVP_SCOPE.md',
        promptTemplate: mvpScopePrompt,
        systemPrompt: 'You are a lean startup expert helping founders ship faster by cutting scope ruthlessly. Be opinionated about what to cut.',
      } as GenerateStepConfig,
    },
    {
      id: 'generate-stories',
      type: 'generate',
      name: 'Generate User Stories',
      description: 'Create MVP user stories with acceptance criteria',
      config: {
        outputFile: 'MVP_USER_STORIES.md',
        promptTemplate: userStoriesPrompt,
        systemPrompt: 'You are an agile product expert writing clear, testable user stories. Keep stories small and focused.',
      } as GenerateStepConfig,
    },
  ],
  requiredInputs: [],
  outputs: ['MVP_SCOPE.md', 'MVP_USER_STORIES.md'],
};

export default MVPScope;
