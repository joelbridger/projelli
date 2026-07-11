/**
 * CRM data-model invariants — Layer 1 (§1.1).
 *
 * These are deliberately parked until B1 lands the typed CRM core. The suite
 * must use B1's shared types and runtime guards; it must never duplicate them
 * in tests just to make a temporary branch compile.
 */
import { describe, it } from 'vitest';

// WAVE-PENDING: B1 — src/platform/crm/types/ and CRM runtime schema guards.
describe.skip('CRM data model invariants (WAVE-PENDING: B1)', () => {
  it('has the exhaustive EntityKind catalog, including legacyProject and importArchiveManifest', () => {});
  it('validates every concrete entity field, including the canonical singular-assignee Task contract', () => {});
  it('keeps each entity id stable through generated valid mutations and CRDT round trips (fast-check, 1,000 runs)', () => {});
  it('rejects every generated Fact partial missing source, asOf, or observedAt (fast-check)', () => {});
  it('accepts empty Fact source citations but no missing provenance object', () => {});
  it('enforces the immutable importArchiveManifest capture and finalization contract', () => {});
  it('keeps matter_id on the wire for every household-attached entity', () => {});
  it('requires Note audience at creation and prevents client-facing paths from reading internal notes', () => {});
});
