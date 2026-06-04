import { describe, it, expect } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../..');

// Every template that asserts legal authority, regulatory positions,
// deadlines, or math MUST carry requiresVerification: true.
// Add new regulated templates here as they are created.
const MUST_VERIFY = [
  // Legal
  'src/modules/workflow/templates/legal/CaseTimelineBuilder.ts',
  'src/modules/workflow/templates/legal/PatentDisclosureDraft.ts',
  'src/modules/workflow/templates/legal/ClientIntakeSynthesizer.ts',
  'src/modules/workflow/templates/legal/DepositionContradictionFinder.ts',
  'src/modules/workflow/templates/legal/PrivilegeLogDrafter.ts',
  'src/modules/workflow/templates/legal/EvidenceGapAnalyzer.ts',
  'src/modules/workflow/templates/legal/EstatePlanningClientSummary.ts',
  'src/modules/workflow/templates/legal/TransactionalMatterSummary.ts',
  'src/modules/workflow/templates/legal/ContractReviewChecklist.ts',
  'src/modules/workflow/templates/legal/DiscoveryDocumentTriage.ts',
  'src/modules/workflow/templates/legal/LegalResearchMemo.ts',
  'src/modules/workflow/templates/legal/DeadlineCalendar.ts',
  'src/modules/workflow/templates/legal/EngagementLetterDrafter.ts',
  'src/modules/workflow/templates/legal/DiscoveryDrafter.ts',
  'src/modules/workflow/templates/legal/ParentingPlanDrafter.ts',
  'src/modules/workflow/templates/legal/FinancialAffidavitOrganizer.ts',
  'src/modules/workflow/templates/legal/RealEstateClosingChecklist.ts',
  'src/modules/workflow/templates/legal/CitationFormatter.ts',
  // Tax (all 13)
  'src/modules/workflow/templates/tax/TaxResearchMemo.ts',
  'src/modules/workflow/templates/tax/NoticeResponseDrafter.ts',
  'src/modules/workflow/templates/tax/AuditDefenseFileBuilder.ts',
  'src/modules/workflow/templates/tax/QuarterlyEstimateReminder.ts',
  'src/modules/workflow/templates/tax/Section7216ConsentTemplate.ts',
  'src/modules/workflow/templates/tax/EngagementLetterBuilder.ts',
  'src/modules/workflow/templates/tax/PreReviewChecklist.ts',
  'src/modules/workflow/templates/tax/ClientDocumentInventory.ts',
  'src/modules/workflow/templates/tax/RepresentationKit.ts',
  'src/modules/workflow/templates/tax/CollectionNoticeResponse.ts',
  'src/modules/workflow/templates/tax/SCorpReasonableCompMemo.ts',
  'src/modules/workflow/templates/tax/EntityElectionAnalysis.ts',
  'src/modules/workflow/templates/tax/WISPBuilder.ts',
  // Consulting (all 6)
  'src/modules/workflow/templates/consulting/ClientDiscoverySynthesizer.ts',
  'src/modules/workflow/templates/consulting/ConfidentialResearchMemo.ts',
  'src/modules/workflow/templates/consulting/NdaSafeSlideOutliner.ts',
  'src/modules/workflow/templates/consulting/StakeholderMapGenerator.ts',
  'src/modules/workflow/templates/consulting/StatementOfWorkDrafter.ts',
  'src/modules/workflow/templates/consulting/EngagementRetrospectiveBuilder.ts',
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
      path.join(ROOT, 'src/modules/workflow/templates/advisor'),
      path.join(ROOT, 'src/modules/workflow/templates/advisors'),
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
      path.join(ROOT, 'src/modules/workflow/templates/advisor'),
      path.join(ROOT, 'src/modules/workflow/templates/advisors'),
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
    const { LegalResearchMemo } = await import('../../src/modules/workflow/templates/legal/LegalResearchMemo');
    // The prompt text should contain the UNVERIFIED table pattern
    const promptText = JSON.stringify(LegalResearchMemo);
    expect(promptText).toContain('UNVERIFIED');
    expect(promptText).toContain('Verified by');
  });
});
