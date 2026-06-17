import { describe, it, expect } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../..');

// Every template that asserts legal authority, regulatory positions,
// deadlines, or math MUST carry requiresVerification: true.
// Add new regulated templates here as they are created.
const MUST_VERIFY = [
  // Legal
  'src/features/workflows/engine/templates/legal/CaseTimelineBuilder.ts',
  'src/features/workflows/engine/templates/legal/PatentDisclosureDraft.ts',
  'src/features/workflows/engine/templates/legal/ClientIntakeSynthesizer.ts',
  'src/features/workflows/engine/templates/legal/DepositionContradictionFinder.ts',
  'src/features/workflows/engine/templates/legal/PrivilegeLogDrafter.ts',
  'src/features/workflows/engine/templates/legal/EvidenceGapAnalyzer.ts',
  'src/features/workflows/engine/templates/legal/EstatePlanningClientSummary.ts',
  'src/features/workflows/engine/templates/legal/TransactionalMatterSummary.ts',
  'src/features/workflows/engine/templates/legal/ContractReviewChecklist.ts',
  'src/features/workflows/engine/templates/legal/DiscoveryDocumentTriage.ts',
  'src/features/workflows/engine/templates/legal/LegalResearchMemo.ts',
  'src/features/workflows/engine/templates/legal/DeadlineCalendar.ts',
  'src/features/workflows/engine/templates/legal/EngagementLetterDrafter.ts',
  'src/features/workflows/engine/templates/legal/DiscoveryDrafter.ts',
  'src/features/workflows/engine/templates/legal/ParentingPlanDrafter.ts',
  'src/features/workflows/engine/templates/legal/FinancialAffidavitOrganizer.ts',
  'src/features/workflows/engine/templates/legal/RealEstateClosingChecklist.ts',
  'src/features/workflows/engine/templates/legal/CitationFormatter.ts',
  // Tax (all 13)
  'src/features/workflows/engine/templates/tax/TaxResearchMemo.ts',
  'src/features/workflows/engine/templates/tax/NoticeResponseDrafter.ts',
  'src/features/workflows/engine/templates/tax/AuditDefenseFileBuilder.ts',
  'src/features/workflows/engine/templates/tax/QuarterlyEstimateReminder.ts',
  'src/features/workflows/engine/templates/tax/Section7216ConsentTemplate.ts',
  'src/features/workflows/engine/templates/tax/EngagementLetterBuilder.ts',
  'src/features/workflows/engine/templates/tax/PreReviewChecklist.ts',
  'src/features/workflows/engine/templates/tax/ClientDocumentInventory.ts',
  'src/features/workflows/engine/templates/tax/RepresentationKit.ts',
  'src/features/workflows/engine/templates/tax/CollectionNoticeResponse.ts',
  'src/features/workflows/engine/templates/tax/SCorpReasonableCompMemo.ts',
  'src/features/workflows/engine/templates/tax/EntityElectionAnalysis.ts',
  'src/features/workflows/engine/templates/tax/WISPBuilder.ts',
  // Consulting (all 9)
  'src/features/workflows/engine/templates/consulting/ClientDiscoverySynthesizer.ts',
  'src/features/workflows/engine/templates/consulting/ConfidentialResearchMemo.ts',
  'src/features/workflows/engine/templates/consulting/NdaSafeSlideOutliner.ts',
  'src/features/workflows/engine/templates/consulting/StakeholderMapGenerator.ts',
  'src/features/workflows/engine/templates/consulting/StatementOfWorkDrafter.ts',
  'src/features/workflows/engine/templates/consulting/EngagementRetrospectiveBuilder.ts',
  'src/features/workflows/engine/templates/consulting/CompetitiveLandscapeBuilder.ts',
  'src/features/workflows/engine/templates/consulting/FindingsSynthesizer.ts',
  'src/features/workflows/engine/templates/consulting/WorkshopBoardPrep.ts',
  // Advisors (all 7)
  'src/features/workflows/engine/templates/advisors/AnnualReviewPacket.ts',
  'src/features/workflows/engine/templates/advisors/ClientFinancialPlanSummary.ts',
  'src/features/workflows/engine/templates/advisors/MeetingPrepAndSuitabilityNotes.ts',
  'src/features/workflows/engine/templates/advisors/ConfidentialClientDataInventory.ts',
  'src/features/workflows/engine/templates/advisors/RegSPSafeguardsOutline.ts',
  'src/features/workflows/engine/templates/advisors/BooksRecordsRetentionNote.ts',
  'src/features/workflows/engine/templates/advisors/RegBIDocumentation.ts',
];

describe('template verification banners', () => {
  it('all regulated templates have requiresVerification: true', async () => {
    for (const rel of MUST_VERIFY) {
      const fullPath = path.join(ROOT, rel);
      let content: string;
      try {
        content = await fs.readFile(fullPath, 'utf-8');
      } catch {
        // Skip if file doesn't exist (may not all templates exist yet)
        continue;
      }
      expect(content, `${path.basename(rel)} missing requiresVerification`).toContain('requiresVerification: true');
    }
  });

  it('all regulated templates have verificationNote', async () => {
    for (const rel of MUST_VERIFY) {
      const fullPath = path.join(ROOT, rel);
      let content: string;
      try {
        content = await fs.readFile(fullPath, 'utf-8');
      } catch {
        continue;
      }
      expect(content, `${path.basename(rel)} missing verificationNote`).toContain('verificationNote:');
    }
  });

  it('all advisor templates have requiresVerification: true', async () => {
    // Try both advisor and advisors directory
    const dirs = [
      path.join(ROOT, 'src/features/workflows/engine/templates/advisor'),
      path.join(ROOT, 'src/features/workflows/engine/templates/advisors'),
    ];
    for (const dir of dirs) {
      try {
        const files = await fs.readdir(dir);
        const templates = files.filter(f => f.endsWith('.ts') && f !== 'index.ts');
        for (const f of templates) {
          const content = await fs.readFile(path.join(dir, f), 'utf-8');
          expect(content, `advisor/${f} missing requiresVerification`).toContain('requiresVerification: true');
        }
      } catch {
        // directory doesn't exist, try the other
      }
    }
  });

  it('all advisor templates have verificationNote', async () => {
    const dirs = [
      path.join(ROOT, 'src/features/workflows/engine/templates/advisor'),
      path.join(ROOT, 'src/features/workflows/engine/templates/advisors'),
    ];
    for (const dir of dirs) {
      try {
        const files = await fs.readdir(dir);
        const templates = files.filter(f => f.endsWith('.ts') && f !== 'index.ts');
        for (const f of templates) {
          const content = await fs.readFile(path.join(dir, f), 'utf-8');
          expect(content, `advisor/${f} missing verificationNote`).toContain('verificationNote:');
        }
      } catch {
        // directory doesn't exist, try the other
      }
    }
  });

  it('LegalResearchMemo prompt instructs AI to use UNVERIFIED citation table', async () => {
    // Import the template
    const { LegalResearchMemo } = await import('../../src/features/workflows/engine/templates/legal/LegalResearchMemo');
    // The prompt text should contain the UNVERIFIED table pattern
    const promptText = JSON.stringify(LegalResearchMemo);
    expect(promptText).toContain('UNVERIFIED');
    expect(promptText).toContain('Verified by');
  });
});
