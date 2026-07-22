import fs from 'node:fs';
import path from 'node:path';
import { validateLogicalPath } from './contract.mjs';
const [manifestPath, generatedConfig, outPath] = process.argv.slice(2);
if (!outPath)
  throw new Error('manifest, generated config, and output required');
const sourceManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (!Array.isArray(sourceManifest.files))
  throw new Error('source manifest files missing');
const tracked = sourceManifest.files
  .filter((x) => x.type === 'blob')
  .map((x) => x.path);
const walk = (dir) =>
  fs.existsSync(dir)
    ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = path.join(dir, e.name),
          r = path.relative(process.cwd(), p).split(path.sep).join('/');
        return e.isDirectory() ? walk(p) : [r];
      })
    : [];
const generated = [
  'public/pdf.worker.min.mjs',
  'public/ocr/tesseract-worker.js',
  'public/ocr/tesseract-core.wasm',
  'public/ocr/tesseract-core-fallback.wasm',
  'public/ocr/eng.traineddata',
  ...walk('dist'),
  'src-tauri/target/release/lantern.exe',
  generatedConfig.split(path.sep).join('/'),
];
const staged = [
  ...walk('src-tauri/binaries'),
  ...walk('src-tauri/resources'),
  ...walk('src-tauri/voices'),
  'mcpb-dist/lantern-windows.mcpb',
];
const values = [...new Set([...tracked, ...generated, ...staged])].sort();
for (const value of values) {
  validateLogicalPath(value);
  if (!fs.statSync(value).isFile())
    throw new Error(`not a regular input: ${value}`);
}
fs.writeFileSync(outPath, values.join('\n') + '\n', {
  encoding: 'utf8',
  flag: 'wx',
});
