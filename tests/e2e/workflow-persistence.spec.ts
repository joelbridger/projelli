/**
 * Workflow-as-file persistence tests
 *
 * `.workflow` files are JSON snapshots of a workflow execution that live in
 * the per-run folder alongside any generated artifacts. The MainPanel routes
 * any tab whose path ends in `.workflow` through WorkflowExecutionTab,
 * regardless of whether the tab type is `file` or `workflow-execution`.
 *
 * These tests focus on what's verifiable in test mode (the mock workspace
 * service has no `mkdir`, so a full engine run can't complete). We seed the
 * editor store with a `.workflow` tab whose content is a valid
 * WorkflowFileData JSON and verify:
 *   1. WorkflowExecutionTab renders and shows the template name
 *   2. The header reflects the persisted step index
 *   3. Re-opening the same path dedups (no duplicate tab)
 *   4. Updating the tab content via updateContent re-renders the header
 *   5. An invalid `.workflow` payload renders the friendly error message
 */

import { test, expect } from '@playwright/test';
import { waitForTestModeLoad } from './helpers/test-utils';

const SAMPLE_TEMPLATE = {
  id: 'tpl_demo',
  name: 'Demo Template',
  description: 'A sample template for testing',
  version: '1.0.0',
  category: 'planning' as const,
  steps: [
    { id: 's1', type: 'interview' as const, name: 'Step One', config: { questions: [] } },
    { id: 's2', type: 'generate' as const, name: 'Step Two',
      config: { outputFile: 'out.md', promptTemplate: 'go' } },
    { id: 's3', type: 'review' as const, name: 'Step Three',
      config: { inputFile: 'out.md', reviewPrompt: 'review' } },
    { id: 's4', type: 'generate' as const, name: 'Step Four',
      config: { outputFile: 'out2.md', promptTemplate: 'go again' } },
    { id: 's5', type: 'generate' as const, name: 'Step Five',
      config: { outputFile: 'out3.md', promptTemplate: 'final' } },
  ],
  requiredInputs: [],
  outputs: [],
};

function buildSampleFileData(stepIndex: number, status: 'running' | 'completed' = 'running') {
  return {
    schemaVersion: 1,
    runId: 'run_test_demo',
    template: SAMPLE_TEMPLATE,
    workflowFolderPath: '/test-workspace/Demo Template - 2026-04-15_14-30-00',
    currentStepIndex: stepIndex,
    status,
    inputs: {},
    stepOutputs: [],
    completedAnswers: [],
    artifacts: [],
    startTime: '2026-04-15T14:30:00.000Z',
    ...(status === 'completed' ? { endTime: '2026-04-15T14:35:00.000Z' } : {}),
  };
}

test.describe('Workflow-as-file persistence', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);
  });

  test('opens a .workflow file and renders the workflow tab', async ({ page }) => {
    const filePath = '/test-workspace/Demo Template - 2026-04-15_14-30-00/demo-template-2026-04-15-1430.workflow';
    const fileName = 'demo-template-2026-04-15-1430.workflow';

    await page.evaluate(
      ({ path, name, payload }) => {
        const editor = (window as any).__editorStore?.getState?.();
        if (editor?.openTab) {
          editor.openTab(path, name, JSON.stringify(payload, null, 2), 'workflow-execution');
        }
      },
      { path: filePath, name: fileName, payload: buildSampleFileData(2) }
    );

    const tab = page.getByTestId('workflow-execution-tab');
    await expect(tab).toBeVisible();
    await expect(tab).toContainText('Demo Template');
    // Step index 2 of 5 → header should read "Step 3 of 5".
    await expect(tab).toContainText('Step 3 of 5');
  });

  test('completed status shows Complete in the header', async ({ page }) => {
    const filePath = '/test-workspace/runs/finished-2026-04-15-1430.workflow';
    const fileName = 'finished-2026-04-15-1430.workflow';

    await page.evaluate(
      ({ path, name, payload }) => {
        const editor = (window as any).__editorStore?.getState?.();
        if (editor?.openTab) {
          editor.openTab(path, name, JSON.stringify(payload, null, 2), 'workflow-execution');
        }
      },
      {
        path: filePath,
        name: fileName,
        payload: buildSampleFileData(SAMPLE_TEMPLATE.steps.length, 'completed'),
      }
    );

    const tab = page.getByTestId('workflow-execution-tab');
    await expect(tab).toBeVisible();
    await expect(tab).toContainText('Complete');
  });

  test('opening the same .workflow path twice dedups (single tab)', async ({ page }) => {
    const filePath = '/test-workspace/runs/dedup-2026-04-15-1430.workflow';
    const fileName = 'dedup-2026-04-15-1430.workflow';

    const openCount = await page.evaluate(
      ({ path, name, payload }) => {
        const editor = (window as any).__editorStore?.getState?.();
        const json = JSON.stringify(payload, null, 2);
        editor.openTab(path, name, json, 'workflow-execution');
        editor.openTab(path, name, json, 'workflow-execution');
        const state = (window as any).__editorStore?.getState?.();
        return state.openTabs.filter((t: { path: string }) => t.path === path).length;
      },
      { path: filePath, name: fileName, payload: buildSampleFileData(0) }
    );

    expect(openCount).toBe(1);
    await expect(page.getByTestId('workflow-execution-tab')).toBeVisible();
  });

  test('updateContent on a workflow tab re-renders the new step index', async ({ page }) => {
    const filePath = '/test-workspace/runs/update-2026-04-15-1430.workflow';
    const fileName = 'update-2026-04-15-1430.workflow';

    await page.evaluate(
      ({ path, name, payload }) => {
        const editor = (window as any).__editorStore?.getState?.();
        editor.openTab(path, name, JSON.stringify(payload, null, 2), 'workflow-execution');
      },
      { path: filePath, name: fileName, payload: buildSampleFileData(0) }
    );

    const tab = page.getByTestId('workflow-execution-tab');
    await expect(tab).toBeVisible();
    await expect(tab).toContainText('Step 1 of 5');

    // Bump the step index via updateContent; the same in-memory contract
    // the live engine uses for debounced writes.
    await page.evaluate(
      ({ path, payload }) => {
        const editor = (window as any).__editorStore?.getState?.();
        editor.updateContent(path, JSON.stringify(payload, null, 2));
      },
      { path: filePath, payload: buildSampleFileData(3) }
    );

    await expect(tab).toContainText('Step 4 of 5');
  });

  test('invalid .workflow content shows the friendly error message', async ({ page }) => {
    const filePath = '/test-workspace/runs/broken-2026-04-15-1430.workflow';
    const fileName = 'broken-2026-04-15-1430.workflow';

    await page.evaluate(
      ({ path, name }) => {
        const editor = (window as any).__editorStore?.getState?.();
        editor.openTab(path, name, 'this is not valid json', 'workflow-execution');
      },
      { path: filePath, name: fileName }
    );

    // The wrapper still mounts but the inner content shows the error.
    await expect(page.getByText(/failed to load workflow file/i)).toBeVisible();
  });
});
