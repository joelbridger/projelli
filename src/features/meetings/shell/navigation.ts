import {
  requestSharedClientSelection,
  type SealedClientBoundary,
} from '@/platform/client-context';
import { resolveMeetingNavigation, type MeetingRef } from '../foundation/contract';

export interface MeetingsNavigationRuntime {
  readonly navigation: {
    setSurface: (surface: 'home' | 'meetings') => void;
    pushSnapshot: () => void;
  };
}

export type MeetingsNavigationNotice =
  | { readonly kind: 'open'; readonly meetingRef: MeetingRef }
  | { readonly kind: 'folder-only'; readonly meetingRef: MeetingRef }
  | { readonly kind: 'refused'; readonly meetingRef: MeetingRef };

type NavigationHost = (notice: MeetingsNavigationNotice) => void;

let host: NavigationHost | null = null;
let pending: MeetingsNavigationNotice | null = null;

function publish(notice: MeetingsNavigationNotice): void {
  if (host) host(notice);
  else pending = notice;
}

/** The mounted shell is the sole consumer of resolved navigation notices. */
export function registerMeetingsNavigationHost(nextHost: NavigationHost): () => void {
  host = nextHost;
  if (pending) {
    const next = pending;
    pending = null;
    queueMicrotask(() => {
      if (host === nextHost) nextHost(next);
    });
  }
  return () => {
    if (host === nextHost) host = null;
  };
}

async function selectLinkedBoundary(
  boundary: SealedClientBoundary
): Promise<boolean> {
  const selection = await requestSharedClientSelection(boundary);
  return selection.kind === 'selected';
}

/**
 * The one surface mapping for the foundation's surface-blind disposition.
 * No client-scoped store is created or touched here. A successful linked
 * notice is published only after the sanctioned selection returns `selected`.
 */
export async function resolveMeetingsSurfaceNavigation(
  meetingRef: MeetingRef,
  runtime: MeetingsNavigationRuntime
): Promise<void> {
  const resolution = await resolveMeetingNavigation(meetingRef);
  switch (resolution.kind) {
    case 'linked': {
      const selected = await selectLinkedBoundary(resolution.clientBoundary);
      if (!selected) {
        publish({ kind: 'refused', meetingRef });
        return;
      }
      runtime.navigation.pushSnapshot();
      runtime.navigation.setSurface('meetings');
      publish({ kind: 'open', meetingRef });
      return;
    }
    case 'folder-only':
      runtime.navigation.pushSnapshot();
      runtime.navigation.setSurface('meetings');
      publish({ kind: 'folder-only', meetingRef });
      return;
    case 'unavailable':
      runtime.navigation.pushSnapshot();
      runtime.navigation.setSurface('home');
      return;
    case 'unknown':
      publish({ kind: 'refused', meetingRef });
      return;
  }
}

export interface MeetingsNavigationTarget {
  readonly surface: string;
  readonly meetingRef?: unknown;
  readonly source?: unknown;
  readonly [key: string]: unknown;
}

/** Accept only a stable MeetingRef field; raw records and paths are ignored. */
export function meetingRefFromNavigationTarget(
  target: MeetingsNavigationTarget
): MeetingRef | null {
  if (typeof target.meetingRef === 'string' && target.meetingRef.trim()) {
    return target.meetingRef.trim();
  }
  if (!target.source || typeof target.source !== 'object') return null;
  const ref = (target.source as { readonly ref?: unknown }).ref;
  return typeof ref === 'string' && ref.trim() ? ref.trim() : null;
}
