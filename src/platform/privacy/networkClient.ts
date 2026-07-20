/**
 * THE seam. This module is the only permitted TypeScript path to an
 * off-device `fetch`, Tauri HTTP-plugin request, `WebSocket`, updater start,
 * or browser/window external navigation. That is not a convention to
 * remember — it is enforced by construction: the `no-raw-network-call`
 * ESLint rule (`packages/eslint-plugin-lantern-egress/`) fails a raw network
 * call anywhere outside this file, the explicitly-allowlisted loopback
 * provider files, test fixtures, and the browser demo. A new caller cannot
 * quietly bypass this seam; it has to either import `egressFetch` /
 * `egressWebSocket` from here, or fail lint.
 *
 * A future network client (e.g. the intake relay, once that program merges
 * — see the "PENDING HOOK" comment in `egressRegistry.ts`) gets covered by
 * wiring it through this seam, not by writing a second policy check.
 */
import {
  getNetworkPolicyStatus,
  subscribeToOfflineModeChanges,
  type NetworkPolicyStatus,
} from '@/platform/privacy/offlineMode';
import { isTauri } from '@tauri-apps/api/core';
import {
  getEgressOperation,
  validateEgressDestination,
  type EgressOperation,
} from '@/platform/privacy/egressRegistry';
import {
  buildNetworkEgressReceipt,
  recordNetworkEgressReceipt,
  type NetworkEgressResult,
} from '@/platform/privacy/networkEgressReceipt';
import { getCorsSafeFetch } from '@/platform/providers/fetchUtils';
import { BRAND } from '@/config/brand';

export const OFFLINE_MODE_BLOCKED_CODE = 'OFFLINE_MODE_BLOCKED';

export class OfflineModeBlockedError extends Error {
  readonly code = OFFLINE_MODE_BLOCKED_CODE;
  /** Prevents an outer transport handler from duplicating the receipt that
   * `throwIfOffline` already wrote for this exact refusal. */
  receiptRecorded = false;

  constructor(action: string) {
    super(
      `Offline Mode is on. ${BRAND.name} cannot connect to the internet. Turn it off to use ${action}.`
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
const ACTIVE_EGRESS_STATUS_POLL_MS = 300;
const MAX_REDIRECT_HOPS = 5;

let activeEgressStatusPoll: ReturnType<typeof setInterval> | undefined;
let activeEgressStatusPollInFlight = false;

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
  const validation = validateEgressDestination(
    operation.id,
    destination.toString()
  );
  if (!validation.ok) {
    throw new EgressDestinationNotAllowedError(
      operation.id,
      normalizedHost(destination)
    );
  }
}

function throwIfOffline(
  status: NetworkPolicyStatus,
  operation: EgressOperation,
  destination: URL
): void {
  if (status.offlineMode && !isLiteralLoopback(destination)) {
    const error = new OfflineModeBlockedError(operation.title);
    recordNetworkEgressReceipt(
      buildNetworkEgressReceipt(
        operation,
        destination,
        status.generation,
        true,
        'blocked-before-network',
        error
      )
    );
    error.receiptRecorded = true;
    throw error;
  }
}

function recordReceipt(
  operation: EgressOperation,
  destination: URL,
  generation: number,
  offlineMode: boolean,
  result: NetworkEgressResult,
  error?: unknown
): void {
  recordNetworkEgressReceipt(
    buildNetworkEgressReceipt(
      operation,
      destination,
      generation,
      offlineMode,
      result,
      error
    )
  );
}

function registerActiveEgress(generation: number): ActiveEgress {
  const active: ActiveEgress = {
    generation,
    controller: new AbortController(),
  };
  activeEgress.add(active);
  ensureActiveEgressStatusPoll();
  return active;
}

function releaseActiveEgress(active: ActiveEgress): void {
  activeEgress.delete(active);
  if (activeEgress.size === 0 && activeEgressStatusPoll) {
    clearInterval(activeEgressStatusPoll);
    activeEgressStatusPoll = undefined;
    // A slow status read from a prior request must not prevent the next active
    // request from starting its own poll after the set becomes non-empty again.
    activeEgressStatusPollInFlight = false;
  }
}

function ensureActiveEgressStatusPoll(): void {
  if (activeEgressStatusPoll) return;

  // Lane 0 has no native policy-change event yet. While a request or socket is
  // live, this 300ms poll updates the same mirror that drives cancellation. A
  // future native push event can replace this or let us poll less often.
  activeEgressStatusPoll = setInterval(() => {
    if (activeEgressStatusPollInFlight || activeEgress.size === 0) return;
    activeEgressStatusPollInFlight = true;
    void getNetworkPolicyStatus()
      // updateMirror() notifies the existing cancellation subscription below.
      // eslint-disable-next-line lantern-async/no-silent-failure -- this best-effort poll repeats; authorization and boundary checks remain fail-closed.
      .catch(() => {
        // An already-authorized request keeps its existing native generation;
        // its next boundary check still fails closed if policy cannot be read.
      })
      .finally(() => {
        activeEgressStatusPollInFlight = false;
      });
  }, ACTIVE_EGRESS_STATUS_POLL_MS);
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
    if (active.generation >= status.generation) continue;
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
    recordReceipt(
      operation,
      destination,
      status.generation,
      status.offlineMode,
      'allowed'
    );
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
    active.controller.abort(new OfflineModeBlockedError(operation.title));
  }
  throwIfOffline(status, operation, destination);
}

async function egressFetchTransport(): Promise<typeof globalThis.fetch> {
  // This boundary adds policy checks; it must not replace the application's
  // established transport choice. In particular, the relay already relies on
  // this handoff for its production CORS-safe transport and its test relay.
  // Do not signal AI-provider activity for non-provider egress here.
  return getCorsSafeFetch({ signalEgress: false });
}

function isManualRedirect(response: Response): boolean {
  return (
    response.type === 'opaqueredirect' ||
    (response.status >= 300 && response.status < 400)
  );
}

async function authorizeRedirectDestination(
  operation: EgressOperation,
  destination: URL,
  active: ActiveEgress
): Promise<void> {
  // This preserves authorize()'s ordering: Offline Mode's user-facing error
  // wins over the developer-facing host allow-list error.
  await recheck(operation, destination, active);
  assertRegisteredDestination(operation, destination);
}

/**
 * Keep a streaming response's egress registration alive until its body has
 * finished, been cancelled, or failed. Aborting the registered controller
 * also errors a pending body read, including transports whose body does not
 * itself observe the fetch signal after headers have arrived.
 */
function guardStreamingResponse(
  response: Response,
  active: ActiveEgress
): Response {
  if (!response.body) {
    releaseActiveEgress(active);
    return response;
  }

  const sourceReader = response.body.getReader();
  let released = false;
  let streamController: ReadableStreamDefaultController<Uint8Array>;

  const release = () => {
    if (released) return;
    released = true;
    active.controller.signal.removeEventListener('abort', abortStream);
    releaseActiveEgress(active);
  };

  const abortStream = () => {
    const reason: unknown =
      active.controller.signal.reason ??
      new DOMException('The network request was aborted.', 'AbortError');
    // eslint-disable-next-line lantern-async/no-silent-failure -- the wrapper errors the consumer immediately; this is only best-effort cleanup for the source body.
    void sourceReader.cancel(reason).catch(() => undefined);
    streamController.error(reason);
    release();
  };

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller;
      if (active.controller.signal.aborted) abortStream();
      else
        active.controller.signal.addEventListener('abort', abortStream, {
          once: true,
        });
    },
    async pull(controller) {
      if (active.controller.signal.aborted) {
        abortStream();
        return;
      }
      try {
        const { done, value } = await sourceReader.read();
        if (done) {
          controller.close();
          release();
          return;
        }
        controller.enqueue(value);
      } catch (error) {
        controller.error(error);
        release();
      }
    },
    async cancel(reason) {
      try {
        await sourceReader.cancel(reason);
      } finally {
        release();
      }
    },
  });

  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

/**
 * Get a reader for a response returned by egressFetchStream(). Its body keeps
 * the original egress registration active until this reader finishes, errors,
 * or is cancelled.
 */
export function getEgressStreamReader(
  response: Response
): ReadableStreamDefaultReader<Uint8Array> {
  const body = response.body;
  if (!body) throw new Error('No response body');
  return body.getReader();
}

async function egressFetchWithPolicy(
  operationId: string,
  input: string | URL,
  init: RequestInit | undefined,
  keepActiveForBody: boolean
): Promise<Response> {
  // Browser development intentionally has no desktop Offline Mode guarantee.
  // Keep its historical Vite-proxy and relative-URL behavior exactly intact,
  // including the app's established CORS-safe fetch seam. The seam resolves
  // to native fetch in browser development, while preserving the relay's
  // long-standing transport injection in contract tests.
  if (!isTauri()) {
    const transport = await egressFetchTransport();
    return transport(input, init);
  }

  const { operation, destination, active } = await authorize(
    operationId,
    input
  );
  let bodyOwnsActive = false;
  try {
    const transport = await egressFetchTransport();
    let redirectHops = 0;
    let requestDestination = destination;

    for (;;) {
      await authorizeRedirectDestination(operation, requestDestination, active);
      const response = await transport(requestDestination, {
        ...init,
        // Browser fetch exposes manual redirects. Tauri's HTTP plugin creates
        // a browser Request but follows redirects in Rust unless this separate
        // documented option is zero, so both are needed here.
        redirect: 'manual',
        maxRedirections: 0,
        signal: combineSignals(init?.signal, active.controller),
      } as RequestInit & { maxRedirections: number });
      await recheck(operation, requestDestination, active);

      if (!isManualRedirect(response)) {
        if (!keepActiveForBody) {
          recordReceipt(
            operation,
            requestDestination,
            active.generation,
            false,
            'completed'
          );
          return response;
        }
        const guardedResponse = guardStreamingResponse(response, active);
        bodyOwnsActive = true;
        return guardedResponse;
      }
      if (operation.destination.redirects === 'deny') {
        throw new EgressDestinationNotAllowedError(
          operation.id,
          normalizedHost(requestDestination)
        );
      }
      const location = response.headers.get('location');
      if (!location) return response;
      if (redirectHops >= MAX_REDIRECT_HOPS) {
        throw new Error(
          `Too many redirects for network operation "${operation.id}" (maximum ${String(MAX_REDIRECT_HOPS)}).`
        );
      }

      requestDestination = new URL(location, requestDestination);
      redirectHops += 1;
    }
  } catch (error) {
    if (!(error instanceof OfflineModeBlockedError && error.receiptRecorded)) {
      recordReceipt(
        operation,
        destination,
        active.generation,
        error instanceof OfflineModeBlockedError,
        error instanceof OfflineModeBlockedError
          ? 'blocked-before-network'
          : error instanceof DOMException && error.name === 'AbortError'
            ? 'cancelled'
            : 'failed',
        error
      );
    }
    throw error;
  } finally {
    if (!bodyOwnsActive) releaseActiveEgress(active);
  }
}

/** A fail-closed, near drop-in replacement for an off-device fetch. */
export async function egressFetch(
  operationId: string,
  input: string | URL,
  init?: RequestInit
): Promise<Response> {
  return egressFetchWithPolicy(operationId, input, init, false);
}

/**
 * A streaming variant of egressFetch. It keeps the same authorization and
 * cancellation registration alive until the response body is no longer read.
 */
export async function egressFetchStream(
  operationId: string,
  input: string | URL,
  init?: RequestInit
): Promise<Response> {
  return egressFetchWithPolicy(operationId, input, init, true);
}

/** A fail-closed replacement for an off-device WebSocket constructor. */
export async function egressWebSocket(
  operationId: string,
  url: string | URL,
  protocols?: string | string[]
): Promise<WebSocket> {
  if (!isTauri()) {
    return protocols === undefined
      ? new WebSocket(url)
      : new WebSocket(url, protocols);
  }
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
  if (!isTauri()) return;
  const { operation, destination, active } = await authorize(operationId, url);
  try {
    await recheck(operation, destination, active);
  } finally {
    releaseActiveEgress(active);
  }
}
