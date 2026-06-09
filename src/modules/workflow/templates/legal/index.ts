// Legal Practice Pack v2.1 (shipped). Built with input from practicing attorneys.
// Drafting aid: every generated output carries a banner requiring professional review before use.
//
// ─────────────────────────────────────────────────────────────────────────
// WS-D — Litigation-associate pattern (Keepance 3.0)
// ─────────────────────────────────────────────────────────────────────────
//
// The Deposition Contradiction Finder is the PROVEN flagship for the 3.0
// litigation associate: grounded in matter-scoped cited retrieval, structured
// findings each carrying a verifiable citation, and a real Word (.docx)
// deliverable. The rest of the legal pack are MECHANICAL follow-ups onto the
// same foundation. Two adoption levels, both already supported by the engine:
//
//   1. Office output (zero logic — every `generate` template can take it now):
//      change the step's `outputFile` (and the template `outputs[]`) from
//      `*.md` to `*.docx`. `WorkflowEngine.writeDeliverable` renders the
//      model's markdown to Word automatically via `markdownToDocxBytes` and
//      writes it through `writeFileBinary`. No prompt change required.
//
//   2. Grounded + cited findings (the full associate): replace the `generate`
//      step with an `analyze` step (`type: 'analyze'`,
//      `config: AnalyzeStepConfig`). Pick/extend `AnalyzeKind`, give it a
//      `retrievalQueryTemplate` (interpolated, matter-scoped, privilege
//      EXCLUDED), a `promptTemplate` that consumes `{{retrievedContext}}` and
//      cites source NUMBERS, and a `.docx` `outputFile`. The engine pulls the
//      ACTIVE matter scope, retrieves, asks for the structured schema, verifies
//      EVERY citation via `rag_verify_citation`, marks unverified findings, and
//      renders the Word deliverable. The grounding/verification/render seams
//      live in `../legalAnalysis.ts` + `serializeContradictionsDocx`
//      (`src/utils/docx-io.ts`); reuse them for new structured kinds
//      (timeline, privilege-log, discovery-triage, …).
//
// Keep every legal template `@draft` with `requiresVerification: true` and its
// verification banner. Un-drafting requires attorney sign-off (out of scope).

import { DepositionContradictionFinder } from './DepositionContradictionFinder';
import { EvidenceGapAnalyzer } from './EvidenceGapAnalyzer';
import { CaseTimelineBuilder } from './CaseTimelineBuilder';
import { PrivilegeLogDrafter } from './PrivilegeLogDrafter';
import { DiscoveryDocumentTriage } from './DiscoveryDocumentTriage';
import { PatentDisclosureDraft } from './PatentDisclosureDraft';
import { ClientIntakeSynthesizer } from './ClientIntakeSynthesizer';
import { TransactionalMatterSummary } from './TransactionalMatterSummary';
import { EstatePlanningClientSummary } from './EstatePlanningClientSummary';
import { ContractReviewChecklist } from './ContractReviewChecklist';
import { LegalResearchMemo } from './LegalResearchMemo';
import { DeadlineCalendar } from './DeadlineCalendar';
import { EngagementLetterDrafter } from './EngagementLetterDrafter';
import { DiscoveryDrafter } from './DiscoveryDrafter';
import { ParentingPlanDrafter } from './ParentingPlanDrafter';
import { FinancialAffidavitOrganizer } from './FinancialAffidavitOrganizer';
import { RealEstateClosingChecklist } from './RealEstateClosingChecklist';
import { CitationFormatter } from './CitationFormatter';

import type { WorkflowTemplate } from '@/types/workflow';

export const LEGAL_TEMPLATES: WorkflowTemplate[] = [
  DepositionContradictionFinder,
  EvidenceGapAnalyzer,
  CaseTimelineBuilder,
  PrivilegeLogDrafter,
  DiscoveryDocumentTriage,
  PatentDisclosureDraft,
  ClientIntakeSynthesizer,
  TransactionalMatterSummary,
  EstatePlanningClientSummary,
  ContractReviewChecklist,
  LegalResearchMemo,
  DeadlineCalendar,
  EngagementLetterDrafter,
  DiscoveryDrafter,
  ParentingPlanDrafter,
  FinancialAffidavitOrganizer,
  RealEstateClosingChecklist,
  CitationFormatter,
];

export {
  DepositionContradictionFinder,
  EvidenceGapAnalyzer,
  CaseTimelineBuilder,
  PrivilegeLogDrafter,
  DiscoveryDocumentTriage,
  PatentDisclosureDraft,
  ClientIntakeSynthesizer,
  TransactionalMatterSummary,
  EstatePlanningClientSummary,
  ContractReviewChecklist,
  LegalResearchMemo,
  DeadlineCalendar,
  EngagementLetterDrafter,
  DiscoveryDrafter,
  ParentingPlanDrafter,
  FinancialAffidavitOrganizer,
  RealEstateClosingChecklist,
  CitationFormatter,
};
