import { describe, expect, expectTypeOf, it } from 'vitest';
import type { WorkspaceService } from '@/platform/fs/WorkspaceService';
import {
  createTestModeWorkspaceMock,
  type TestModeWorkspaceService,
} from './useTestModeWorkspace';

describe('test-mode workspace mock', () => {
  it('implements every public WorkspaceService member', async () => {
    // This is intentionally a type-level assertion. The factory itself uses
    // `satisfies TestModeWorkspaceService`; because that type is derived from
    // `keyof WorkspaceService`, removing or adding any public service method
    // makes this unit test fail to type-check before browser tests can run.
    expectTypeOf<TestModeWorkspaceService>().toEqualTypeOf<
      Pick<WorkspaceService, keyof WorkspaceService>
    >();

    const { service } = createTestModeWorkspaceMock();
    expectTypeOf(service).toExtend<TestModeWorkspaceService>();
    expect(service.getRootPath()).toBe('/test-workspace');
    expect(service.isInitialized()).toBe(true);

    await service.writeFile('/test-workspace/docs/check.txt', 'ready');
    expect(await service.readFile('/test-workspace/docs/check.txt')).toBe(
      'ready'
    );
    await service.copy(
      '/test-workspace/docs/check.txt',
      '/test-workspace/docs/copy.txt'
    );
    expect(await service.exists('/test-workspace/docs/copy.txt')).toBe(true);
  });
});
