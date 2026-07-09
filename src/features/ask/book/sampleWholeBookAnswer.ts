import type { Matter } from '@/platform/types/matter';
import type { BookAskResult } from './bookFacts';
import {
  SAMPLE_FILE_BENEFICIARY_ESTATE,
  SAMPLE_FILE_PLAN_SUMMARY,
  sampleFilePath,
} from '@/platform/matter/samples/sampleMatterDemo';
import { matterLabel } from '@/platform/rag/matterResolver';

function sampleSource(workspaceRoot: string | undefined, filename: string, snippet: string) {
  return {
    kind: 'document' as const,
    ref: workspaceRoot ? sampleFilePath(workspaceRoot, filename) : filename,
    snippet,
  };
}

export function buildSampleWholeBookAnswer(matter: Matter): BookAskResult & { model: string } {
  const workspaceRoot = matter.folderPaths[0];
  return {
    model: 'Sample practice',
    answer:
      'The Hendricks Household needs a beneficiary follow-up before the next review. The open items are Robert\'s consulting 401(k) and Susan\'s school 403(b), plus a Roth conversion check before Q4 paperwork is prepared.',
    matches: [
      {
        matterId: matter.id,
        label: matterLabel(matter),
        facts: [
          {
            itemId: 'sample-whole-book-beneficiary-followup',
            sectionKey: 'followups',
            text:
              'Beneficiary clean-up is mostly done, but Robert\'s consulting 401(k) and Susan\'s school 403(b) still need confirmation.',
            source: sampleSource(
              workspaceRoot,
              SAMPLE_FILE_BENEFICIARY_ESTATE,
              'Confirm Robert\'s consulting 401(k) beneficiary designations match the intended primary/contingent lineup.',
            ),
          },
          {
            itemId: 'sample-whole-book-roth-followup',
            sectionKey: 'followups',
            text:
              'A Q4 Roth conversion is still planned, with paperwork to prepare after the final tax projection.',
            source: sampleSource(
              workspaceRoot,
              SAMPLE_FILE_PLAN_SUMMARY,
              '2024 target conversion: $48,000 (fills the 24% bracket based on projected income).',
            ),
          },
        ],
      },
    ],
  };
}
