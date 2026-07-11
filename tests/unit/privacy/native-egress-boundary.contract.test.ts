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
import { describe, it, expect, afterEach } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { findNativeEgressBoundaryViolations } from '../../../scripts/check-native-egress-boundary.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

describe('native egress boundary contract', () => {
  it('every native connector send and body-read is enclosed by a guard span (no violations)', () => {
    expect(findNativeEgressBoundaryViolations(repoRoot)).toEqual([]);
  });
});

describe('native egress boundary checker: block-comment bypasses', () => {
  const scratchDirs: string[] = [];

  afterEach(() => {
    for (const dir of scratchDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function fixtureRoot(source: string): string {
    const root = mkdtempSync(join(tmpdir(), 'native-egress-boundary-fixture-'));
    scratchDirs.push(root);
    const commandsDir = join(root, 'src-tauri', 'src', 'commands');
    mkdirSync(commandsDir, { recursive: true });
    writeFileSync(join(commandsDir, 'fixture.rs'), source, 'utf8');
    return root;
  }

  it('a #[cfg(test)] attribute hidden inside a block comment does not exempt a real unguarded body read', () => {
    // The exemption for inline #[cfg(test)] fallbacks must key off a real
    // attribute, not off the substring appearing anywhere in a comment —
    // otherwise commenting it out ahead of a genuine production body-read
    // would silently blank that statement out of the scan too.
    const root = fixtureRoot(`
      use crate::network_policy::NetworkPolicy;
      async fn send(policy: &NetworkPolicy, url: &str) -> anyhow::Result<reqwest::Response> {
          let authorized = crate::commands::connector_network::authorize_url(policy, &OP, url)?;
          crate::commands::connector_network::await_authorized(policy, &authorized, async {
              Ok(reqwest::Client::new().get(url).send().await?)
          }).await
      }
      /* #[cfg(test)] */
      async fn read_body(resp: reqwest::Response) -> anyhow::Result<String> {
          Ok(resp.text().await?)
      }
    `);
    const violations = findNativeEgressBoundaryViolations(root);
    expect(violations.some((v: { text: string }) => v.text.includes('.text()'))).toBe(true);
  });

  it('a comment spliced between a method name and its call cannot evade the HTTP-completing-call match', () => {
    const root = fixtureRoot(`
      use crate::network_policy::NetworkPolicy;
      async fn send(policy: &NetworkPolicy, url: &str) -> anyhow::Result<reqwest::Response> {
          let authorized = crate::commands::connector_network::authorize_url(policy, &OP, url)?;
          crate::commands::connector_network::await_authorized(policy, &authorized, async {
              Ok(reqwest::Client::new().get(url).send().await?)
          }).await
      }
      async fn read_body(resp: reqwest::Response) -> anyhow::Result<String> {
          Ok(resp.text/* sneaky */().await?)
      }
    `);
    const violations = findNativeEgressBoundaryViolations(root);
    expect(violations.some((v: { text: string }) => v.text.includes('.text'))).toBe(true);
  });
});
