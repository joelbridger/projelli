/**
 * Q19 (Wave 1.6) — user-authored template CRUD.
 *
 * Covers the pure module surface: create / load / edit / delete, plus
 * duplication (which must NOT mutate the original template) and the
 * merged list returned by `loadAllTemplates()`.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { WorkflowTemplate, GenerateStepConfig } from '@/platform/types/workflow';
import {
  clearUserTemplates,
  deleteUserTemplate,
  duplicateTemplate,
  getSystemPrompt,
  listUserTemplates,
  loadAllTemplates,
  resetUserTemplateStorage,
  saveUserTemplate,
  setSystemPrompt,
  setUserTemplateStorage,
} from '@/features/workflows/engine/userTemplates';
import { allWorkflows } from '@/features/workflows/engine';

/**
 * In-memory storage adapter so tests don't depend on JSDOM's
 * localStorage reset behavior.
 */
function makeMemoryStorage() {
  let data: string | null = null;
  return {
    read: () => data,
    write: (v: string) => {
      data = v;
    },
    clear: () => {
      data = null;
    },
  };
}

// Pick a built-in that actually has a generate step (registry ordering and the
// WS-D `analyze`-step templates mean allWorkflows[0] is no longer guaranteed to).
const builtIn = allWorkflows.find((t) => t.steps.some((s) => s.type === 'generate')) ?? allWorkflows[0]!;

describe('user templates (Q19)', () => {
  beforeEach(() => {
    setUserTemplateStorage(makeMemoryStorage());
  });
  afterEach(() => {
    resetUserTemplateStorage();
  });

  describe('duplicateTemplate', () => {
    it('returns a new template with a unique id and isUser=true', () => {
      const dup = duplicateTemplate(builtIn, {}, 1_700_000_000_000);
      expect(dup.id).toBe(`${builtIn.id}-user-1700000000000`);
      expect(dup.isUser).toBe(true);
      expect(dup.name).toBe(builtIn.name);
    });

    it('applies caller-supplied overrides (name wins over original)', () => {
      const dup = duplicateTemplate(builtIn, { name: 'My fork' });
      expect(dup.name).toBe('My fork');
      expect(dup.isUser).toBe(true);
    });

    it('does NOT mutate the original template or its steps', () => {
      const originalName = builtIn.name;
      const originalFirstStepId = builtIn.steps[0]!.id;
      const dup = duplicateTemplate(builtIn, { name: 'Another fork' });
      // Edit the duplicate; the source must be untouched.
      (dup.steps[0] as typeof dup.steps[number]).id = 'mutated';
      expect(builtIn.name).toBe(originalName);
      expect(builtIn.steps[0]!.id).toBe(originalFirstStepId);
    });
  });

  describe('setSystemPrompt / getSystemPrompt', () => {
    it('updates the first generate step without mutating the original', () => {
      const withPrompt = setSystemPrompt(builtIn, 'You are a test persona.');
      expect(getSystemPrompt(withPrompt)).toBe('You are a test persona.');
      // Original prompt should be untouched.
      const originalGenerate = builtIn.steps.find((s) => s.type === 'generate');
      const originalPrompt = originalGenerate
        ? (originalGenerate.config as GenerateStepConfig).systemPrompt
        : undefined;
      expect(originalPrompt).not.toBe('You are a test persona.');
    });

    it('returns empty string when the template has no generate step', () => {
      const tpl: WorkflowTemplate = {
        id: 'no-gen',
        name: 'No Generate',
        description: 'x',
        version: '1.0.0',
        category: 'planning',
        requiredInputs: [],
        outputs: [],
        steps: [],
      };
      expect(getSystemPrompt(tpl)).toBe('');
    });
  });

  describe('saveUserTemplate / listUserTemplates', () => {
    it('persists a saved template and re-reads it on the next list call', () => {
      const dup = duplicateTemplate(builtIn, { name: 'A' });
      saveUserTemplate(dup);
      const list = listUserTemplates();
      expect(list).toHaveLength(1);
      expect(list[0]!.id).toBe(dup.id);
      expect(list[0]!.name).toBe('A');
      expect(list[0]!.isUser).toBe(true);
    });

    it('updates an existing template in place when re-saving the same id', () => {
      const dup = duplicateTemplate(builtIn, { name: 'A' }, 42);
      saveUserTemplate(dup);
      saveUserTemplate({ ...dup, name: 'A-edited' });
      const list = listUserTemplates();
      expect(list).toHaveLength(1);
      expect(list[0]!.name).toBe('A-edited');
    });
  });

  describe('deleteUserTemplate', () => {
    it('removes the named template and leaves others alone', () => {
      const a = duplicateTemplate(builtIn, { name: 'A' }, 100);
      const b = duplicateTemplate(builtIn, { name: 'B' }, 101);
      saveUserTemplate(a);
      saveUserTemplate(b);
      deleteUserTemplate(a.id);
      const list = listUserTemplates();
      expect(list.map((t) => t.name)).toEqual(['B']);
    });

    it('is a no-op when the id is unknown', () => {
      saveUserTemplate(duplicateTemplate(builtIn, { name: 'keep' }, 1));
      deleteUserTemplate('definitely-not-here');
      expect(listUserTemplates()).toHaveLength(1);
    });
  });

  describe('clearUserTemplates', () => {
    it('wipes every user template', () => {
      saveUserTemplate(duplicateTemplate(builtIn, {}, 1));
      saveUserTemplate(duplicateTemplate(builtIn, {}, 2));
      clearUserTemplates();
      expect(listUserTemplates()).toHaveLength(0);
    });
  });

  describe('loadAllTemplates', () => {
    it('returns built-ins first, then user templates', () => {
      const dup = duplicateTemplate(builtIn, { name: 'forked' }, 9999);
      saveUserTemplate(dup);
      const merged = loadAllTemplates();
      expect(merged.length).toBe(allWorkflows.length + 1);
      // Last entry should be the user template
      const last = merged[merged.length - 1]!;
      expect(last.isUser).toBe(true);
      expect(last.name).toBe('forked');
    });

    it('lets a user template with the same id override a built-in', () => {
      const overrideBuiltIn: WorkflowTemplate = {
        ...builtIn,
        name: 'Replaced by user',
      };
      saveUserTemplate(overrideBuiltIn);
      const merged = loadAllTemplates();
      const sameIdEntries = merged.filter((t) => t.id === builtIn.id);
      expect(sameIdEntries).toHaveLength(1);
      expect(sameIdEntries[0]!.name).toBe('Replaced by user');
      expect(sameIdEntries[0]!.isUser).toBe(true);
    });
  });

  describe('edit flow end-to-end', () => {
    it('create -> edit systemPrompt -> save -> reload reads edited prompt', () => {
      const dup = duplicateTemplate(builtIn, { name: 'edit me' }, 7);
      const withPrompt = setSystemPrompt(dup, 'Tuned persona.');
      saveUserTemplate(withPrompt);

      const reloaded = listUserTemplates()[0]!;
      expect(getSystemPrompt(reloaded)).toBe('Tuned persona.');
    });

    it('malformed stored JSON is tolerated (returns empty list)', () => {
      // Inject invalid JSON directly into the storage adapter.
      const bad = {
        read: () => 'not-json',
        write: () => {},
        clear: () => {},
      };
      setUserTemplateStorage(bad);
      expect(listUserTemplates()).toEqual([]);
    });
  });
});
