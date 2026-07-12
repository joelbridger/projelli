import { describe, expect, it } from 'vitest';

import { SecurityError } from '@/platform/fs/types';
import type { WorkspaceService } from '@/platform/fs/WorkspaceService';
import { readIntakeDocument, type DocumentReaderDependencies } from './documentReader';

/**
 * Reproduces PathValidator's real behavior for a configured workspace root:
 * any path that is an ancestor of (or otherwise outside) the root throws
 * SecurityError('ABSOLUTE_PATH_IN_RELATIVE_CONTEXT') before it can even
 * answer "is this a symlink" — exactly what broke resolvePathForMatterBoundary
 * on the Legion bench with a real absolute Windows workspace root.
 */
function fakeWorkspaceService(options: {
  root: string;
  symlinks?: Record<string, string>;
  fileBytes?: Uint8Array;
}): Pick<WorkspaceService, 'isSymlink' | 'resolveSymlink' | 'readFileBinary'> {
  const root = options.root.replace(/\\/gu, '/');
  const symlinks = options.symlinks ?? {};
  const withinRoot = (path: string): boolean => {
    const normalized = path.replace(/\\/gu, '/');
    return normalized === root || normalized.startsWith(`${root}/`);
  };
  return {
    isSymlink: (path: string) => {
      if (!withinRoot(path)) {
        return Promise.reject(new SecurityError(`Absolute path outside workspace not allowed: ${path}`, path, 'ABSOLUTE_PATH_IN_RELATIVE_CONTEXT'));
      }
      return Promise.resolve(path.replace(/\\/gu, '/') in symlinks);
    },
    resolveSymlink: (path: string) => Promise.resolve(symlinks[path.replace(/\\/gu, '/')] ?? path),
    readFileBinary: () => Promise.resolve((options.fileBytes ?? new TextEncoder().encode('Annual income: $85,000')).buffer as ArrayBuffer),
  };
}

const pdfDeps: Partial<DocumentReaderDependencies> = {
  extractPdfText: () => Promise.resolve({ pages: ['Annual income: $85,000'], pageCount: 1, encrypted: false, scanned: false }),
};

describe('readIntakeDocument path boundary walk', () => {
  it('reads a document whose real absolute workspace root has ancestors outside PathValidator\'s boundary (Legion regression)', async () => {
    const matterFolderPath = 'C:/Users/james/Documents/Beacon Ridge Demo/Sarah Household';
    const path = `${matterFolderPath}/Requests/onboarding/pay-stub.pdf`;
    const workspaceService = fakeWorkspaceService({ root: matterFolderPath });

    const result = await readIntakeDocument({
      path,
      matterFolderPath,
      workspaceService,
      mimeType: 'application/pdf',
      dependencies: pdfDeps,
    });

    expect(result.status).toBe('read');
    if (result.status === 'read') {
      expect(result.pages[0]?.text).toContain('Annual income');
    }
  });

  it('still rejects a real in-workspace symlink that escapes the matter folder', async () => {
    const matterFolderPath = 'C:/Users/james/Documents/Beacon Ridge Demo/Sarah Household';
    const escapeTarget = 'C:/Users/james/Documents/Beacon Ridge Demo/Other Household/secret.pdf';
    const path = `${matterFolderPath}/Requests/onboarding/pay-stub.pdf`;
    const workspaceService = fakeWorkspaceService({
      root: 'C:/Users/james/Documents/Beacon Ridge Demo',
      symlinks: { [`${matterFolderPath}/Requests/onboarding/pay-stub.pdf`]: escapeTarget },
    });

    await expect(readIntakeDocument({
      path,
      matterFolderPath,
      workspaceService,
      mimeType: 'application/pdf',
      dependencies: pdfDeps,
    })).rejects.toThrow('Document path must stay inside the client folder.');
  });

  it('still rejects path traversal in the requested path', async () => {
    const matterFolderPath = 'C:/Users/james/Documents/Beacon Ridge Demo/Sarah Household';
    const workspaceService = fakeWorkspaceService({ root: matterFolderPath });

    await expect(readIntakeDocument({
      path: `${matterFolderPath}/../Other Household/secret.pdf`,
      matterFolderPath,
      workspaceService,
      mimeType: 'application/pdf',
      dependencies: pdfDeps,
    })).rejects.toThrow('Document path must stay inside the client folder.');
  });
});
