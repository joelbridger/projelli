/**
 * Workflow execution tab horizontal-overflow tests (Task 8 / Phase 0)
 *
 * Bug: at 1366×768 (common laptop width) the workflow execution tab clips:
 *   - content runs past the right edge
 *   - a dark "Source" pill control renders at x < 0 (left edge)
 *
 * TDD approach: spec fails first (offender list is the diagnosis), fix is
 * applied, spec passes.  Runs at both 1366×768 and 1920×1080.
 */

import { test, expect } from '@playwright/test';
import { waitForTestModeLoad, switchToStandaloneEditorSurface } from './helpers/test-utils';
import { horizontalOverflow } from './helpers/overflow';

// Minimal but realistic workflow file payload — enough to render the step
// list, progress bar, and header (the main overflow-prone region).
const SAMPLE_TEMPLATE = {
  id: 'tpl_overflow_test',
  name: 'Deposition Contradiction Finder',
  description:
    'Analyzes deposition transcripts to surface internal inconsistencies and contradictions for attorney review. Produces a structured Word deliverable with verified and unverified findings.',
  version: '1.0.0',
  category: 'litigation' as const,
  steps: [
    {
      id: 's1',
      type: 'interview' as const,
      name: 'Collect deposition transcripts',
      description: 'Upload the deposition PDF files you want analyzed',
      config: { questions: [] },
    },
    {
      id: 's2',
      type: 'generate' as const,
      name: 'Extract factual claims from transcript',
      description: 'AI reads each transcript and extracts timestamped factual claims',
      config: { outputFile: 'claims.md', promptTemplate: 'extract claims' },
    },
    {
      id: 's3',
      type: 'analyze' as const,
      name: 'Cross-reference claims for contradictions',
      description: 'Compare claims across transcripts and flag inconsistencies',
      config: { inputFile: 'claims.md' },
    },
    {
      id: 's4',
      type: 'review' as const,
      name: 'Attorney review of flagged contradictions',
      description: 'Present findings for attorney verification before export',
      config: { inputFile: 'out.md', reviewPrompt: 'review contradictions' },
    },
    {
      id: 's5',
      type: 'generate' as const,
      name: 'Generate Word deliverable with citations',
      description: 'Produce a formatted Word document ready for court filing',
      config: { outputFile: 'Contradiction-Report.docx', promptTemplate: 'final report' },
    },
  ],
  requiredInputs: [],
  outputs: [],
};

function buildRunningPayload(stepIndex: number) {
  return {
    schemaVersion: 1,
    runId: 'run_overflow_test',
    template: SAMPLE_TEMPLATE,
    workflowFolderPath: '/test-workspace/Deposition Contradiction Finder - 2026-06-10_10-00-00',
    currentStepIndex: stepIndex,
    status: 'running',
    inputs: {},
    stepOutputs: [],
    completedAnswers: [],
    artifacts: [],
    startTime: '2026-06-10T10:00:00.000Z',
  };
}

// Screenshot writes into docs/ were removed (overwrote committed artifacts and
// raced across parallel locale projects). Screenshots are captured by
// Playwright's --screenshot flag or trace viewer when debugging is needed.

async function injectWorkflowTab(
  page: import('@playwright/test').Page,
  filePath: string,
  fileName: string,
  payload: object
) {
  // MainPanel (and its workflow-execution tab render) only mounts on the
  // standalone editor surface (sidebarActiveTab === 'files') — see
  // helpers/test-utils.ts's switchToStandaloneEditorSurface. openTab has no
  // standalone-open counterpart to __openTestFile, so switch first, then
  // poke the store directly (as before).
  await switchToStandaloneEditorSurface(page);
  await page.evaluate(
    ({ p, n, pl }) => {
      const editor = (window as any).__editorStore?.getState?.();
      if (editor?.openTab) {
        editor.openTab(p, n, JSON.stringify(pl, null, 2), 'workflow-execution');
      }
    },
    { p: filePath, n: fileName, pl: payload }
  );
  // Wait for the tab to render
  await expect(page.getByTestId('workflow-execution-tab')).toBeVisible();
}

test.describe('Workflow tab horizontal overflow', () => {
  // -------------------------------------------------------------------------
  // 1366×768 — common laptop viewport (the bug viewport)
  // -------------------------------------------------------------------------
  test('no horizontal overflow at 1366×768', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);

    const filePath =
      '/test-workspace/Deposition Contradiction Finder - 2026-06-10_10-00-00/deposition-contradiction-finder-2026-06-10-1000.workflow';
    const fileName = 'deposition-contradiction-finder-2026-06-10-1000.workflow';

    await injectWorkflowTab(page, filePath, fileName, buildRunningPayload(1));

    const offenders = await horizontalOverflow(page);

    expect(
      offenders,
      `Horizontal overflow offenders at 1366×768:\n${offenders.join('\n')}`
    ).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // 1920×1080 — wide desktop (must also be clean)
  // -------------------------------------------------------------------------
  test('no horizontal overflow at 1920×1080', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);

    const filePath =
      '/test-workspace/Deposition Contradiction Finder - 2026-06-10_10-00-00/deposition-contradiction-finder-2026-06-10-1000b.workflow';
    const fileName = 'deposition-contradiction-finder-2026-06-10-1000b.workflow';

    await injectWorkflowTab(page, filePath, fileName, buildRunningPayload(2));

    const offenders = await horizontalOverflow(page);

    expect(
      offenders,
      `Horizontal overflow offenders at 1920×1080:\n${offenders.join('\n')}`
    ).toEqual([]);
  });
});
