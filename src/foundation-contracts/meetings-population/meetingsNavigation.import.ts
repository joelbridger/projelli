/**
 * Outside-module paved path for firm-wide meeting navigation. Consumers import
 * both owners through their public indexes, receive the sealed boundary from
 * Meetings, and await the one sanctioned client-selection request before any
 * client-scoped meeting operation.
 */
import {
  resolveMeetingNavigation,
  type MeetingNavigationResolution,
} from '@/features/meetings';
import {
  requestSharedClientSelection,
  type SelectionResult,
} from '@/platform/client-context';

export interface MeetingNavigationPavedPathResult {
  readonly navigation: MeetingNavigationResolution;
  readonly selection: SelectionResult | null;
}

function assertNever(value: never): never {
  throw new Error(`Unreachable meeting navigation arm: ${String(value)}`);
}

/**
 * The linked arm is the only arm allowed to request selection. `unknown`
 * already carries the resolver's refusal disposition; this helper deliberately
 * does not invent a route or fallback identity for any non-linked arm.
 */
export async function proveMeetingNavigationPavedPath(
  ref: string
): Promise<MeetingNavigationPavedPathResult> {
  const navigation = await resolveMeetingNavigation(ref);
  switch (navigation.kind) {
    case 'linked':
      return {
        navigation,
        selection: await requestSharedClientSelection(
          navigation.clientBoundary
        ),
      };
    case 'folder-only':
    case 'unavailable':
      return { navigation, selection: null };
    case 'unknown':
      return { navigation, selection: null };
    default:
      return assertNever(navigation);
  }
}

void resolveMeetingNavigation;
void requestSharedClientSelection;
