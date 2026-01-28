// Landing Page Workflow Template
// Helps founders create landing page copy and structure

import type { WorkflowTemplate, InterviewStepConfig, GenerateStepConfig } from '@/types/workflow';

const interviewQuestions: InterviewStepConfig['questions'] = [
  {
    id: 'productName',
    question: 'What is your product name?',
    description: 'The name of your product or service',
    type: 'text',
    required: true,
    placeholder: 'e.g., TaskFlow',
  },
  {
    id: 'productDescription',
    question: 'What does your product do?',
    description: 'Clear explanation of your product',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., AI-powered project management that automatically tracks progress and identifies blockers',
  },
  {
    id: 'targetAudience',
    question: 'Who is this landing page for?',
    description: 'The specific visitor you are targeting',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Engineering managers at remote-first startups looking for better project visibility',
  },
  {
    id: 'mainBenefit',
    question: 'What is the #1 benefit for users?',
    description: 'The primary transformation or outcome',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Get 5 hours back every week by eliminating status update meetings',
  },
  {
    id: 'keyFeatures',
    question: 'What are your key features (list 3-5)?',
    description: 'Main features that deliver the benefit',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Automatic progress tracking, AI-generated status reports, Smart blocker detection, Slack integration',
  },
  {
    id: 'socialProof',
    question: 'What social proof do you have?',
    description: 'Testimonials, logos, numbers, press',
    type: 'textarea',
    required: false,
    placeholder: 'e.g., "Cut our standups from 30 min to 5" - CTO at Acme. 500+ teams, Featured in TechCrunch',
  },
  {
    id: 'objections',
    question: 'What objections might visitors have?',
    description: 'Concerns that prevent them from signing up',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., "Will my team actually use this?", "Is my data secure?", "How does it integrate with our tools?"',
  },
  {
    id: 'cta',
    question: 'What is your primary call-to-action?',
    description: 'What you want visitors to do',
    type: 'select',
    required: true,
    options: ['Start free trial', 'Sign up free', 'Get early access', 'Book a demo', 'Join waitlist', 'Download now'],
    defaultValue: 'Start free trial',
  },
  {
    id: 'pageType',
    question: 'What type of landing page do you need?',
    description: 'The style and purpose of the page',
    type: 'select',
    required: true,
    options: ['Homepage (full product)', 'Feature page (specific feature)', 'Campaign page (specific audience)', 'Waitlist page (pre-launch)', 'Comparison page (vs competitor)'],
    defaultValue: 'Homepage (full product)',
  },
  {
    id: 'brandTone',
    question: 'What is your brand tone?',
    description: 'How your brand should sound',
    type: 'select',
    required: true,
    options: ['Professional & trustworthy', 'Friendly & approachable', 'Bold & confident', 'Technical & precise', 'Playful & fun'],
    defaultValue: 'Friendly & approachable',
  },
];

const landingPagePrompt = `You are helping a solo founder create landing page copy.

Based on the following information:

**Product Name:** {{productName}}
**Product Description:** {{productDescription}}
**Target Audience:** {{targetAudience}}
**Main Benefit:** {{mainBenefit}}
**Key Features:** {{keyFeatures}}
**Social Proof:** {{socialProof}}
**Objections:** {{objections}}
**CTA:** {{cta}}
**Page Type:** {{pageType}}
**Brand Tone:** {{brandTone}}

Generate comprehensive Landing Page Copy in Markdown format:

# {{productName}} Landing Page Copy

## Page Structure Overview
[Describe the recommended layout and flow]

---

## Section 1: Hero

### Headline Options
1. **[Primary headline - benefit-focused]**
2. [Alternative - problem-focused]
3. [Alternative - curiosity-driven]

### Subheadline
[1-2 sentences that expand on the headline and explain what the product does]

### Hero CTA
**Button:** [{{cta}}]
**Supporting text:** [Text below button, e.g., "No credit card required"]

### Hero Visual
**Recommendation:** [Describe what image/video/screenshot should be shown]

---

## Section 2: Social Proof Bar
[If social proof available]

### Logos
"Trusted by teams at [Company 1], [Company 2], [Company 3]"

### Key Stat
"[Number] [teams/users/customers] [trust/use/love] {{productName}}"

---

## Section 3: Problem/Pain

### Section Headline
[Headline that calls out the problem]

### Pain Points
**Pain Point 1:** [Problem description]
**Pain Point 2:** [Problem description]
**Pain Point 3:** [Problem description]

### Agitation
[1-2 sentences that amplify the pain - what happens if they don't solve this?]

---

## Section 4: Solution/How It Works

### Section Headline
"Here's how {{productName}} helps"

### Step 1
**Title:** [Action]
**Description:** [Brief explanation]
**Visual:** [Screenshot/illustration description]

### Step 2
**Title:** [Action]
**Description:** [Brief explanation]
**Visual:** [Screenshot/illustration description]

### Step 3
**Title:** [Action]
**Description:** [Brief explanation]
**Visual:** [Screenshot/illustration description]

---

## Section 5: Features/Benefits

### Section Headline
[Benefit-focused headline]

### Feature 1
**Icon:** [Suggested icon]
**Title:** [Feature name]
**Description:** [How it helps the user - focus on benefit]

### Feature 2
**Icon:** [Suggested icon]
**Title:** [Feature name]
**Description:** [How it helps the user - focus on benefit]

### Feature 3
**Icon:** [Suggested icon]
**Title:** [Feature name]
**Description:** [How it helps the user - focus on benefit]

### Feature 4 (if applicable)
**Icon:** [Suggested icon]
**Title:** [Feature name]
**Description:** [How it helps the user - focus on benefit]

---

## Section 6: Testimonials

### Testimonial 1
> "[Quote that addresses a specific benefit or objection]"
>
> **— [Name], [Title] at [Company]**

### Testimonial 2
> "[Quote that addresses a different benefit or objection]"
>
> **— [Name], [Title] at [Company]**

### Testimonial 3 (optional)
> "[Quote]"
>
> **— [Name], [Title] at [Company]**

**Note:** [Guidance on collecting testimonials if none exist yet]

---

## Section 7: Objection Handling / FAQ

### FAQ 1: [Common objection as question]
**Answer:** [Address the concern directly]

### FAQ 2: [Common objection as question]
**Answer:** [Address the concern directly]

### FAQ 3: [Common objection as question]
**Answer:** [Address the concern directly]

### FAQ 4: [Practical question]
**Answer:** [Clear answer]

---

## Section 8: Final CTA

### Headline
[Motivating headline that creates urgency or summarizes value]

### Subheadline
[Remove risk/friction, reinforce benefit]

### Button
**Primary:** [{{cta}}]
**Secondary (optional):** [Alternative action, e.g., "See demo"]

---

## Section 9: Footer

### Links to Include
- Product: Features, Pricing, Integrations, Security
- Company: About, Blog, Careers, Press
- Resources: Help Center, Documentation, Status
- Legal: Privacy Policy, Terms of Service

---

## Conversion Best Practices

### Above the Fold Checklist
- [ ] Clear headline communicates main benefit
- [ ] Subheadline explains what product does
- [ ] Primary CTA is visible
- [ ] Hero visual shows product in action

### Copy Principles Used
1. Benefits over features
2. Specific over vague
3. Customer language
4. Address objections
5. Single clear CTA

### A/B Test Recommendations
1. [Element to test first]
2. [Element to test second]
3. [Element to test third]`;

const wireframePrompt = `You are helping a solo founder create a landing page wireframe.

Based on:
**Product Name:** {{productName}}
**Main Benefit:** {{mainBenefit}}
**Key Features:** {{keyFeatures}}
**Page Type:** {{pageType}}

Generate a Landing Page Wireframe Guide in Markdown format:

# {{productName}} Landing Page Wireframe

## Page Layout Specification

### Overall Structure
\`\`\`
┌─────────────────────────────────────────────────────────────┐
│                     NAVIGATION BAR                          │
│  Logo          Features  Pricing  Blog       [CTA Button]   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│                         HERO                                │
│                                                             │
│     [Headline - Large, Bold]                                │
│     [Subheadline - Medium]                                  │
│                                                             │
│            [    Primary CTA Button    ]                     │
│              No credit card required                        │
│                                                             │
│     ┌───────────────────────────────────────────┐          │
│     │                                           │          │
│     │          Product Screenshot/Video         │          │
│     │                                           │          │
│     └───────────────────────────────────────────┘          │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                    SOCIAL PROOF BAR                         │
│     "Trusted by" [Logo] [Logo] [Logo] [Logo] [Logo]        │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│                    PROBLEM SECTION                          │
│                                                             │
│     [Section Headline]                                      │
│                                                             │
│     ┌─────────┐  ┌─────────┐  ┌─────────┐                  │
│     │ Pain 1  │  │ Pain 2  │  │ Pain 3  │                  │
│     │         │  │         │  │         │                  │
│     └─────────┘  └─────────┘  └─────────┘                  │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│                    HOW IT WORKS                             │
│                                                             │
│     [Section Headline]                                      │
│                                                             │
│     Step 1 ────────────────> Step 2 ────────────> Step 3   │
│     [Icon]                   [Icon]               [Icon]    │
│     [Title]                  [Title]              [Title]   │
│     [Desc]                   [Desc]               [Desc]    │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│                    FEATURES SECTION                         │
│                                                             │
│     [Section Headline]                                      │
│                                                             │
│     ┌──────────────────┐    ┌──────────────────────────┐   │
│     │                  │    │  Feature Title           │   │
│     │   Screenshot     │    │  Description text that   │   │
│     │                  │    │  explains the benefit    │   │
│     └──────────────────┘    └──────────────────────────┘   │
│                                                             │
│     ┌──────────────────────────┐    ┌──────────────────┐   │
│     │  Feature Title           │    │                  │   │
│     │  Description text that   │    │   Screenshot     │   │
│     │  explains the benefit    │    │                  │   │
│     └──────────────────────────┘    └──────────────────┘   │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│                    TESTIMONIALS                             │
│                                                             │
│     ┌─────────────────────────────────────────────────┐    │
│     │  "Quote from happy customer about results"      │    │
│     │                                                 │    │
│     │  [Photo] Name, Title at Company                 │    │
│     └─────────────────────────────────────────────────┘    │
│                                                             │
│     ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│     │   Quote 2    │  │   Quote 3    │  │   Quote 4    │   │
│     └──────────────┘  └──────────────┘  └──────────────┘   │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│                         FAQ                                 │
│                                                             │
│     ┌─────────────────────────────────────────────────┐    │
│     │  Question 1                                  [+]│    │
│     └─────────────────────────────────────────────────┘    │
│     ┌─────────────────────────────────────────────────┐    │
│     │  Question 2                                  [+]│    │
│     └─────────────────────────────────────────────────┘    │
│     ┌─────────────────────────────────────────────────┐    │
│     │  Question 3                                  [+]│    │
│     └─────────────────────────────────────────────────┘    │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│                      FINAL CTA                              │
│                                                             │
│     [Motivating Headline]                                   │
│     [Subheadline]                                          │
│                                                             │
│            [    Primary CTA Button    ]                     │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                        FOOTER                               │
│  Product     Company     Resources    Legal     [Social]   │
│  - Features  - About     - Help       - Privacy            │
│  - Pricing   - Blog      - Docs       - Terms              │
│  - Security  - Careers   - Status                          │
│                                                             │
│  © 2026 {{productName}}. All rights reserved.              │
└─────────────────────────────────────────────────────────────┘
\`\`\`

## Responsive Considerations

### Mobile Layout
- Stack all sections vertically
- Single column layout
- Hamburger menu for navigation
- Larger touch targets for buttons
- Simplified testimonial carousel
- Collapsed FAQ accordion

### Tablet Layout
- 2-column feature sections
- Side-by-side testimonials
- Full navigation visible

## Component Specifications

### Navigation
- **Height:** 64px desktop, 56px mobile
- **Logo:** Left aligned
- **Links:** Center or right aligned
- **CTA Button:** Contrasting color, right aligned

### Hero Section
- **Height:** 80-90vh (viewport height)
- **Headline:** 48-64px desktop, 32-40px mobile
- **Subheadline:** 18-24px
- **CTA Button:** Large, prominent, 48px height minimum
- **Product Image:** 60% of section width, shadow/depth

### Feature Cards
- **Width:** 300-400px each
- **Icon:** 48px, brand color
- **Title:** 20-24px, bold
- **Description:** 16px, regular

### Testimonials
- **Card Width:** 350-400px
- **Quote:** 18-20px, italic
- **Photo:** 48-64px circle
- **Name:** 16px bold
- **Title:** 14px regular

### CTA Buttons
- **Primary:** Brand color background, white text
- **Secondary:** White background, brand color text/border
- **Padding:** 16px 32px
- **Border Radius:** 8px (or match brand style)

## Color Usage Guide
- **Primary CTA:** [Recommend high contrast]
- **Headings:** [Dark, high contrast]
- **Body text:** [Slightly lighter]
- **Backgrounds:** Alternate white/light gray sections
- **Accent:** Use sparingly for emphasis

## Typography Recommendations
- **Headlines:** [Sans-serif, bold weight]
- **Body:** [Sans-serif, regular weight, 16-18px]
- **Line Height:** 1.5-1.6 for body text`;

export const LandingPage: WorkflowTemplate = {
  id: 'landing-page',
  name: 'Landing Page Copy',
  description: 'Create conversion-focused landing page copy and wireframe specifications.',
  version: '1.0.0',
  category: 'planning',
  steps: [
    {
      id: 'interview',
      type: 'interview',
      name: 'Landing Page Interview',
      description: 'Gather information about your product and target audience',
      config: {
        questions: interviewQuestions,
      } as InterviewStepConfig,
    },
    {
      id: 'generate-copy',
      type: 'generate',
      name: 'Generate Landing Page Copy',
      description: 'Create section-by-section landing page copy',
      config: {
        outputFile: 'LANDING_PAGE_COPY.md',
        promptTemplate: landingPagePrompt,
        systemPrompt: 'You are a conversion copywriter helping founders create landing pages that convert. Use proven frameworks and write compelling copy.',
      } as GenerateStepConfig,
    },
    {
      id: 'generate-wireframe',
      type: 'generate',
      name: 'Generate Wireframe Guide',
      description: 'Create wireframe specifications and layout guide',
      config: {
        outputFile: 'LANDING_PAGE_WIREFRAME.md',
        promptTemplate: wireframePrompt,
        systemPrompt: 'You are a UX designer helping founders structure effective landing pages. Be specific about layout and components.',
      } as GenerateStepConfig,
    },
  ],
  requiredInputs: [],
  outputs: ['LANDING_PAGE_COPY.md', 'LANDING_PAGE_WIREFRAME.md'],
};

export default LandingPage;
