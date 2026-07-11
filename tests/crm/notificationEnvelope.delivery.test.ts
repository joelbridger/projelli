/**
 * Envelope-delivery contract from Layer 1 §1.3.
 *
 * The implementation-side Bun relay test belongs to B3. This TypeScript
 * campaign contract stays here because this lane owns only tests/crm/**.
 */
import { describe, it } from 'vitest';

// WAVE-PENDING: B3 — /notify relay routes, envelope store, inbox/outbox, and device acknowledgements.
describe.skip('Sealed notification envelope delivery (WAVE-PENDING: B3)', () => {
  it('persists recipient, timestamps, opaque envelope id, and ciphertext only: no plaintext, sender_seat, or sender history', () => {});
  it('returns an offline recipient envelope on its next poll or reconnect', () => {});
  it('deduplicates an at-least-once retry by envelope_id across a client crash and restart', () => {});
  it('retains an approval notice for eight offline days until terminal plus every active-device acknowledgement', () => {});
  it('expires an informational notice after seven days with a durable dead-letter marker', () => {});
  it('rejects a new confidential send to a currently ineligible recipient and rotates future keys', () => {});
  it('allows an already-addressed old-key informational notice to reach only its seven-day expiry', () => {});
  it('delivers a firm-operational notice to every seat without client-confidential title, body, link, or key', () => {});
});
