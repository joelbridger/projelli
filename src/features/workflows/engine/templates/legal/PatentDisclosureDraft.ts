// Legal Practice Pack v2.1 (shipped). Built with input from practicing attorneys.
// Drafting aid: every generated output carries a banner requiring professional review before use.

// NOTE: `category: 'legal'` requires adding 'legal' to the WorkflowTemplate category
// union in src/platform/types/workflow.ts before this template is registered.

import type { WorkflowTemplate, InterviewStepConfig, GenerateStepConfig } from '@/platform/types/workflow';
import { BRAND } from '@/config/brand';

const interviewQuestions: InterviewStepConfig['questions'] = [
  {
    id: 'inventorNames',
    question: 'Inventor name(s)',
    description: 'Full legal names of all inventors. All individuals who contributed to the conception of the claimed invention must be listed. Inventorship is a legal determination — this is a starting point for the attorney to verify.',
    type: 'text',
    required: true,
    placeholder: 'e.g., Dr. Aisha Patel, Marcus Chen',
  },
  {
    id: 'inventionTitle',
    question: 'Invention title',
    description: 'A descriptive working title for the invention. This will likely be refined before filing.',
    type: 'text',
    required: true,
    placeholder: 'e.g., Adaptive Thermal Management System for High-Density Lithium-Ion Battery Arrays',
  },
  {
    id: 'technicalField',
    question: 'Technical field',
    description: 'The field of technology to which the invention belongs. This maps to the "Field of the Invention" section of the application.',
    type: 'text',
    required: true,
    placeholder: 'e.g., Battery management systems, electric vehicle engineering, thermal management',
  },
  {
    id: 'problemSolved',
    question: 'Problem the invention solves',
    description: 'Describe the problem or need that existed before this invention. What was wrong with existing solutions? What gap did this invention address? Be specific and technical.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Existing lithium-ion battery management systems rely on passive thermal dissipation, which causes uneven heat distribution across cells during high-load discharge cycles. This leads to premature cell degradation in the hottest cells while cooler cells remain underutilized, reducing overall pack life and creating safety risks at high discharge rates.',
  },
  {
    id: 'howItWorks',
    question: 'How the invention works',
    description: 'Describe the invention in technical detail — how it achieves the result, what its key components are, and how they interact. The more specific and technical, the better the disclosure. Include any novel steps, structures, or methods.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., The system uses a network of micro-sensors embedded between cells to monitor individual cell temperature in real time at 100ms intervals. A microcontroller processes sensor data and dynamically routes coolant through individually addressable microchannels using shape-memory alloy actuators. Routing is determined by a predictive thermal model that anticipates hotspot formation 2–3 cycles in advance...',
  },
  {
    id: 'novelty',
    question: 'What makes it novel — how it differs from existing solutions',
    description: 'Describe specifically what is new about this invention compared to what was already known. What did prior systems do differently? What does this invention do that no prior system could do?',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., Prior systems use fixed coolant routing determined at design time. This invention uses dynamic, real-time routing based on actual sensor data rather than static thermal models. The use of shape-memory alloy actuators for coolant routing in this context is believed to be novel — prior art uses motorized valves which are slower, larger, and have higher failure rates.',
  },
  {
    id: 'priorArt',
    question: 'Prior art the inventor knows of (optional)',
    description: 'List any patents, publications, products, or other prior art the inventor is aware of. Inventors have a duty of candor to the USPTO — full disclosure is important. Include patent numbers if known.',
    type: 'textarea',
    required: false,
    placeholder: 'e.g., US Patent 10,xxx,xxx (Smith et al.) — describes passive thermal management for battery arrays. Tesla BMS system (general knowledge). Paper: "Active Thermal Management in EV Battery Packs," Journal of Power Sources, 2023.',
  },
  {
    id: 'bestMode',
    question: 'Best mode of carrying out the invention',
    description: 'Describe the preferred embodiment — the specific implementation the inventors believe is the best way to practice the invention. US patent law requires disclosure of the best mode known to the inventors at the time of filing.',
    type: 'textarea',
    required: true,
    placeholder: 'e.g., The preferred embodiment uses Nitinol (nickel-titanium) shape-memory alloy actuators rated for 50,000+ cycles, an STM32H7 microcontroller running the thermal prediction algorithm at 200MHz, and 1mm diameter microchannels etched into an aluminum cold plate. Target operating temperature range is -20°C to 60°C ambient.',
  },
  {
    id: 'filingJurisdictions',
    question: 'Filing jurisdiction targets',
    description: 'Where the patent will be filed. Affects the attorney\'s strategy for claim scope, translation requirements, and prosecution timeline.',
    type: 'select',
    required: true,
    options: ['US only', 'US + PCT (international)', 'US + specific countries (note in comments)'],
    defaultValue: 'US only',
  },
];

const patentDisclosurePrompt = `You are assisting a patent attorney in structuring an invention disclosure document from an inventor's description. This document is for the attorney's internal use in preparing a patent application — it is not itself a patent application, and it does not constitute legal advice.

Inventor(s): {{inventorNames}}
Invention title: {{inventionTitle}}
Technical field: {{technicalField}}
Problem solved: {{problemSolved}}
How it works: {{howItWorks}}
Novelty: {{novelty}}
Prior art known to inventor: {{priorArt}}
Best mode: {{bestMode}}
Filing jurisdictions: {{filingJurisdictions}}

Produce a structured Markdown invention disclosure document in standard IDF format:

> **DRAFT INVENTION DISCLOSURE -- FOR ATTORNEY REVIEW. Claim language is preliminary and must be refined by a registered patent attorney or agent before filing. Inventorship is a legal determination; verify all inventors listed.**

> **Draft document** -- Review and edit before use in any client work.

> **IMPORTANT NOTICE:** This document is a structural starting point to assist your patent attorney in preparing an application. It is not a formal patent application, does not constitute legal advice, and has not been reviewed by the USPTO or any patent authority. No confidential technical information was transmitted to any third party in generating this document -- ${BRAND.name} processes all AI requests locally using your own API key, and no data leaves your machine except in direct API calls to your chosen AI provider under your own account.

# Invention Disclosure Form (IDF)
**Inventor(s):** {{inventorNames}}
**Working title:** {{inventionTitle}}
**Prepared for attorney review:** [date]
**Filing target(s):** {{filingJurisdictions}}

---

## 1. TITLE OF INVENTION
[Descriptive title suitable for a patent application -- typically 10 words or fewer, no trade names or brand references. Based on: {{inventionTitle}}]

---

## 2. INVENTORS

| Name | Institution / Company | Contribution to Conception |
|------|-----------------------|---------------------------|
| [Inventor name from {{inventorNames}}] | [Institution or employer] | [What this inventor specifically conceived] |

Note: Inventorship is a legal determination based on who contributed to the conception of the claimed subject matter. Adding or omitting an inventor is a legal error with serious consequences. The attorney must verify this list before filing.

---

## 3. FIELD OF THE INVENTION
[One paragraph. Identify the technical field to which the invention belongs. Based on: {{technicalField}}]

---

## 4. BACKGROUND OF THE INVENTION

### Problem the Invention Solves
[Describe the problem or unmet need that existed before this invention. Be specific and technical. Based on: {{problemSolved}}]

### Prior Art Summary
[Describe what existing solutions do and why they are inadequate. Based on inventor-disclosed prior art: {{priorArt}}. Note: the attorney should conduct a professional prior art search to supplement what the inventor has disclosed here. Inventors have a duty of candor to the USPTO -- full disclosure of known prior art is required.]

---

## 5. SUMMARY OF THE INVENTION

[One to two paragraphs. Describe what is new about this invention and how it differs from the prior art. Based on: {{novelty}}]

**Independent claim sketch (starting point for attorney -- attorney will finalize claim language):**

A [method/system/apparatus] for [achieving the result], comprising:
- [Key element or step 1]
- [Key element or step 2]
- [Key element or step 3]

---

## 6. DETAILED DESCRIPTION

### Overview of Key Components or Steps
[List and describe the primary components or steps of the invention, drawn from the inventor's description]

### How the Invention Works
[Describe the functional relationships and operation of the system or method. Based on: {{howItWorks}}]

### Preferred Embodiment
[Describe the best mode as disclosed by the inventor. US patent law requires disclosure of the best mode known to the inventors at the time of filing. Based on: {{bestMode}}]

### Possible Variations and Alternative Embodiments
[Based on the description, identify possible alternative embodiments or design variations the attorney may want to capture in dependent claims. Label these clearly as suggestions for attorney consideration.]

---

## 7. CLAIMS SKETCH (DRAFT -- for attorney refinement)

**These are not formal patent claims. They are preliminary structural sketches for the attorney's use in drafting claims. Claims require attorney authorship, legal precision, and prosecution strategy that AI cannot provide. Do not submit these to any patent office without attorney revision.**

**Independent Claim 1 (method):**
A method for [achieving the result], comprising:
- [Step 1]
- [Step 2]
- [Step 3]

**Independent Claim 2 (system/apparatus):**
A system for [the function], comprising:
- [Component 1] configured to [function]
- [Component 2] configured to [function]
- [Component 3] configured to [function]

**Independent Claim 3 (broader/alternative angle):**
[A broader or differently-angled independent claim that captures the inventive concept from a different perspective -- for attorney consideration]

**Directions for dependent claims:**
- [Narrower limitation 1 -- specific materials, parameters, or sub-steps]
- [Narrower limitation 2]
- [Narrower limitation 3]

---

## 8. ABSTRACT
[150 words or fewer. Concise technical description of the invention suitable as a starting point for the patent abstract.]

---

## 9. DRAWINGS NEEDED

List of figures that would support the application. The attorney and a patent illustrator will prepare formal drawings; this list identifies what should be depicted.

- Figure 1: [e.g., Overall system diagram showing major components and their relationships]
- Figure 2: [e.g., Flowchart of the primary method steps]
- Figure 3: [e.g., Detailed view of the key novel component]
- [Add additional figures as needed based on the invention description]

---

## 10. PRE-FILING CHECKLIST

Answer each question before filing. Flag any "Yes" answers for attorney review before proceeding.

- [ ] **Prior art identified?** Has the inventor identified any prior art (patents, publications, products) that is similar to this invention? If yes, list it in Section 4.
- [ ] **Public disclosure made?** Has the invention been publicly disclosed in any form (conference presentation, paper, website, demo, public use) before this IDF was prepared? If yes, note the date -- this may start a statutory bar clock.
- [ ] **Offer for sale made?** Has the invention been offered for sale before filing? If yes, note the date.
- [ ] **Joint inventors verified?** Has the attorney confirmed that all individuals who contributed to the conception of the claimed subject matter are listed, and that no one is listed who did not contribute?
- [ ] **Assignment in place?** If the invention was made in the course of employment or under a funded research agreement, is an assignment agreement in place?
- [ ] **Best mode confirmed?** Does the preferred embodiment section reflect the inventors' best mode as of the intended filing date?
- [ ] **International filing strategy confirmed?** If filing via PCT or in specific countries, are deadlines and translation requirements identified?
- [ ] **Professional prior art search ordered?** Has the attorney ordered a professional search beyond the prior art disclosed by the inventor?
- [ ] **Formal drawings ordered?** Have formal patent drawings been commissioned for all embodiments described?

---

*This document was prepared with the assistance of AI and has not been reviewed by a licensed patent attorney. Do not rely on it as legal advice. Do not submit it to any patent office without attorney review.*`;

export const PatentDisclosureDraft: WorkflowTemplate = {
  id: 'legal-patent-disclosure-draft',
  name: 'Patent Disclosure Draft',
  description: 'Structure an invention disclosure document from an inventor\'s description, for use by a patent attorney in drafting the application. Covers technical field, background, summary, detailed description, claims sketch (starting point only), abstract, and a pre-filing checklist. Includes a local-first data notice.',
  version: '1.0.0',
  category: 'legal',
  requiresVerification: true,
  verificationNote: 'Inventorship is a legal determination. Have a registered patent attorney review this disclosure before submission.',
  steps: [
    {
      id: 'interview',
      type: 'interview',
      name: 'Invention Description',
      description: 'Describe the invention — what it does, how it works, what makes it new, and where you plan to file',
      config: {
        questions: interviewQuestions,
      } as InterviewStepConfig,
    },
    {
      id: 'generate-disclosure',
      type: 'generate',
      name: 'Generate Invention Disclosure',
      description: 'Structure the invention description into a formal disclosure document',
      config: {
        outputFile: 'PATENT_DISCLOSURE_DRAFT.docx',
        promptTemplate: patentDisclosurePrompt,
        systemPrompt: `You are a patent prosecution assistant helping a licensed patent attorney structure an invention disclosure in standard IDF (Invention Disclosure Form) format aligned with USPTO and EPO application structure. You are technically precise, methodical, and explicit about what requires attorney judgment. You structure output with the labeled sections: TITLE OF INVENTION, INVENTORS (table), FIELD OF THE INVENTION, BACKGROUND OF THE INVENTION, SUMMARY OF THE INVENTION, DETAILED DESCRIPTION, CLAIMS SKETCH, ABSTRACT, DRAWINGS NEEDED, and PRE-FILING CHECKLIST. The claims sketch section contains 3 to 5 independent claim sketches in plain language, each labeled DRAFT and explicitly noted as requiring attorney refinement -- you never present them as legally sufficient. The inventors table includes columns for Name, Institution/Company, and Contribution to Conception, with a note that inventorship is a legal determination the attorney must verify. You open the document with the mandatory header: "DRAFT INVENTION DISCLOSURE -- FOR ATTORNEY REVIEW. Claim language is preliminary and must be refined by a registered patent attorney or agent before filing. Inventorship is a legal determination; verify all inventors listed." You surface best mode and inventorship issues proactively. You prominently note that this document is not legal advice and that no confidential information was transmitted to third parties, given ${BRAND.possessive} local-first architecture.`,
      } as GenerateStepConfig,
    },
  ],
  requiredInputs: [],
  outputs: ['PATENT_DISCLOSURE_DRAFT.docx'],
  namedOutputs: [
    { id: 'claims_sketch', name: 'Claims sketch (starting point)', schema: 'array' },
    { id: 'prefiling_checklist', name: 'Pre-filing checklist', schema: 'array' },
    { id: 'prior_art_flagged', name: 'Prior art flagged by inventor', schema: 'array' },
  ],
};

export default PatentDisclosureDraft;
