/**
 * Paved-path compile fixture for the shared-client owner wiring.
 *
 * This is the shape an app/shell composition root uses to bring Ask's
 * client-scoped doorways online: publish the shared client through the client
 * bar, establish the Ask owner binding once, and (on teardown) dispose it. It
 * imports ONLY the public feature surfaces — no deep import of the owner socket
 * exists or is needed. It never runs; it only has to compile against the real
 * public contracts.
 */
import {
  establishAskSharedClientContext,
  readAskSharedClientSnapshot,
  askClientIdentityAdapter,
  askScopeBuilder,
  collectAskSourceCandidates,
  resolveAskScope,
  type AskClientSnapshot,
} from '@/features/ask';
import {
  useSharedClientContext,
  readSharedClientContext,
  type SharedClientContext,
} from '@/features/client-bar';

// The client bar publishes the one active shared client (reactively and via a
// live read). Both come from the same true source, never a parallel store.
declare const reactiveClient: SharedClientContext | null;
export function bootstrapClientBar(): SharedClientContext | null {
  // Would be called inside a component; typed here to prove the doorway shape.
  void useSharedClientContext;
  return readSharedClientContext() ?? reactiveClient;
}

// The composition root establishes the owner binding once and keeps the disposer
// for teardown. There is no arbitrary `bind(reader)` doorway to misuse.
export function bootstrapAskOwner(): () => void {
  return establishAskSharedClientContext();
}

// Downstream, ordinary consumers resolve client scopes against the live snapshot
// and the pure identity adapter; the use-time doorways fail closed automatically
// after a switch/clear because they read the live binding.
export function exerciseClientScopedDoorway(): void {
  const snapshot: AskClientSnapshot<SharedClientContext> | null =
    readAskSharedClientSnapshot();
  if (!snapshot) return;
  const scope = resolveAskScope(
    askScopeBuilder.currentClient('workspace-1', snapshot),
    snapshot,
    askClientIdentityAdapter
  );
  void collectAskSourceCandidates(scope);
}
