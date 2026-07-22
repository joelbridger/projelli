import fs from 'node:fs';
import path from 'node:path';
import { canonical, sha256, writeCapsule } from './contract.mjs';

const [buildRoot] = process.argv.slice(2);
if (!buildRoot)
  throw new Error('usage: finalize-measured-capsule.mjs <fixed-build-root>');
const evidence = path.join(buildRoot, '.aph-provenance');
const read = (name) =>
  JSON.parse(fs.readFileSync(path.join(evidence, name), 'utf8'));
const fragmentBytes = fs.readFileSync(
  path.join(evidence, 'capsule-fragment.json')
);
const capsule = JSON.parse(fragmentBytes.toString('utf8'));
const pairs = [
  ['archive-before.json', 'archive-guarded.json'],
  ['recorder-before.json', 'recorder-guarded.json'],
  ['manifest-before.json', 'manifest-guarded.json'],
  ['tracked-before.json', 'tracked-guarded.json'],
  ['packager-before.json', 'packager-guarded.json'],
  ['controller-before.json', 'controller-guarded.json'],
  ['installer-before.json', 'installer-guarded.json'],
  ['fragment-before.json', 'fragment-guarded.json'],
];
for (const [beforeName, afterName] of pairs) {
  const before = read(beforeName).rows,
    after = read(afterName).rows;
  if (canonical(before) !== canonical(after))
    throw new Error(`protected before/after closure mismatch: ${beforeName}`);
}
if (
  canonical(capsule.stability.before) !==
  canonical(read('packager-guarded.json').rows)
)
  throw new Error(
    'capsule packager stability was not held through reconciliation'
  );
const fragmentGuard = read('fragment-guarded.json').rows;
if (
  fragmentGuard.length !== 1 ||
  fragmentGuard[0].sha256 !== sha256(fragmentBytes)
)
  throw new Error('measured capsule fragment changed before finalization');
writeCapsule(path.join(buildRoot, 'build-capsule.json'), capsule);
process.stdout.write(
  'All held reads closed unchanged; canonical capsule finalized.\n'
);
