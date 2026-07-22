import fs from 'node:fs';
import { canonical } from './contract.mjs';
import { verifySourceArchive } from './archive.mjs';

const [archivePath, manifestPath, destination, receiptPath] =
  process.argv.slice(2);
if (!receiptPath)
  throw new Error(
    'usage: verify-source-archive.mjs <archive.zip> <manifest.json> <new-private-root> <receipt.json>'
  );
const receipt = verifySourceArchive({
  archiveBytes: fs.readFileSync(archivePath),
  manifestBytes: fs.readFileSync(manifestPath),
  destination,
});
fs.writeFileSync(receiptPath, canonical(receipt), {
  encoding: 'utf8',
  flag: 'wx',
  mode: 0o600,
});
process.stdout.write(
  `Validated ${receipt.files.length} tracked Git blobs before source execution.\n`
);
