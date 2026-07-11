import {
  getNetworkPolicyStatus,
  subscribeToOfflineModeChanges,
  type NetworkPolicyStatus,
} from '@/platform/privacy/offlineMode';
import {
  getEgressOperation,
  type EgressOperation,
} from '@/platform/privacy/egressRegistry';

export const OFFLINE_MODE_BLOCKED_CODE = 'OFFLINE_MODE_BLOCKED';

export class OfflineModeBlockedError extends Error {
  readonly code = OFFLINE_MODE_BLOCKED_CODE;

  constructor(action: string) {
    super(
      `Offline Mode is on. Lantern cannot connect to the internet. Turn it off to use ${action}.`
    );
    this.name = 'OfflineModeBlockedError';
  }
}

export class UnregisteredEgressOperationError extends Error {
  readonly code = 'UNREGISTERED_EGRESS_OPERATION';

  constructor(operationId: string) {
    super(
      `Network operation "${operationId}" is not registered and was blocked.`
    );
    this.name = 'UnregisteredEgressOperationError';
  }
}

export class EgressDestinationNotAllowedError extends Error {
  readonly code = 'EGRESS_DESTINATION_NOT_ALLOWED';

  constructor(operationId: string, host: string) {
    super(`Network operation "${operationId}" cannot connect to "${host}".`);
    this.name = 'EgressDestinationNotAllowedError';
  }
}

interface ActiveEgress {
  generation: number;
  controller: AbortController;
  closeSocket?: () => void;
}

const activeEgress = new Set<ActiveEgress>();

function normalizedHost(url: URL): string {
  return url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
}

function isLiteralLoopback(url: URL): boolean {
  const host = normalizedHost(url);
  return host === '127.0.0.1' || host === '::1';
}

function getRequiredOperation(operationId: string): EgressOperation {
  const operation = getEgressOperation(operationId);
  if (!operation) throw new UnregisteredEgressOperationError(operationId);
  return operation;
}

function parseDestination(input: string | URL): URL {
  try {
    return new URL(input.toString());
  } catch {
    // A relative URL cannot prove its final remote host, so it is never a
    // policy bypass. Later migrations should pass the actual destination.
    throw new Error('Network requests must use an absolute destination URL.');
  }
}

function assertRegisteredDestination(
  operation: EgressOperation,
  destination: URL
): void {
  const host = normalizedHost(destination);
  if (!operation.allowedHosts.includes(host)) {
    throw new EgressDestinationNotAllowedError(operation.id, host);
  }

  if (
    operation.allowedHostClass === 'literal-loopback' &&
    !isLiteralLoopback(destination)
  ) {
    throw new EgressDestinationNotAllowedError(operation.id, host);
  }
}

function throwIfOffline(
  status: NetworkPolicyStatus,
  operation: EgressOperation,
  destination: URL
): void {
  if (status.offlineMode && !isLiteralLoopback(destination)) {
    throw new OfflineModeBlockedError(operation.receiptLabel);
  }
}

function registerActiveEgress(generation: number): ActiveEgress {
  const active: ActiveEgress = {
    generation,
    controller: new AbortController(),
  };
  activeEgress.add(active);
  return active;
}

function releaseActiveEgress(active: ActiveEgress): void {
  activeEgress.delete(active);
}

function combineSignals(
  signal: AbortSignal | null | undefined,
  controller: AbortController
): AbortSignal {
  if (!signal) return controller.signal;
  if (signal.aborted) controller.abort(signal.reason);
  else {
    signal.addEventListener(
      'abort',
      () => {
        controller.abort(signal.reason);
      },
      { once: true }
    );
  }
  return controller.signal;
}

// The mirror emits synchronously when setOfflineMode() receives a newer native
// generation. This is a cancellation bridge only: permission is always
// re-asked from native below, never inferred from this store subscription.
subscribeToOfflineModeChanges((status) => {
  if (!status.offlineMode) return;
  for (const active of activeEgress) {
    active.controller.abort(new OfflineModeBlockedError('this action'));
    active.closeSocket?.();
  }
});

async function authorize(
  operationId: string,
  destinationInput: string | URL
): Promise<{
  operation: EgressOperation;
  destination: URL;
  active: ActiveEgress;
}> {
  const operation = getRequiredOperation(operationId);
  const destination = parseDestination(destinationInput);

  // Fresh native status is safer than the display mirror and fails closed if
  // native policy is unavailable or has not finished its own guarded startup.
  const status = await getNetworkPolicyStatus();
  const active = registerActiveEgress(status.generation);
  try {
    // Offline Mode's stable, user-facing block comes before the registry's
    // developer-facing destination error. That way every attempted internet
    // action gets the promised message while the device is offline.
    throwIfOffline(status, operation, destination);
    assertRegisteredDestination(operation, destination);
    return { operation, destination, active };
  } catch (error) {
    releaseActiveEgress(active);
    throw error;
  }
}

async function recheck(
  operation: EgressOperation,
  destination: URL,
  active: ActiveEgress
): Promise<void> {
  const status = await getNetworkPolicyStatus();
  if (status.generation !== active.generation && status.offlineMode) {
    active.controller.abort(
      new OfflineModeBlockedError(operation.receiptLabel)
    );
  }
  throwIfOffline(status, operation, destination);
}

async function egressFetchTransport(): Promise<typeof globalThis.fetch> {
  const useTauriHttp =
    typeof window !== 'undefined' &&
    '__TAURI__' in window &&
    !import.meta.env.DEV;
  if (!useTauriHttp) return globalThis.fetch.bind(globalThis);

  const plugin = await import('@tauri-apps/plugin-http');
  return plugin.fetch as typeof globalThis.fetch;
}

/** A fail-closed, near drop-in replacement for an off-device fetch. */
export async function egressFetch(
  operationId: string,
  input: string | URL,
  init?: RequestInit
): Promise<Response> {
  const { operation, destination, active } = await authorize(
    operationId,
    input
  );
  try {
    const transport = await egressFetchTransport();
    await recheck(operation, destination, active);
    const response = await transport(destination, {
      ...init,
      signal: combineSignals(init?.signal, active.controller),
    });
    await recheck(operation, destination, active);
    return response;
  } finally {
    releaseActiveEgress(active);
  }
}

/** A fail-closed replacement for an off-device WebSocket constructor. */
export async function egressWebSocket(
  operationId: string,
  url: string | URL,
  protocols?: string | string[]
): Promise<WebSocket> {
  const { operation, destination, active } = await authorize(operationId, url);
  try {
    await recheck(operation, destination, active);
    const socket =
      protocols === undefined
        ? new WebSocket(destination)
        : new WebSocket(destination, protocols);
    active.closeSocket = () => {
      socket.close();
    };
    socket.addEventListener(
      'close',
      () => {
        releaseActiveEgress(active);
      },
      { once: true }
    );
    return socket;
  } catch (error) {
    releaseActiveEgress(active);
    throw error;
  }
}

/**
 * Check an external URL before a caller opens it in a browser or webview.
 * The caller still performs the platform-specific navigation after this check.
 */
export async function assertEgressNavigationAllowed(
  operationId: string,
  url: string | URL
): Promise<void> {
  const { operation, destination, active } = await authorize(operationId, url);
  try {
    await recheck(operation, destination, active);
  } finally {
    releaseActiveEgress(active);
  }
}
