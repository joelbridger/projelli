/**
 * Marketing capture bridge.
 *
 * Mounted only when VITE_MARKETING_CAPTURE=1. Exposes globals that the
 * Playwright capture pipeline uses to seed Zustand state and signal
 * narrative beats during scripted captures. See
 * docs/marketing/asset-capture/SPEC.md.
 *
 * MUST NOT be imported in production builds. main.tsx gates the import on
 * import.meta.env.VITE_MARKETING_CAPTURE.
 */
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useEditorStore } from '@/stores/editorStore';
import { useAIChatStore } from '@/stores/aiChatStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useWorkflowStore } from '@/stores/workflowStore';

export interface SeedPayload {
  workspace?: Partial<ReturnType<typeof useWorkspaceStore.getState>>;
  editor?: Partial<ReturnType<typeof useEditorStore.getState>>;
  aiChat?: Partial<ReturnType<typeof useAIChatStore.getState>>;
  settings?: Partial<ReturnType<typeof useSettingsStore.getState>>;
  workflow?: Partial<ReturnType<typeof useWorkflowStore.getState>>;
  /** Bypass first-run wizard and any onboarding gates. */
  skipOnboarding?: boolean;
}

declare global {
  interface Window {
    __projelli_seed?: (payload: SeedPayload) => void;
    __projelli_signal?: (name: string, data?: unknown) => void;
    __projelli_signals?: Array<{ name: string; data?: unknown; ts: number }>;
  }
}

export function mountMarketingCaptureBridge(): void {
  window.__projelli_seed = (payload: SeedPayload) => {
    if (payload.workspace) useWorkspaceStore.setState(payload.workspace);
    if (payload.editor) useEditorStore.setState(payload.editor);
    if (payload.aiChat) useAIChatStore.setState(payload.aiChat);
    if (payload.settings) useSettingsStore.setState(payload.settings);
    if (payload.workflow) useWorkflowStore.setState(payload.workflow);
    if (payload.skipOnboarding) {
      // Key matches FirstRunWizard.tsx STORAGE_KEY = 'projelli_onboarding_complete'
      localStorage.setItem('projelli_onboarding_complete', 'true');
    }
  };

  window.__projelli_signals = [];
  window.__projelli_signal = (name: string, data?: unknown) => {
    window.__projelli_signals!.push({ name, data, ts: Date.now() });
  };

  console.info('[projelli] marketing-capture bridge mounted');
}
