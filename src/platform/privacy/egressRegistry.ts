/**
 * Checked descriptions of the network actions Lantern may perform.
 *
 * Keep these field names in step with Rust's `EgressOperation`. Later offline
 * mode lanes add the full inventory here; this small initial set exists only
 * to prove the renderer boundary without claiming that old call sites have
 * already migrated.
 *
 * PENDING HOOK — intake relay (not yet mergeable, tracked here so wiring it
 * up later is a 5-minute job, not a rediscovery):
 *
 * `src/platform/intake/` does not exist on this branch yet — the intake
 * program (`lp/intake`, waves 1-7) merges into this branch's upstream
 * (`lp/ux-simplify-v1`) separately, after its own Windows bench-verify. Once
 * that lands, register these operations here and route the following files
 * through `networkClient.ts` (`egressFetch` / `egressWebSocket`) exactly the
 * way every other sink in this registry does — do not invent a second policy
 * path for them:
 *   - `src/platform/intake/IntakeRelayClient.ts` (create/extend/revoke/
 *     regenerate/inbox fetch/blob fetch/acknowledge/list — HTTP)
 *   - `src/platform/intake/IntakeSyncClient.ts` (if it opens a WebSocket,
 *     use `egressWebSocket`; if HTTP-only, `egressFetch`)
 *   - `src/platform/intake/useIntakeInboxSync.ts` (scheduled polling — must
 *     stop, not just fail silently, when Offline Mode turns on; see
 *     `NetworkPolicy`'s cancellation registry / `subscribeToOfflineModeChanges`)
 * Offline Mode does not auto-revoke already-sent intake links — this hook is
 * only about stopping THIS device from contacting the relay while offline.
 */

export type EgressHostClass = 'literal-loopback' | 'cloud-ai';

export interface EgressOperation {
  id: string;
  category: string;
  allowedHostClass: EgressHostClass;
  allowedHosts: readonly string[];
  transfersContent: boolean;
  transfersMetadata: boolean;
  transfersCredential: boolean;
  receiptLabel: string;
}

const initialOperations = [
  {
    id: 'local-loopback',
    category: 'local-ai',
    allowedHostClass: 'literal-loopback',
    allowedHosts: ['127.0.0.1', '::1'],
    transfersContent: true,
    transfersMetadata: false,
    transfersCredential: false,
    receiptLabel: 'local AI',
  },
  {
    id: 'cloud-ai',
    category: 'cloud-ai',
    allowedHostClass: 'cloud-ai',
    allowedHosts: [
      'api.anthropic.com',
      'api.openai.com',
      'generativelanguage.googleapis.com',
    ],
    transfersContent: true,
    transfersMetadata: true,
    transfersCredential: true,
    receiptLabel: 'cloud AI',
  },
] as const satisfies readonly EgressOperation[];

/**
 * The registry deliberately starts small. Add new sinks here before routing
 * them through networkClient; an unregistered id is always denied.
 */
export const EGRESS_OPERATIONS: ReadonlyMap<string, EgressOperation> = new Map(
  initialOperations.map((operation) => [operation.id, operation])
);

export function getEgressOperation(
  operationId: string
): EgressOperation | undefined {
  return EGRESS_OPERATIONS.get(operationId);
}
