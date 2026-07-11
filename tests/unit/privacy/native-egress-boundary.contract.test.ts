/**
 * Offline Mode's native boundary contract, enforced inside `vitest run` (not
 * only scripts/gate.sh) from ONE source of truth: the scanner in
 * scripts/check-native-egress-boundary.mjs.
 *
 * The rule (see that script's header): every native connector must route its
 * transport through `connector_network::{await_authorized,
 * send_with_authorized_redirects}` (or `EgressHttpClient`) — and, since the
 * checker was tightened, every HTTP-completing call (`.send()`, `.text()`,
 * `.json()`, `.bytes()`, `.bytes_stream()`) must be lexically enclosed by one
 * of those guard calls, not merely live in a file that also happens to call
 * one somewhere. A body read that escapes the guard stops being
 * policy-owned the moment the initial send returns, so a mode flip
 * mid-transfer cannot stop it — this is the exact bug class an earlier
 * adversarial review found across the connector layer. This test makes that
 * class of regression impossible to reintroduce silently.
 */
import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { findNativeEgressBoundaryViolations } from '../../../scripts/check-native-egress-boundary.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

describe('native egress boundary contract', () => {
  it('every native connector send and body-read is enclosed by a guard span (no violations)', () => {
    expect(findNativeEgressBoundaryViolations(repoRoot)).toEqual([]);
  });
});
