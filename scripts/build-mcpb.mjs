#!/usr/bin/env node
// Build a Lantern MCP `.mcpb` Desktop Extension bundle for one platform.
//
// Anthropic's DXT (".mcpb") spec:
//   https://github.com/anthropics/dxt
//
// The format is a plain zip archive with:
//   manifest.json     — declares the server, required env vars, MCP version
//   server/<binary>   — pre-built platform-specific binary
//
// Output: `dist/lantern-<platform>.mcpb` (one per target triple).
//
// Usage:
//   node scripts/build-mcpb.mjs \
//     --binary src-tauri/binaries/lantern-mcp-aarch64-apple-darwin \
//     --target aarch64-apple-darwin \
//     --output dist/lantern-aarch64-apple-darwin.mcpb
//
// The GitHub release workflow invokes this after `cargo build --bin
// lantern-mcp`. For a local smoke test, run it the same way with a local
// build output.
//
// Zero third-party deps: uses the shipped `fflate` via `zlib` crypto-ish
// tricks — actually, we just use Node's built-in `zlib.createGzip` and the
// stored-only zip format so we don't need JSZip / adm-zip / archiver.
//
// The zip implementation below is a minimal STORED-only writer (no
// compression). `.mcpb` zips are small (a few MB) and Claude Desktop
// happily reads STORED entries; skipping compression keeps the script
// dependency-free and bit-reproducible across platforms.

import { readFileSync, writeFileSync, statSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { argv, exit } from 'node:process';
import { fileURLToPath } from 'node:url';
import { crc32 } from 'node:zlib';
import { Buffer } from 'node:buffer';

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

function parseArgs() {
  const out = {
    binary: '',
    target: '',
    output: '',
    version: '',
  };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    const next = argv[i + 1];
    switch (a) {
      case '--binary':
        out.binary = next;
        i += 1;
        break;
      case '--target':
        out.target = next;
        i += 1;
        break;
      case '--output':
        out.output = next;
        i += 1;
        break;
      case '--version':
        out.version = next;
        i += 1;
        break;
      default:
        console.error(`unknown arg: ${a}`);
        exit(1);
    }
  }
  const missing = ['binary', 'target', 'output'].filter((k) => !out[k]);
  if (missing.length > 0) {
    console.error(`missing required args: ${missing.join(', ')}`);
    console.error(
      'usage: build-mcpb.mjs --binary <path> --target <triple> --output <file> [--version <ver>]',
    );
    exit(1);
  }
  if (!out.version) {
    // Fall back to the root package.json so CI doesn't have to pass it.
    try {
      const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
      out.version = pkg.version ?? '0.0.0';
    } catch {
      out.version = '0.0.0';
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

/**
 * Build the `manifest.json` content per the DXT spec:
 *   https://github.com/anthropics/dxt/blob/main/MANIFEST.md
 *
 * Fields that matter for Claude Desktop (April 2026):
 *   - dxt_version:   spec version we target
 *   - name/version:  server identity
 *   - server.type:   "binary"  (we ship a compiled sidecar)
 *   - server.entry_point:  relative path to the binary inside the archive
 *   - user_config:   prompts Claude Desktop shows the user on install so
 *                    they can pick their workspace folder
 */
function buildManifest({ target, version }) {
  const binaryName = target.includes('windows') ? 'lantern-mcp.exe' : 'lantern-mcp';
  return {
    dxt_version: '0.1',
    name: 'lantern',
    display_name: 'Advisor Prep Hero Workspace',
    version,
    description:
      'Read your Advisor Prep Hero workspace (files + memory + semantic search) from any MCP client.',
    long_description:
      'Exposes five tools over the Model Context Protocol: list files, read files, semantic search (using the same local embeddings Advisor Prep Hero uses for @workspace), get memory facts, and (with your approval) write files back. Everything stays on your machine.',
    author: {
      name: 'Advisor Prep Hero',
      url: 'https://keepance.com',
    },
    homepage: 'https://keepance.com',
    license: 'MIT',
    server: {
      type: 'binary',
      entry_point: `server/${binaryName}`,
      mcp_config: {
        command: `\${__dirname}/server/${binaryName}`,
        args: [],
        env: {
          // Populated from `user_config.workspace_root` at install time by
          // Claude Desktop — the double-brace is the DXT template syntax.
          LANTERN_WORKSPACE_ROOT: '${user_config.workspace_root}',
        },
      },
    },
    user_config: {
      workspace_root: {
        type: 'directory',
        title: 'Advisor Prep Hero workspace folder',
        description:
          'The folder Advisor Prep Hero opens as your workspace (the same folder you pick inside the app).',
        required: true,
      },
    },
    compatibility: {
      // We target this MCP spec revision end-to-end.
      mcp_version: '2025-03-26',
      platforms: [target],
    },
  };
}

// ---------------------------------------------------------------------------
// Minimal ZIP writer (STORED only, PKZIP 2.0 compatible)
// ---------------------------------------------------------------------------

/**
 * Add a file entry to the zip; returns { localHeader, centralDir } buffers
 * plus the CRC + size for the central directory later.
 *
 * Reference: APPNOTE.TXT §4.3.7 (local file header) + §4.3.12 (central
 * directory).
 */
// 0x5021 = DOS-date for 2020-01-01 (year bits = 40 = 1980+40, month = 1,
// day = 1). Kept fixed so .mcpb archives are bit-reproducible across
// builds. The previous default (0x5000) picked valid year bits but
// month=0 / day=0, which reads as "2020-00-00" in unzip listings — valid
// enough for Claude Desktop but distracting when debugging archive layout.
function zipEntry(relPath, content, { dosDate = 0x5021, dosTime = 0, mode = 0o100644 }) {
  const nameBuf = Buffer.from(relPath, 'utf8');
  const crc = crc32(content) >>> 0;
  const size = content.length;

  const local = Buffer.alloc(30 + nameBuf.length);
  local.writeUInt32LE(0x04034b50, 0); // local file header signature
  local.writeUInt16LE(20, 4); // version needed
  local.writeUInt16LE(0, 6); // general purpose bit flag
  local.writeUInt16LE(0, 8); // method: STORED
  local.writeUInt16LE(dosTime, 10);
  local.writeUInt16LE(dosDate, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(size, 18); // compressed size = uncompressed (STORED)
  local.writeUInt32LE(size, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  local.writeUInt16LE(0, 28); // extra length
  nameBuf.copy(local, 30);

  return {
    local: Buffer.concat([local, content]),
    centralMeta: { nameBuf, crc, size, mode, dosDate, dosTime },
  };
}

function centralDirEntry(meta, localOffset) {
  const header = Buffer.alloc(46 + meta.nameBuf.length);
  header.writeUInt32LE(0x02014b50, 0); // central dir signature
  header.writeUInt16LE(20, 4); // version made by
  header.writeUInt16LE(20, 6); // version needed
  header.writeUInt16LE(0, 8); // flags
  header.writeUInt16LE(0, 10); // method: STORED
  header.writeUInt16LE(meta.dosTime, 12);
  header.writeUInt16LE(meta.dosDate, 14);
  header.writeUInt32LE(meta.crc, 16);
  header.writeUInt32LE(meta.size, 20);
  header.writeUInt32LE(meta.size, 24);
  header.writeUInt16LE(meta.nameBuf.length, 28);
  header.writeUInt16LE(0, 30); // extra length
  header.writeUInt16LE(0, 32); // comment length
  header.writeUInt16LE(0, 34); // disk number
  header.writeUInt16LE(0, 36); // internal attrs
  // External attrs encode the Unix mode in the high 16 bits.
  header.writeUInt32LE(((meta.mode & 0xffff) << 16) >>> 0, 38);
  header.writeUInt32LE(localOffset, 42);
  meta.nameBuf.copy(header, 46);
  return header;
}

function endOfCentralDir({ entryCount, centralSize, centralOffset }) {
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // disk with central dir
  eocd.writeUInt16LE(entryCount, 8);
  eocd.writeUInt16LE(entryCount, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(centralOffset, 16);
  eocd.writeUInt16LE(0, 20); // comment length
  return eocd;
}

/** Build a full zip archive from `[ { path, content, mode? } ]`. */
export function buildZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const f of files) {
    const { local, centralMeta } = zipEntry(f.path, f.content, {
      mode: f.mode ?? 0o100644,
    });
    const central = centralDirEntry(centralMeta, offset);
    localParts.push(local);
    centralParts.push(central);
    offset += local.length;
  }
  const central = Buffer.concat(centralParts);
  const eocd = endOfCentralDir({
    entryCount: files.length,
    centralSize: central.length,
    centralOffset: offset,
  });
  return Buffer.concat([...localParts, central, eocd]);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const { binary, target, output, version } = parseArgs();
  if (!statSync(binary, { throwIfNoEntry: false })) {
    console.error(`binary not found: ${binary}`);
    exit(2);
  }
  const binBytes = readFileSync(binary);
  const manifest = buildManifest({ target, version });
  const binaryName = target.includes('windows') ? 'lantern-mcp.exe' : 'lantern-mcp';
  const zip = buildZip([
    {
      path: 'manifest.json',
      content: Buffer.from(JSON.stringify(manifest, null, 2) + '\n', 'utf8'),
    },
    {
      path: `server/${binaryName}`,
      content: binBytes,
      // Executable bit so macOS / Linux clients can spawn it without
      // `chmod +x` after extraction. Windows ignores the mode.
      mode: 0o100755,
    },
  ]);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, zip);
  const kb = (zip.length / 1024).toFixed(1);
  console.log(`built ${output} (${kb} KiB, target ${target}, version ${version})`);
}

// Only invoke when run as a script (keeps the module importable by tests).
// Use fileURLToPath so the comparison works on Windows (where argv[1] is a
// backslash-separated drive-letter path) as well as Unix. The naive
// `file://${argv[1]}` check silently no-ops on Windows, which is how this
// bug first surfaced — the v1.5-rc.7 Windows .mcpb step succeeded but never
// wrote a file, causing the upload step to fail.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
