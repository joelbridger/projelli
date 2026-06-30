// tests/unit/clientMap/templatesStore.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useTemplatesStore } from '@/features/matters/clientMap/templatesStore';

beforeEach(() => { useTemplatesStore.setState({ templates: {} }); });

describe('templatesStore', () => {
  it('saves, lists, and deletes a personal template', () => {
    const t = useTemplatesStore.getState().saveTemplate('Settlement posture', 'track settlement offers and our position');
    expect(t.scope).toBe('personal-template');
    expect(useTemplatesStore.getState().listTemplates().map((x) => x.title)).toContain('Settlement posture');
    useTemplatesStore.getState().deleteTemplate(t.id);
    expect(useTemplatesStore.getState().listTemplates()).toHaveLength(0);
  });
});
