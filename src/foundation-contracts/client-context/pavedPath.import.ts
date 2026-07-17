/**
 * The shell owner may establish the zero-argument binding later. This fixture
 * proves the doorway without wiring application boot in this seam lane.
 */
import { establishAskSharedClientContext } from '@/features/ask';

export function establishAskFromShellOwner(): () => void {
  return establishAskSharedClientContext();
}
