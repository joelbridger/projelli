// src/platform/clientMap/templatesStore.ts
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { CustomCategoryTemplate } from './types';
import { buildCustomSection } from './customSection';
import { useClientMapStore } from './clientMapStore';
import { SK_CLIENT_MAP_TEMPLATES } from '@/config/identity';

interface TemplatesState {
  templates: Record<string, CustomCategoryTemplate>;
  saveTemplate: (title: string, prompt: string) => CustomCategoryTemplate;
  deleteTemplate: (id: string) => void;
  listTemplates: () => CustomCategoryTemplate[];
}

export const useTemplatesStore = create<TemplatesState>()(
  persist(
    (set, get) => ({
      templates: {},
      saveTemplate: (title, prompt) => {
        const id = crypto.randomUUID();
        const template: CustomCategoryTemplate = {
          id,
          title,
          prompt,
          scope: 'personal-template',
        };
        set((s) => ({ templates: { ...s.templates, [id]: template } }));
        return template;
      },
      deleteTemplate: (id) => {
        set((s) => {
          const { [id]: _drop, ...rest } = s.templates;
          void _drop;
          return { templates: rest };
        });
      },
      listTemplates: () => Object.values(get().templates),
    }),
    {
      name: SK_CLIENT_MAP_TEMPLATES,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ templates: state.templates }),
    },
  ),
);

export async function applyTemplateToMatter(templateId: string, matterId: string): Promise<void> {
  const template = useTemplatesStore.getState().templates[templateId];
  if (!template) return;
  const newId = crypto.randomUUID();
  const section = await buildCustomSection(matterId, newId, template.title, template.prompt);
  useClientMapStore.getState().addCustomSection(matterId, section);
}
