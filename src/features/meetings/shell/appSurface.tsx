import { createElement } from 'react';
import { Mic } from 'lucide-react';
import type { WorkspaceService } from '@/platform/fs/WorkspaceService';
import { MeetingsWorkspace } from './MeetingsWorkspace';
import {
  meetingRefFromNavigationTarget,
  resolveMeetingsSurfaceNavigation,
  type MeetingsNavigationTarget,
  type MeetingsNavigationRuntime,
} from './navigation';

declare module '@/platform/types/navigation' {
  interface AppSurfaceMap {
    meetings: true;
  }
}

export interface MeetingsSurfaceRuntime extends MeetingsNavigationRuntime {
  readonly workspace: {
    readonly rootPath: string | null | undefined;
    readonly serviceRef: { readonly current: WorkspaceService | null };
    readonly openSelector?: () => void;
  };
}

/** The one real Meetings surface descriptor consumed by the app-owned registry. */
export const meetingsSurface = {
  id: 'meetings',
  labelKey: 'meetings.shell.title',
  icon: Mic,
  placement: 'primary',
  order: 25,
  clientContext: 'shared',
  errorLabel: 'meetings.shell.title',
  availabilityFlag: 'meetings-shell-v1',
  render: (runtime: MeetingsSurfaceRuntime) =>
    createElement(MeetingsWorkspace, { runtime }),
  resolveNavigation: async (
    target: MeetingsNavigationTarget,
    runtime: MeetingsSurfaceRuntime
  ) => {
    const meetingRef = meetingRefFromNavigationTarget(target);
    if (!meetingRef) {
      runtime.navigation.pushSnapshot();
      runtime.navigation.setSurface('meetings');
      return;
    }
    await resolveMeetingsSurfaceNavigation(meetingRef, runtime);
  },
} as const;
