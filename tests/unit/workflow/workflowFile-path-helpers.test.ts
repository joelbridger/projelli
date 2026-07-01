/**
 * BUG F3(1b) — subfolder-preserving path helpers used by the `writeFile`/
 * `writeFileBinary`/`readFile` closures `useWorkflowRunner` hands to the
 * engine. Extracted as pure functions (from inline `path.split('/').pop()`
 * basename-stripping logic that silently dropped a template-authored
 * subfolder like `Estate Planning/Client - Summary.docx`) so the join
 * behavior is directly unit-testable without rendering the hook.
 */
import { describe, it, expect } from 'vitest';
import {
  resolveWorkflowArtifactPath,
  resolveWorkflowReadPath,
} from '@/features/workflows/engine/workflowFile';

describe('resolveWorkflowArtifactPath', () => {
  it('joins a flat filename onto the workflow folder', () => {
    expect(resolveWorkflowArtifactPath('/ws/Run - 2026-07-01', 'Report.md')).toBe(
      '/ws/Run - 2026-07-01/Report.md'
    );
  });

  it('preserves a subfolder segment from the (already interpolated) relative path', () => {
    expect(
      resolveWorkflowArtifactPath(
        '/ws/Run - 2026-07-01',
        'Estate Planning/Client - Summary.docx'
      )
    ).toBe('/ws/Run - 2026-07-01/Estate Planning/Client - Summary.docx');
  });

  it('does NOT collapse the path down to its basename (the regression this fixes)', () => {
    const full = resolveWorkflowArtifactPath('/ws/Run', 'Meridian Corp/Contract Review.docx');
    expect(full).not.toBe('/ws/Run/Contract Review.docx');
    expect(full).toBe('/ws/Run/Meridian Corp/Contract Review.docx');
  });
});

describe('resolveWorkflowReadPath', () => {
  it('joins a relative path onto the workflow folder, same as writes', () => {
    expect(resolveWorkflowReadPath('/ws/Run', 'Estate Planning/Draft.md')).toBe(
      '/ws/Run/Estate Planning/Draft.md'
    );
  });

  it('passes an absolute path through unchanged', () => {
    expect(resolveWorkflowReadPath('/ws/Run', '/ws/other-file.md')).toBe('/ws/other-file.md');
  });
});
