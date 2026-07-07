/**
 * useWorkflowRunner — BUG F2 (data-loss): a terminal `.workflow` run-record
 * write (completed/failed/cancelled) that fails on every retry must be
 * SURFACED, not just silently console.warn'd. This test drives the real
 * hook end-to-end with `isTestMode: true` (so it resolves the MockProvider,
 * no API keys required) and a `workspaceServiceRef.writeFile` that succeeds
 * for the run's own artifact writes but fails for every `.workflow` snapshot
 * write from the point the run finishes onward — simulating a disk hiccup
 * exactly when the terminal record is written.
 *
 * See also: `tests/unit/retryWithBackoff.test.ts` (the extracted bounded-
 * retry helper, unit-tested in isolation with an injected instant `sleep`)
 * and `tests/unit/workflow/workflowFile-path-helpers.test.ts` (Bug F3-1b's
 * subfolder-preserving path join, also extracted as a pure function).
 */
import { renderHook, act } from '@testing-library/react';
import { beforeEach, describe, it, expect, vi } from 'vitest';

import { useWorkflowRunner } from '@/app/workflow/useWorkflowRunner';
import type { WorkflowTemplate, GenerateStepConfig } from '@/platform/types/workflow';
import type { FileNode } from '@/platform/types/workspace';
import { useMatterStore } from '@/platform/matter/matterStore';
import type { Matter } from '@/platform/types/matter';

function saveErrorTemplate(): WorkflowTemplate {
  return {
    id: 'save-error-template',
    name: 'Save Error Template',
    description: '',
    version: '1.0.0',
    category: 'custom',
    steps: [
      {
        id: 'g',
        type: 'generate',
        name: 'Generate',
        config: {
          outputFile: 'Out.md',
          promptTemplate: 'Write something.',
        } as GenerateStepConfig,
      },
    ],
    requiredInputs: [],
    outputs: ['Out.md'],
  };
}

function makeWorkspaceServiceRef(writeFile: (path: string, content: string) => Promise<void>) {
  return {
    current: {
      exists: vi.fn(async () => false),
      readFile: vi.fn(async () => ''),
      writeFile,
      writeFileBinary: vi.fn(async () => {}),
      mkdir: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
      getFileTree: vi.fn(async (): Promise<FileNode[]> => []),
    },
  };
}

describe('useWorkflowRunner — terminal write failure surfacing (Bug F2)', () => {
  beforeEach(() => {
    useMatterStore.setState({ matters: [], activeMatterId: null });
  });

  it(
    'sets workflowSaveError and logs an audit entry when the terminal .workflow write fails on every retry',
    async () => {
      // Calls 1-2 (the initial .workflow snapshot, then the generate step's
      // own "Out.md" artifact) succeed; every write from call 3 onward
      // (the terminal write + its retries) fails — simulating a disk
      // problem that starts right as the run finishes.
      let callCount = 0;
      const writeFile = vi.fn(async () => {
        callCount += 1;
        if (callCount <= 2) return;
        throw new Error('simulated disk failure');
      });
      const workspaceServiceRef = makeWorkspaceServiceRef(writeFile);
      const addAuditEntry = vi.fn();

      const { result } = renderHook(() =>
        useWorkflowRunner({
          rootPath: '/workspace',
          isTestMode: true,
          apiKeys: [],
          completeRun: vi.fn(),
          openTab: vi.fn(),
          setFileTree: vi.fn(),
          addAuditEntry,
          workspaceServiceRef,
          templatesMetadataReaderRef: { current: null },
          templatesMarketplaceServiceRef: { current: null },
        })
      );

      expect(result.current.workflowSaveError).toBeNull();

      await act(async () => {
        await result.current.handleStartWorkflow(saveErrorTemplate());
      });

      // The run itself completed fine (2 successful writes: initial snapshot
      // + the generate step's artifact) — only the terminal record write is
      // broken, which is exactly the scenario Bug F2 describes: the
      // deliverable may be fine, but the audit/replay record is at risk.
      expect(callCount).toBeGreaterThanOrEqual(3);
      expect(result.current.workflowSaveError).toBeTruthy();
      expect(typeof result.current.workflowSaveError).toBe('string');

      // The failure is also recorded in the audit log, so it's visible in
      // the Activity tab even if a caller doesn't render the inline banner.
      const saveFailureEntry = addAuditEntry.mock.calls.find(
        ([entry]) =>
          (entry as { metadata?: { auditEventType?: string } }).metadata?.auditEventType ===
          'workflow_save_failed'
      );
      expect(saveFailureEntry).toBeDefined();
    },
    15000
  );

  it('does not set workflowSaveError when the terminal write succeeds', async () => {
    const writeFile = vi.fn(async () => {});
    const workspaceServiceRef = makeWorkspaceServiceRef(writeFile);
    const addAuditEntry = vi.fn();

    const { result } = renderHook(() =>
      useWorkflowRunner({
        rootPath: '/workspace',
        isTestMode: true,
        apiKeys: [],
        completeRun: vi.fn(),
        openTab: vi.fn(),
        setFileTree: vi.fn(),
        addAuditEntry,
        workspaceServiceRef,
        templatesMetadataReaderRef: { current: null },
        templatesMarketplaceServiceRef: { current: null },
      })
    );

    await act(async () => {
      await result.current.handleStartWorkflow(saveErrorTemplate());
    });

    expect(result.current.workflowSaveError).toBeNull();
    expect(
      addAuditEntry.mock.calls.some(
        ([entry]) =>
          (entry as { metadata?: { auditEventType?: string } }).metadata?.auditEventType ===
          'workflow_save_failed'
      )
    ).toBe(false);
  });

  it('saves workflow outputs under the active client Documents/Workflows folder and records a clickable result title', async () => {
    const activeMatter: Matter = {
      id: 'matter-alice',
      name: 'Retirement Review',
      client: 'Alice Smith',
      folderPaths: ['/workspace/Clients/Alice Smith'],
      mailFolderPaths: [],
      privileged: false,
      createdAt: new Date().toISOString(),
    };
    useMatterStore.setState({ matters: [activeMatter], activeMatterId: activeMatter.id });

    const writeFile = vi.fn(async () => {});
    const workspaceServiceRef = makeWorkspaceServiceRef(writeFile);
    const completeRun = vi.fn();

    const { result } = renderHook(() =>
      useWorkflowRunner({
        rootPath: '/workspace',
        isTestMode: true,
        apiKeys: [],
        completeRun,
        openTab: vi.fn(),
        setFileTree: vi.fn(),
        addAuditEntry: vi.fn(),
        workspaceServiceRef,
        templatesMetadataReaderRef: { current: null },
        templatesMarketplaceServiceRef: { current: null },
      })
    );

    await act(async () => {
      await result.current.handleStartWorkflow(saveErrorTemplate());
    });

    expect(workspaceServiceRef.current.mkdir).toHaveBeenCalledWith(
      expect.stringContaining('/workspace/Clients/Alice Smith/Documents/Workflows/Save Error Template - '),
    );
    expect(writeFile).toHaveBeenCalledWith(
      expect.stringContaining('/workspace/Clients/Alice Smith/Documents/Workflows/Save Error Template - '),
      expect.any(String),
    );
    expect(writeFile).toHaveBeenCalledWith(
      expect.stringContaining('/Out.md'),
      expect.any(String),
    );

    expect(completeRun).toHaveBeenCalledOnce();
    const savedRun = completeRun.mock.calls[0]![0] as { outputs: Record<string, unknown> };
    expect(savedRun.outputs['displayTitle']).toBe('Alice Smith - Retirement Review - Markdown document');
    expect(savedRun.outputs['documentType']).toBe('Markdown document');
    expect(savedRun.outputs['primaryArtifactPath']).toEqual(
      expect.stringContaining('/workspace/Clients/Alice Smith/Documents/Workflows/Save Error Template - '),
    );
    expect(savedRun.outputs['primaryArtifactPath']).toEqual(expect.stringContaining('/Out.md'));
  });
});
