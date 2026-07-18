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
import {
  CALENDAR_EVENTS_SEED_KEY,
  type CalendarEventDto,
} from '@/platform/utils/calendar-commands';

export interface SeedPayload {
  workspace?: Partial<ReturnType<typeof useWorkspaceStore.getState>>;
  editor?: Partial<ReturnType<typeof useEditorStore.getState>>;
  aiChat?: Partial<ReturnType<typeof useAIChatStore.getState>>;
  settings?: Partial<ReturnType<typeof useSettingsStore.getState>>;
  workflow?: Partial<ReturnType<typeof useWorkflowStore.getState>>;
  matter?: Omit<
    Partial<ReturnType<typeof useMatterStore.getState>>,
    'activeMatterId' | 'setActiveMatter'
  >;
  /** Wave-1c evidence capture: BeforeYouMeetStrip reads directly from
   *  useBriefStore (no Tauri gate), so seeding it here is enough to render
   *  the ready/stale states for a screenshot. */
  briefs?: Partial<ReturnType<typeof useBriefStore.getState>>;
  /** Wave-1c evidence capture: calendarListEvents() is Tauri-gated and
   *  always returns [] in a browser session, so TodaysMeetingsStrip has no
   *  other way to render its matched/unmatched states for a screenshot.
   *  calendar-commands.ts checks localStorage (written here, under
   *  CALENDAR_EVENTS_SEED_KEY) before falling back to the real Tauri call,
   *  gated by the same VITE_MARKETING_CAPTURE flag so it's tree-shaken from
   *  production. localStorage (not a plain window global) so the seed
   *  survives a reload — TodaysMeetingsStrip fetches once on mount, so a
   *  global set after that first fetch would never be picked up. */
  calendarEvents?: CalendarEventDto[];
  /** Bypass first-run wizard and any onboarding gates. */
  skipOnboarding?: boolean;
}

declare global {
  interface Window {
    __lantern_seed?: (payload: SeedPayload) => void;
    __lantern_signal?: (name: string, data?: unknown) => void;
    __lantern_signals?: Array<{ name: string; data?: unknown; ts: number }>;
  }
}

export function mountMarketingCaptureBridge(): void {
  window.__lantern_seed = (payload: SeedPayload) => {
    if (payload.workspace) useWorkspaceStore.setState(payload.workspace);
    if (payload.editor) useEditorStore.setState(payload.editor);
    if (payload.aiChat) useAIChatStore.setState(payload.aiChat);
    if (payload.settings) useSettingsStore.setState(payload.settings);
    if (payload.workflow) useWorkflowStore.setState(payload.workflow);
    if (payload.matter) {
      // Capture data may seed matter facts, never the selection follower.
      const matterFacts = {
        ...payload.matter,
      } as Partial<ReturnType<typeof useMatterStore.getState>>;
      Reflect.deleteProperty(matterFacts, 'activeMatterId');
      Reflect.deleteProperty(matterFacts, 'setActiveMatter');
      useMatterStore.setState(matterFacts);
    }
    if (payload.briefs) useBriefStore.setState(payload.briefs);
    if (payload.calendarEvents) {
      localStorage.setItem(
        CALENDAR_EVENTS_SEED_KEY,
        JSON.stringify(payload.calendarEvents)
      );
    }
    if (payload.skipOnboarding) {
      // Key matches onboardingState.ts's SK_ONBOARDING_COMPLETE (src/config/identity.ts)
      localStorage.setItem(SK_ONBOARDING_COMPLETE, 'true');
    }
  };

  window.__lantern_signals = [];
  window.__lantern_signal = (name: string, data?: unknown) => {
    window.__lantern_signals!.push({ name, data, ts: Date.now() });
  };

  console.info('[lantern] marketing-capture bridge mounted');
}
