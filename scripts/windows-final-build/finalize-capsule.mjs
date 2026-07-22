import fs from 'node:fs';
import { writeCapsule } from './contract.mjs';

const [fragmentPath, outputPath] = process.argv.slice(2);
if (!fragmentPath || !outputPath)
  throw new Error(
    'usage: finalize-capsule.mjs <fragment.json> <build-capsule.json>'
  );
const raw = fs.readFileSync(fragmentPath, 'utf8');
if (raw.charCodeAt(0) === 0xfeff) throw new Error('fragment BOM forbidden');
const capsule = JSON.parse(raw);
const digest = writeCapsule(outputPath, capsule);
process.stdout.write(`${digest}\n`);
