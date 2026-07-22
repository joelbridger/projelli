import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { crc32, inflateRawSync } from 'node:zlib';
import { canonical, sha256, validateLogicalPath } from './contract.mjs';

const fail = (message) => {
  throw new Error(message);
};
const sha1Object = (type, bytes) =>
  createHash('sha1')
    .update(`${type} ${bytes.length}\0`, 'ascii')
    .update(bytes)
    .digest('hex');
const exactKeys = (value, keys, where) => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    fail(`${where} must be an object`);
  const actual = Object.keys(value);
  if (
    actual.length !== keys.length ||
    actual.some((key) => !keys.includes(key))
  )
    fail(`${where} has missing or extra fields`);
};

export function validateSourceManifest(raw) {
  const bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
  if (
    !bytes.length ||
    bytes.at(-1) === 10 ||
    bytes.toString('utf8').charCodeAt(0) === 0xfeff
  )
    fail('source manifest must be canonical UTF-8 without BOM or newline');
  const manifest = JSON.parse(bytes.toString('utf8'));
  exactKeys(
    manifest,
    ['schema', 'commit', 'tree', 'commit_object_base64', 'files'],
    'source manifest'
  );
  if (
    manifest.schema !== 1 ||
    !/^[0-9a-f]{40}$/.test(manifest.commit) ||
    !/^[0-9a-f]{40}$/.test(manifest.tree)
  )
    fail('invalid declared source identity');
  if (canonical(manifest) !== bytes.toString('utf8'))
    fail('source manifest is not canonical');
  const commitBytes = Buffer.from(manifest.commit_object_base64, 'base64');
  if (
    commitBytes.toString('base64') !== manifest.commit_object_base64 ||
    sha1Object('commit', commitBytes) !== manifest.commit
  )
    fail('forged source commit');
  const commitTree = /^tree ([0-9a-f]{40})$/m.exec(
    commitBytes.toString('utf8')
  )?.[1];
  if (commitTree !== manifest.tree) fail('forged source tree declaration');
  if (!Array.isArray(manifest.files) || !manifest.files.length)
    fail('empty source manifest');
  const seen = new Set();
  for (const file of manifest.files) {
    exactKeys(
      file,
      ['mode', 'type', 'blob', 'bytes', 'path'],
      `source file ${file?.path ?? ''}`
    );
    validateLogicalPath(file.path);
    const key = file.path.normalize('NFC').toLowerCase();
    if (seen.has(key)) fail(`duplicate/case/NFC source path: ${file.path}`);
    seen.add(key);
    if (
      !['100644', '100755', '120000'].includes(file.mode) ||
      file.type !== 'blob' ||
      !/^[0-9a-f]{40}$/.test(file.blob) ||
      !Number.isSafeInteger(file.bytes) ||
      file.bytes < 0
    )
      fail(`invalid source file identity: ${file.path}`);
  }
  if (
    manifest.files.some(
      (file, i) =>
        i &&
        Buffer.compare(
          Buffer.from(manifest.files[i - 1].path),
          Buffer.from(file.path)
        ) >= 0
    )
  )
    fail('source manifest files are not byte-sorted');
  const root = { dirs: new Map(), files: [] };
  for (const file of manifest.files) {
    let node = root;
    const parts = file.path.split('/');
    for (const part of parts.slice(0, -1)) {
      if (!node.dirs.has(part))
        node.dirs.set(part, { dirs: new Map(), files: [] });
      node = node.dirs.get(part);
    }
    node.files.push({ ...file, name: parts.at(-1) });
  }
  const treeHash = (node) => {
    const entries = [
      ...node.files.map((file) => ({
        name: file.name,
        sort: file.name,
        mode: file.mode,
        oid: file.blob,
      })),
      ...[...node.dirs].map(([name, child]) => ({
        name,
        sort: `${name}/`,
        mode: '40000',
        oid: treeHash(child),
      })),
    ].sort((a, b) => Buffer.compare(Buffer.from(a.sort), Buffer.from(b.sort)));
    const body = Buffer.concat(
      entries.map((entry) =>
        Buffer.concat([
          Buffer.from(`${entry.mode} ${entry.name}\0`, 'utf8'),
          Buffer.from(entry.oid, 'hex'),
        ])
      )
    );
    return sha1Object('tree', body);
  };
  if (treeHash(root) !== manifest.tree)
    fail('source manifest does not reconstruct declared Git tree');
  return { manifest, manifest_sha256: sha256(bytes) };
}

export function readZip(raw) {
  const bytes = Buffer.isBuffer(raw) ? raw : fs.readFileSync(raw);
  let eocd = -1;
  for (
    let i = bytes.length - 22;
    i >= Math.max(0, bytes.length - 65_557);
    i -= 1
  )
    if (bytes.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  if (eocd < 0 || eocd + 22 !== bytes.length)
    fail('ZIP EOCD missing, commented, or trailed');
  const count = bytes.readUInt16LE(eocd + 10),
    centralSize = bytes.readUInt32LE(eocd + 12),
    centralOffset = bytes.readUInt32LE(eocd + 16);
  if (
    bytes.readUInt16LE(eocd + 4) ||
    bytes.readUInt16LE(eocd + 6) ||
    bytes.readUInt16LE(eocd + 8) !== count ||
    centralOffset + centralSize !== eocd
  )
    fail('multi-disk, ZIP64, or malformed ZIP forbidden');
  const entries = [];
  let cursor = centralOffset;
  for (let i = 0; i < count; i += 1) {
    if (bytes.readUInt32LE(cursor) !== 0x02014b50)
      fail('invalid ZIP central directory');
    const flags = bytes.readUInt16LE(cursor + 8),
      method = bytes.readUInt16LE(cursor + 10),
      crc = bytes.readUInt32LE(cursor + 16),
      compressed = bytes.readUInt32LE(cursor + 20),
      size = bytes.readUInt32LE(cursor + 24);
    const nameLen = bytes.readUInt16LE(cursor + 28),
      extraLen = bytes.readUInt16LE(cursor + 30),
      commentLen = bytes.readUInt16LE(cursor + 32),
      external = bytes.readUInt32LE(cursor + 38),
      localOffset = bytes.readUInt32LE(cursor + 42);
    if (
      (flags & ~0x800) !== 0 ||
      ![0, 8].includes(method) ||
      compressed === 0xffffffff ||
      size === 0xffffffff ||
      extraLen ||
      commentLen
    )
      fail(
        'encrypted, descriptor, extended, unsupported, or ZIP64 entry forbidden'
      );
    const nameBytes = bytes.subarray(cursor + 46, cursor + 46 + nameLen);
    const name = nameBytes.toString('utf8');
    if (!nameBytes.equals(Buffer.from(name, 'utf8')))
      fail('invalid UTF-8 ZIP name');
    const directory = name.endsWith('/'),
      logical = directory ? name.slice(0, -1) : name;
    validateLogicalPath(logical);
    const unixMode = external >>> 16,
      fileType = unixMode & 0o170000;
    if (fileType && fileType !== (directory ? 0o040000 : 0o100000))
      fail(`link/reparse-like ZIP member forbidden: ${name}`);
    if (bytes.readUInt32LE(localOffset) !== 0x04034b50)
      fail(`missing local ZIP header: ${name}`);
    const localFlags = bytes.readUInt16LE(localOffset + 6),
      localMethod = bytes.readUInt16LE(localOffset + 8),
      localNameLen = bytes.readUInt16LE(localOffset + 26),
      localExtraLen = bytes.readUInt16LE(localOffset + 28);
    const localName = bytes.subarray(
      localOffset + 30,
      localOffset + 30 + localNameLen
    );
    if (
      localFlags !== flags ||
      localMethod !== method ||
      localExtraLen ||
      !localName.equals(nameBytes)
    )
      fail(`central/local ZIP mismatch: ${name}`);
    const dataOffset = localOffset + 30 + localNameLen + localExtraLen;
    if (dataOffset + compressed > centralOffset)
      fail(`ZIP member overlaps metadata: ${name}`);
    const packed = bytes.subarray(dataOffset, dataOffset + compressed);
    const content =
      method === 0
        ? Buffer.from(packed)
        : inflateRawSync(packed, { maxOutputLength: size + 1 });
    if (content.length !== size || crc32(content) >>> 0 !== crc)
      fail(`ZIP member size/CRC mismatch: ${name}`);
    entries.push({
      name: logical,
      directory,
      content,
      mode: unixMode,
      localOffset,
      dataEnd: dataOffset + compressed,
    });
    cursor += 46 + nameLen + extraLen + commentLen;
  }
  if (cursor !== eocd) fail('ZIP central directory size mismatch');
  const ranges = [...entries].sort((a, b) => a.localOffset - b.localOffset);
  let rangeEnd = 0;
  for (const entry of ranges) {
    if (entry.localOffset !== rangeEnd)
      fail('hidden, overlapping, or unmeasured ZIP bytes forbidden');
    rangeEnd = entry.dataEnd;
  }
  if (rangeEnd !== centralOffset)
    fail('unmeasured bytes before ZIP central directory');
  const seen = new Set();
  for (const entry of entries) {
    const key = entry.name.normalize('NFC').toLowerCase();
    if (seen.has(key)) fail(`duplicate/case/NFC ZIP member: ${entry.name}`);
    seen.add(key);
  }
  return { bytes, entries };
}

export function verifySourceArchive({
  archiveBytes,
  manifestBytes,
  destination,
}) {
  const { manifest, manifest_sha256 } = validateSourceManifest(manifestBytes);
  const archive = readZip(archiveBytes);
  const expected = new Map(manifest.files.map((file) => [file.path, file]));
  const measured = new Map();
  const expectedDirs = new Set();
  for (const file of manifest.files) {
    const parts = file.path.split('/');
    for (let i = 1; i < parts.length; i += 1)
      expectedDirs.add(parts.slice(0, i).join('/'));
  }
  const actualFiles = archive.entries.filter((entry) => !entry.directory);
  for (const entry of archive.entries) {
    if (entry.directory) {
      if (!expectedDirs.has(entry.name))
        fail(`extra ZIP directory: ${entry.name}`);
      continue;
    }
    const file = expected.get(entry.name);
    if (!file) fail(`extra ZIP file: ${entry.name}`);
    if (
      entry.content.length !== file.bytes ||
      sha1Object('blob', entry.content) !== file.blob
    )
      fail(`modified Git blob: ${entry.name}`);
    measured.set(entry.name, sha256(entry.content));
    const archiveMode = entry.mode & 0o777;
    const safeArchiveMode = file.mode === '100755' ? 0o755 : 0o644;
    if (entry.mode && archiveMode !== safeArchiveMode)
      fail(`ZIP mode mismatch: ${entry.name}`);
  }
  if (actualFiles.length !== expected.size)
    fail('missing or duplicate ZIP file');
  if (destination) {
    if (fs.existsSync(destination))
      fail('private extraction root already exists');
    fs.mkdirSync(destination, { recursive: false, mode: 0o700 });
    for (const entry of actualFiles) {
      const output = path.join(destination, ...entry.name.split('/'));
      fs.mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });
      fs.writeFileSync(output, entry.content, {
        flag: 'wx',
        mode: expected.get(entry.name).mode === '100755' ? 0o700 : 0o600,
      });
    }
  }
  return {
    schema: 1,
    commit: manifest.commit,
    tree: manifest.tree,
    archive_manifest_sha256: manifest_sha256,
    archive_sha256: sha256(archive.bytes),
    files: manifest.files.map((file) => ({
      ...file,
      sha256: measured.get(file.path),
    })),
  };
}
