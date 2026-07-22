import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { canonical, sha256, validateLogicalPath } from './contract.mjs';

const [commit, output] = process.argv.slice(2);
if (!/^[0-9a-f]{40}$/.test(commit ?? '') || !output)
  throw new Error(
    'usage: create-source-archive.mjs <approved-commit> <output.zip>'
  );
if (fs.existsSync(output)) throw new Error('archive output already exists');
const head = execFileSync('git', ['rev-parse', 'HEAD'], {
  encoding: 'ascii',
}).trim();
if (head !== commit) throw new Error('HEAD is not the approved app commit');
const tree = execFileSync('git', ['rev-parse', `${commit}^{tree}`], {
  encoding: 'ascii',
}).trim();
const records = execFileSync('git', ['ls-tree', '-r', '-z', commit]);
const manifest = [];
const seen = new Set();
for (const record of records.toString('utf8').split('\0').filter(Boolean)) {
  const match = /^(\d{6}) (blob|commit) ([0-9a-f]{40})\t(.+)$/.exec(record);
  if (!match) throw new Error('unexpected git tree row');
  validateLogicalPath(match[4]);
  if (match[2] !== 'blob' || !['100644', '100755'].includes(match[1]))
    throw new Error(`links and submodules forbidden: ${match[4]}`);
  const key = match[4].normalize('NFC').toLowerCase();
  if (seen.has(key)) throw new Error(`case/NFC collision: ${match[4]}`);
  seen.add(key);
  manifest.push({
    mode: match[1],
    type: match[2],
    blob: match[3],
    path: match[4],
  });
}
const manifestBytes = Buffer.from(canonical(manifest), 'ascii');
const manifestSha256 = sha256(manifestBytes);
fs.writeFileSync(`${output}.manifest.json`, manifestBytes, { flag: 'wx' });
execFileSync('git', ['archive', '--format=zip', '--output', output, commit], {
  stdio: 'inherit',
});
const archiveSha256 = sha256(fs.readFileSync(output));
process.stdout.write(
  `${canonical({ archive_manifest_sha256: manifestSha256, commit, server_archive_sha256: archiveSha256, tree })}\n`
);
