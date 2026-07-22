import fs from 'node:fs';
import path from 'node:path';
import { canonical, sha256, validateLogicalPath } from './contract.mjs';

const root = process.cwd();
const generatedPath = process.argv[2];
if (!generatedPath) throw new Error('generated config path required');
const walk = (dir) =>
  fs.existsSync(dir)
    ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        const rel = path.relative(root, full).split(path.sep).join('/');
        validateLogicalPath(rel);
        if (entry.isSymbolicLink()) throw new Error(`link forbidden: ${rel}`);
        return entry.isDirectory() ? walk(full) : [rel];
      })
    : [];
const staged = [
  ...walk('src-tauri/resources'),
  ...walk('src-tauri/binaries'),
  ...walk('src-tauri/voices'),
]
  .filter((p) => !p.endsWith('/.gitkeep'))
  .sort();
const exactBinaryNames = new Set([
  'espeak-ng.dll',
  'ggml-base.dll',
  'ggml-cpu-alderlake.dll',
  'ggml-cpu-cannonlake.dll',
  'ggml-cpu-cascadelake.dll',
  'ggml-cpu-cooperlake.dll',
  'ggml-cpu-haswell.dll',
  'ggml-cpu-icelake.dll',
  'ggml-cpu-ivybridge.dll',
  'ggml-cpu-piledriver.dll',
  'ggml-cpu-sandybridge.dll',
  'ggml-cpu-sapphirerapids.dll',
  'ggml-cpu-skylakex.dll',
  'ggml-cpu-sse42.dll',
  'ggml-cpu-x64.dll',
  'ggml-cpu-zen4.dll',
  'ggml-rpc.dll',
  'ggml.dll',
  'libomp140.x86_64.dll',
  'libtashkeel_model.ort',
  'llama-batched-bench-impl.dll',
  'llama-bench-impl.dll',
  'llama-cli-impl.dll',
  'llama-common.dll',
  'llama-completion-impl.dll',
  'llama-fit-params-impl.dll',
  'llama-perplexity-impl.dll',
  'llama-quantize-impl.dll',
  'llama-server-impl.dll',
  'llama-server-x86_64-pc-windows-msvc.exe',
  'llama.dll',
  'mtmd.dll',
  'onnxruntime.dll',
  'onnxruntime_providers_shared.dll',
  'piper-x86_64-pc-windows-msvc.exe',
  'piper_phonemize.dll',
  'whisper.exe',
]);
const explained = (p) => {
  if (p.startsWith('src-tauri/binaries/espeak-ng-data/')) return true;
  if (p.startsWith('src-tauri/binaries/diarize/'))
    return /^src-tauri\/binaries\/diarize\/(?:lantern-diarize\.exe|[^/]*sherpa-onnx-c-api\.dll|[^/]*onnxruntime[^/]*\.dll)$/.test(
      p
    );
  if (p.startsWith('src-tauri/binaries/'))
    return exactBinaryNames.has(p.slice('src-tauri/binaries/'.length));
  return /^(?:src-tauri\/resources\/(?:voice\/models\/(?:ggml-tiny\.en|ggml-base\.en)\.bin|diarize\/(?:segmentation|embedding)\.onnx|mcpb\/lantern-windows\.mcpb)|src-tauri\/voices\/en_US-amy-medium\/en_US-amy-medium\.onnx(?:\.json)?)$/.test(
    p
  );
};
for (const p of staged) {
  if (
    /(?:^|\/)(?:[^/]+-(?:unknown-linux-gnu|apple-darwin)|[^/]+\.(?:so(?:\.[0-9.]+)?|dylib))$/.test(
      p
    )
  )
    throw new Error(`wrong-target packager input: ${p}`);
  if (/src-tauri\/binaries\/lantern-mcp-/i.test(p))
    throw new Error(`loose MCP executable forbidden: ${p}`);
  if (!explained(p)) throw new Error(`unexplained staged input: ${p}`);
}
const required = [
  /^src-tauri\/binaries\/piper-x86_64-pc-windows-msvc\.exe$/,
  /^src-tauri\/binaries\/llama-server-x86_64-pc-windows-msvc\.exe$/,
  /^src-tauri\/binaries\/whisper\.exe$/,
  /^src-tauri\/binaries\/diarize\/lantern-diarize\.exe$/,
  /^src-tauri\/binaries\/diarize\/.*sherpa-onnx-c-api\.dll$/,
  /^src-tauri\/binaries\/diarize\/.*onnxruntime.*\.dll$/,
  /^src-tauri\/resources\/voice\/models\/ggml-tiny\.en\.bin$/,
  /^src-tauri\/resources\/voice\/models\/ggml-base\.en\.bin$/,
  /^src-tauri\/resources\/diarize\/segmentation\.onnx$/,
  /^src-tauri\/resources\/diarize\/embedding\.onnx$/,
  /^src-tauri\/resources\/mcpb\/lantern-windows\.mcpb$/,
];
for (const pattern of required)
  if (!staged.some((p) => pattern.test(p)))
    throw new Error(`missing staged family: ${pattern}`);
const resources = {};
for (const source of staged.filter(
  (p) =>
    !p.startsWith('src-tauri/binaries/piper-x86_64-pc-windows-msvc.exe') &&
    !p.startsWith('src-tauri/binaries/llama-server-x86_64-pc-windows-msvc.exe')
)) {
  const relative = source.slice('src-tauri/'.length);
  resources[relative] =
    relative === 'resources/mcpb/lantern-windows.mcpb'
      ? 'mcpb/lantern-windows.mcpb'
      : relative;
}
const merge = (left, right) =>
  Object.fromEntries(
    [...new Set([...Object.keys(left ?? {}), ...Object.keys(right ?? {})])].map(
      (key) => [
        key,
        left?.[key] &&
        right?.[key] &&
        typeof left[key] === 'object' &&
        typeof right[key] === 'object' &&
        !Array.isArray(left[key]) &&
        !Array.isArray(right[key])
          ? merge(left[key], right[key])
          : right?.[key] !== undefined
            ? right[key]
            : left[key],
      ]
    )
  );
const base = JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json', 'utf8'));
const override = JSON.parse(
  fs.readFileSync('src-tauri/tauri.control-day-unsigned.conf.json', 'utf8')
);
const config = merge(merge(base, override), {
  build: { beforeBuildCommand: '' },
  bundle: {
    resources,
    externalBin: ['binaries/piper', 'binaries/llama-server'],
  },
});
const bytes = Buffer.from(canonical(config), 'ascii');
fs.writeFileSync(generatedPath, bytes, { flag: 'wx' });
process.stdout.write(`${sha256(bytes)}\n`);
