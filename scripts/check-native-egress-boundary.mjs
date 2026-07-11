#!/usr/bin/env node
/**
 * Static proof for Offline Mode's native boundary.
 *
 * `reqwest::Client` is intentionally a low-level transport.  A connector may
 * construct one to set its timeout/auth headers, but production transport must
 * still pass through `connector_network::{authorize_*, await_authorized}` (or
 * `EgressHttpClient`).  This check rejects a raw client or WebSocket
 * constructor unless the containing source file is one of those policy clients
 * or demonstrably uses that native policy boundary.
 *
 * This is deliberately source-level defence in depth, not a replacement for
 * the traffic-recording release test.  It makes a newly added native bypass
 * fail fast in both the local gate and CI.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');

const RAW_CONSTRUCTION = [
  /\breqwest::Client::(?:new|builder)\s*\(/,
  /\b(?:tokio_tungstenite|tungstenite)::(?:connect_async|client_async(?:_tls)?)\s*\(/,
];

const REDIRECT_CAPABLE_CLIENT = /\breqwest::Client::(?:new|builder)\s*\(/;
const RAW_REDIRECTING_GET = /\breqwest::get\s*\(/;
const REDIRECT_DISABLED = /\.redirect\s*\(\s*(?:reqwest::redirect::)?Policy::none\s*\(\s*\)\s*\)/;

// These are the boundary implementation itself, not consumers of it.
const POLICY_IMPLEMENTATIONS = new Set([
  'src-tauri/src/network_policy.rs',
  'src-tauri/src/egress_http.rs',
  'src-tauri/src/commands/connector_network.rs',
]);

const LOOPBACK_SIDECARS = new Set([
  // This sidecar owns a bundled process that is hard-bound to literal
  // 127.0.0.1. It cannot be configured to contact a remote host.
  'src-tauri/src/sidecars/llama_server.rs',
]);

const KNOWN_TRACKED_EXCEPTIONS = new Map([
  [
    'src-tauri/src/commands/firm/sso.rs',
    // KNOWN, TRACKED GAP: this file has unguarded /auth/sso/start and
    // /auth/sso/exchange calls. It is owned by the concurrent firm-relay
    // workstream and is NOT closed. Remove this exception when that lane lands
    // its Offline Mode fix. Do not add other production exceptions here.
    'KNOWN, TRACKED gap: unguarded SSO calls; owned by the concurrent firm-relay workstream; remove when that lane lands its Offline Mode fix.',
  ],
]);

function toPosix(path) {
  return path.split(sep).join('/');
}

function collectRustFiles(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) collectRustFiles(full, out);
    else if (entry.endsWith('.rs')) out.push(full);
  }
  return out;
}

/**
 * Rust test modules conventionally live at the end of these files. Their fake
 * clients/loopback servers must not create a production-policy finding.
 */
function productionSource(source) {
  const testModule = source.search(/^\s*#\[cfg\(test\)\]\s*\n\s*mod\s+/m);
  return testModule === -1 ? source : source.slice(0, testModule);
}

function isPolicyGuardedClient(source) {
  const usesConnectorBoundary =
    (source.includes('crate::commands::connector_network::await_authorized') ||
      source.includes('crate::commands::connector_network::send_with_authorized_redirects') ||
      /\b(?:await_authorized|send_with_authorized_redirects)\s*\(/.test(source)) &&
    /\bNetworkPolicy\b/.test(source);
  const usesEgressHttpClient =
    source.includes('EgressHttpClient::new') && source.includes('authorize_url');
  return usesConnectorBoundary || usesEgressHttpClient;
}

/** A builder's redirect setting must appear before its build call. Keeping the
 * scan local catches a copied client setup even when the rest of its file uses
 * authorize_url/await_authorized for the first request. */
function clientDisablesAutomaticRedirects(lines, start) {
  for (let index = start; index < Math.min(lines.length, start + 24); index += 1) {
    if (REDIRECT_DISABLED.test(lines.slice(start, index + 1).join(' '))) return true;
    if (/\.build\s*\(\s*\)/.test(lines[index])) return false;
  }
  return false;
}

export function findNativeEgressBoundaryViolations(root = repoRoot) {
  const nativeRoot = join(root, 'src-tauri/src');
  const violations = [];

  for (const file of collectRustFiles(nativeRoot)) {
    const relPath = toPosix(relative(root, file));
    const source = productionSource(readFileSync(file, 'utf8'));
    const lines = source.split('\n');
    const hasRawConstruction = lines.some((line) =>
      RAW_CONSTRUCTION.some((pattern) => pattern.test(line)),
    );
    const redirectViolations = [];
    if (
      !POLICY_IMPLEMENTATIONS.has(relPath) &&
      !LOOPBACK_SIDECARS.has(relPath) &&
      !KNOWN_TRACKED_EXCEPTIONS.has(relPath)
    ) {
      lines.forEach((line, index) => {
        if (RAW_REDIRECTING_GET.test(line)) {
          redirectViolations.push({
            relPath,
            line: index + 1,
            text: line.trim(),
            rule: 'raw reqwest::get follows redirects automatically',
          });
        } else if (
          REDIRECT_CAPABLE_CLIENT.test(line) &&
          !clientDisablesAutomaticRedirects(lines, index)
        ) {
          redirectViolations.push({
            relPath,
            line: index + 1,
            text: line.trim(),
            rule: 'reqwest client does not explicitly disable automatic redirects',
          });
        }
      });
    }
    violations.push(...redirectViolations);

    if (!hasRawConstruction) continue;

    if (
      POLICY_IMPLEMENTATIONS.has(relPath) ||
      LOOPBACK_SIDECARS.has(relPath) ||
      KNOWN_TRACKED_EXCEPTIONS.has(relPath) ||
      isPolicyGuardedClient(source)
    ) {
      continue;
    }

    lines.forEach((line, index) => {
      if (RAW_CONSTRUCTION.some((pattern) => pattern.test(line))) {
        violations.push({ relPath, line: index + 1, text: line.trim() });
      }
    });
  }

  return violations;
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (invokedDirectly) {
  const violations = findNativeEgressBoundaryViolations();
  if (violations.length > 0) {
    console.error('❌ Native network construction outside Offline Mode policy boundary:\n');
    for (const violation of violations) {
      console.error(`   ${violation.relPath}:${violation.line}  ${violation.text}${violation.rule ? ` (${violation.rule})` : ''}`);
    }
    console.error(
      '\nUse EgressHttpClient or connector_network authorization before the transport, and disable automatic redirects so every hop is authorized. ' +
        'Only the native policy implementation, literal-loopback sidecar, and one loud tracked SSO gap are exempt.',
    );
    process.exit(1);
  }

  const exceptions = [...KNOWN_TRACKED_EXCEPTIONS.entries()];
  console.log('✅ Native network construction is behind the Offline Mode policy boundary.');
  for (const [path, reason] of exceptions) {
    console.log(`⚠️  TEMPORARY EXCEPTION ${path}: ${reason}`);
  }
}
