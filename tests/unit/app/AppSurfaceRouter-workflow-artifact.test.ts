import { describe, expect, it, vi } from 'vitest';

import { openRunArtifactFromWorkflows } from '@/app/shell/openRunArtifactFromWorkflows';

describe('AppSurfaceRouter workflow artifact opening', () => {
  it('stays on Workflows when a recent run artifact cannot be opened', async () => {
    const setSidebarActiveTab = vi.fn();

    const opened = await openRunArtifactFromWorkflows({
      path: '/workspace/Clients/Alice/missing.docx',
      name: 'missing.docx',
      handleFileOpen: vi.fn(async () => false),
      setSidebarActiveTab,
    });

    expect(opened).toBe(false);
    expect(setSidebarActiveTab).not.toHaveBeenCalled();
  });

  it('moves to Files only after a recent run artifact opens', async () => {
    const setSidebarActiveTab = vi.fn();

    const opened = await openRunArtifactFromWorkflows({
      path: '/workspace/Clients/Alice/report.docx',
      name: 'report.docx',
      handleFileOpen: vi.fn(async () => true),
      setSidebarActiveTab,
    });

    expect(opened).toBe(true);
    expect(setSidebarActiveTab).toHaveBeenCalledWith('files');
  });
});
