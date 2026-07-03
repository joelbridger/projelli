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
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';
import { useEditorStore } from '@/platform/state/editorStore';
import { useAIChatStore } from '@/platform/state/aiChatStore';
import { useSettingsStore } from '@/platform/settings/settingsStore';
import { useWorkflowStore } from '@/features/workflows/workflowStore';
import { useMatterStore } from '@/platform/matter/matterStore';
import { useBriefStore } from '@/features/meetings/briefStore';
import { SK_ONBOARDING_COMPLETE } from '@/config/identity';
import type { CalendarEventDto } from '@/platform/utils/calendar-commands';

export interface SeedPayload {
  workspace?: Partial<ReturnType<typeof useWorkspaceStore.getState>>;
  editor?: Partial<ReturnType<typeof useEditorStore.getState>>;
  aiChat?: Partial<ReturnType<typeof useAIChatStore.getState>>;
  settings?: Partial<ReturnType<typeof useSettingsStore.getState>>;
  workflow?: Partial<ReturnType<typeof useWorkflowStore.getState>>;
  matter?: Partial<ReturnType<typeof useMatterStore.getState>>;
  /** Wave-1c evidence capture: BeforeYouMeetStrip reads directly from
   *  useBriefStore (no Tauri gate), so seeding it here is enough to render
   *  the ready/stale states for a screenshot. */
  briefs?: Partial<ReturnType<typeof useBriefStore.getState>>;
  /** Wave-1c evidence capture: calendarListEvents() is Tauri-gated and
   *  always returns [] in a browser session, so TodaysMeetingsStrip has no
   *  other way to render its matched/unmatched states for a screenshot.
   *  calendar-commands.ts checks window.__keepance_calendarEvents (set here)
   *  before falling back to the real Tauri call, gated by the same
   *  VITE_MARKETING_CAPTURE flag so it's tree-shaken from production. */
  calendarEvents?: CalendarEventDto[];
  /** Bypass first-run wizard and any onboarding gates. */
  skipOnboarding?: boolean;
}

declare global {
  interface Window {
    __keepance_seed?: (payload: SeedPayload) => void;
    __keepance_signal?: (name: string, data?: unknown) => void;
    __keepance_signals?: Array<{ name: string; data?: unknown; ts: number }>;
    __keepance_calendarEvents?: CalendarEventDto[];
  }
}

export function mountMarketingCaptureBridge(): void {
  window.__keepance_seed = (payload: SeedPayload) => {
    if (payload.workspace) useWorkspaceStore.setState(payload.workspace);
    if (payload.editor) useEditorStore.setState(payload.editor);
    if (payload.aiChat) useAIChatStore.setState(payload.aiChat);
    if (payload.settings) useSettingsStore.setState(payload.settings);
    if (payload.workflow) useWorkflowStore.setState(payload.workflow);
    if (payload.matter) useMatterStore.setState(payload.matter);
    if (payload.briefs) useBriefStore.setState(payload.briefs);
    if (payload.calendarEvents)
      window.__keepance_calendarEvents = payload.calendarEvents;
    if (payload.skipOnboarding) {
      // Key matches onboardingState.ts's SK_ONBOARDING_COMPLETE (src/config/identity.ts)
      localStorage.setItem(SK_ONBOARDING_COMPLETE, 'true');
    }
  };

  window.__keepance_signals = [];
  window.__keepance_signal = (name: string, data?: unknown) => {
    window.__keepance_signals!.push({ name, data, ts: Date.now() });
  };

  console.info('[keepance] marketing-capture bridge mounted');
}
