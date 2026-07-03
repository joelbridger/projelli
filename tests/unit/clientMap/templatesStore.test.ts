// tests/unit/clientMap/templatesStore.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useTemplatesStore } from '@/features/matters/clientMap/templatesStore';

const buildCustomSectionMock = vi.hoisted(() => vi.fn());
vi.mock('@/features/matters/clientMap/customSection', () => ({
  buildCustomSection: buildCustomSectionMock,
}));
vi.mock('@/platform/clientMap/clientMapStore', () => ({
  useClientMapStore: { getState: () => ({ addCustomSection: vi.fn() }) },
}));

beforeEach(() => {
  useTemplatesStore.setState({ templates: {} });
  buildCustomSectionMock.mockReset();
});

describe('templatesStore', () => {
  it('saves, lists, and deletes a personal template', () => {
    const t = useTemplatesStore.getState().saveTemplate('Settlement posture', 'track settlement offers and our position');
    expect(t.scope).toBe('personal-template');
    expect(useTemplatesStore.getState().listTemplates().map((x) => x.title)).toContain('Settlement posture');
    useTemplatesStore.getState().deleteTemplate(t.id);
    expect(useTemplatesStore.getState().listTemplates()).toHaveLength(0);
  });

  it('applyTemplateToMatter forwards onAuditLog through to buildCustomSection', async () => {
    // Trust-fixes finding #1: this is the other production entry point into
    // buildCustomSection — it must not silently drop the audit sink.
    const t = useTemplatesStore.getState().saveTemplate('Insurance', 'track insurance');
    buildCustomSectionMock.mockResolvedValue({
      id: 'x', kind: 'custom', key: 'x', title: 'Insurance', scope: 'matter', items: [],
    });
    const onAuditLog = vi.fn();
    const { applyTemplateToMatter } = await import('@/features/matters/clientMap/templatesStore');
    await applyTemplateToMatter(t.id, 'm1', { onAuditLog });
    expect(buildCustomSectionMock).toHaveBeenCalledWith(
      'm1', expect.any(String), 'Insurance', 'track insurance', { onAuditLog },
    );
  });
});
