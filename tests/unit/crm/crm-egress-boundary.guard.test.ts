import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

function filesBelow(directory: string, extensions: ReadonlySet<string>): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) found.push(...filesBelow(path, extensions));
    else if ([...extensions].some((extension) => path.endsWith(extension))) found.push(path);
  }
  return found;
}

function matchingLines(path: string, patterns: readonly RegExp[]): string[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .flatMap((line, index) =>
      patterns.some((pattern) => pattern.test(line))
        ? [`${relative(ROOT, path)}:${String(index + 1)} ${line.trim()}`]
        : [],
    );
}

describe('CRM egress construction boundary', () => {
  it('forbids raw native HTTP clients, sends, and sockets inside CRM code', () => {
    const files = filesBelow(join(ROOT, 'src-tauri/src/commands/crm'), new Set(['.rs']));
    const violations = files.flatMap((path) =>
      matchingLines(path, [
        /\b(?:use|extern\s+crate)\s+reqwest\b/,
        /reqwest::(?:Client|ClientBuilder|Request|RequestBuilder|Response|get)\b/,
        /(?:ureq|hyper|isahc|attohttpc|surf|curl)::/,
        /\.send\s*\(/,
        /\b(?:self\.)?(?:http|client)\.execute\s*\(/,
        /(?:tokio|std)::net::(?:TcpStream|UdpSocket)/,
        /hyper::Client/,
      ]),
    );

    expect(
      violations,
      'CRM may only open sockets in commands/connector_network.rs, where Network lockdown and the egress registry are enforced.',
    ).toEqual([]);
  });

  it('forbids browser network APIs inside CRM renderer code', () => {
    // CRM surfaces are split across many folders (`crm-home`, `crm-ask`,
    // `connectors/wealthbox`, and so on). Scan by production path/name instead
    // of keeping a hand-written folder list that a new surface could escape.
    const files = filesBelow(join(ROOT, 'src'), new Set(['.ts', '.tsx']))
      .filter((path) => /(?:crm|wealthbox|salesforce|redtail)/i.test(relative(ROOT, path)))
      .filter((path) => !/\.(?:test|spec)\.(?:ts|tsx)$/.test(path));
    const violations = files.flatMap((path) =>
      matchingLines(path, [
        /\bfetch\s*\(/,
        /getCorsSafeFetch/,
        /new\s+(?:WebSocket|EventSource|XMLHttpRequest)\b/,
        /plugin:http/,
      ]),
    );

    expect(
      violations,
      'CRM renderer code must use the guarded command wrappers, never a browser network API.',
    ).toEqual([]);
  });
});
