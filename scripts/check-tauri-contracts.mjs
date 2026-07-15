#!/usr/bin/env node
// Static guard for the Tauri command seam. It compares the renderer's
// invoke('calendar_*' | 'capture_*' | 'crm_*' | 'retention_*' | 'rag_*') calls
// with the Rust #[tauri::command] functions and generate_handler registration.
//
// This is intentionally lightweight: it does not replace TypeScript or Rust.
// It catches the common Windows-smoke failure class: wrong command name, wrong
// argument key, missing handler registration, or a clearly-wrong return shape.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), '..');
const PREFIXES = ['calendar_', 'capture_', 'crm_', 'retention_', 'rag_'];

const CONTROL_PARAM_TYPES = [/^State\s*</, /^AppHandle$/, /^Window$/, /^WebviewWindow$/];
const CONTROL_PARAM_NAMES = new Set(['app', 'state', 'window', 'webview_window', 'handle']);

function walk(dir, predicate, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'target' || entry.name === 'dist') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, predicate, out);
    else if (predicate(full)) out.push(full);
  }
  return out;
}

function rel(file) {
  return path.relative(REPO_ROOT, file).replace(/\\/g, '/');
}

function startsWithTargetPrefix(name) {
  return PREFIXES.some((prefix) => name.startsWith(prefix));
}

function snakeToCamel(name) {
  return String(name).replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
}

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length))
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function stripRustComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length))
    .replace(/^\s*\/\/\/?.*$/gm, '')
    .replace(/\s+\/\/.*$/gm, '');
}

function skipWs(source, i) {
  while (i < source.length && /\s/.test(source[i])) i += 1;
  return i;
}

function readString(source, i) {
  const quote = source[i];
  if (quote !== "'" && quote !== '"') return null;
  let out = '';
  i += 1;
  while (i < source.length) {
    const c = source[i];
    if (c === '\\') {
      out += source.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (c === quote) return { value: out, end: i + 1 };
    out += c;
    i += 1;
  }
  return null;
}

function scanBalanced(source, start, open, close, { singleQuote = true } = {}) {
  let depth = 0;
  let quote = null;
  for (let i = start; i < source.length; i++) {
    const c = source[i];
    if (quote) {
      if (c === '\\') i += 1;
      else if (c === quote) quote = null;
      continue;
    }
    if ((singleQuote && c === "'") || c === '"' || c === '`') {
      quote = c;
      continue;
    }
    if (c === open) depth += 1;
    else if (c === close) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function splitTopLevel(input, separator = ',', { singleQuote = true } = {}) {
  const parts = [];
  let start = 0;
  let depth = 0;
  let quote = null;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quote) {
      if (c === '\\') i += 1;
      else if (c === quote) quote = null;
      continue;
    }
    if ((singleQuote && c === "'") || c === '"' || c === '`') {
      quote = c;
      continue;
    }
    if ('({[<'.includes(c)) depth += 1;
    else if (')}]>'.includes(c)) depth = Math.max(0, depth - 1);
    else if (c === separator && depth === 0) {
      parts.push(input.slice(start, i).trim());
      start = i + 1;
    }
  }
  const tail = input.slice(start).trim();
  if (tail) parts.push(tail);
  return parts;
}

function topLevelObjectLiterals(expr) {
  if (!expr) return [];
  const out = [];
  let depth = 0;
  let quote = null;
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i];
    if (quote) {
      if (c === '\\') i += 1;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      quote = c;
      continue;
    }
    if (c === '(' || c === '[' || c === '<') depth += 1;
    else if (c === ')' || c === ']' || c === '>') depth = Math.max(0, depth - 1);
    else if (c === '{' && depth === 0) {
      const end = scanBalanced(expr, i, '{', '}');
      if (end !== -1) {
        out.push(expr.slice(i + 1, end));
        i = end;
      }
    }
  }
  return out;
}

function objectKeys(body) {
  const keys = new Set();
  for (const rawPart of splitTopLevel(body)) {
    const part = rawPart.trim();
    if (!part || part.startsWith('...') || part.startsWith('[')) continue;
    const colon = splitTopLevel(part, ':');
    if (colon.length > 1) {
      const key = colon[0].trim().replace(/^['"]|['"]$/g, '');
      if (/^[A-Za-z_$][\w$-]*$/.test(key)) keys.add(key);
      continue;
    }
    const shorthand = /^([A-Za-z_$][\w$]*)\b/.exec(part);
    if (shorthand) keys.add(shorthand[1]);
  }
  return keys;
}

function isAbsentOrUndefinedArg(expr) {
  const trimmed = String(expr || '').trim();
  return !trimmed || trimmed === 'undefined' || trimmed === 'void 0' || trimmed === 'void(0)';
}

function invokeCallsFromFile(file) {
  const source = stripComments(fs.readFileSync(file, 'utf8'));
  const calls = [];
  for (let i = 0; i < source.length;) {
    const idx = source.indexOf('invoke', i);
    if (idx === -1) break;
    i = idx + 'invoke'.length;
    if (/[A-Za-z0-9_$]/.test(source[idx - 1] || '') || /[A-Za-z0-9_$]/.test(source[i] || '')) continue;
    let j = skipWs(source, i);
    let generic = null;
    if (source[j] === '<') {
      const endGeneric = scanBalanced(source, j, '<', '>');
      if (endGeneric === -1) continue;
      generic = source.slice(j + 1, endGeneric).trim();
      j = skipWs(source, endGeneric + 1);
    }
    if (source[j] !== '(') continue;
    const endCall = scanBalanced(source, j, '(', ')');
    if (endCall === -1) continue;
    const inside = source.slice(j + 1, endCall);
    let k = skipWs(inside, 0);
    const str = readString(inside, k);
    if (!str || !startsWithTargetPrefix(str.value)) {
      i = endCall + 1;
      continue;
    }
    k = skipWs(inside, str.end);
    let argExpr = '';
    if (inside[k] === ',') argExpr = inside.slice(k + 1).trim();
    const objectVariants = topLevelObjectLiterals(argExpr);
    const argsVerifiable = objectVariants.length > 0 || isAbsentOrUndefinedArg(argExpr);
    const argVariants = objectVariants.length > 0
      ? objectVariants.map(objectKeys)
      : argsVerifiable
        ? [new Set()]
        : [];
    calls.push({
      name: str.value,
      generic,
      file: rel(file),
      argsVerifiable,
      argVariants,
    });
    i = endCall + 1;
  }
  return calls;
}

function parseTsTypes(files) {
  const types = new Map();
  for (const file of files) {
    const source = stripComments(fs.readFileSync(file, 'utf8'));
    const re = /export\s+interface\s+([A-Za-z_$][\w$]*)\s*\{/g;
    let match;
    while ((match = re.exec(source))) {
      const open = source.indexOf('{', match.index);
      const close = scanBalanced(source, open, '{', '}');
      if (close === -1) continue;
      const body = source.slice(open + 1, close);
      const fields = new Set();
      for (const part of splitTopLevel(body, ';').flatMap((p) => p.split('\n'))) {
        const m = /^\s*([A-Za-z_$][\w$-]*)(?:\?)?\s*:/.exec(part);
        if (m) fields.add(m[1]);
      }
      types.set(match[1], {
        fields,
        allowExtra: /\[\s*key\s*:\s*string\s*\]/.test(body),
        file: rel(file),
      });
      re.lastIndex = close + 1;
    }
  }
  return types;
}

function parseRustCommands(files) {
  const commands = new Map();
  for (const file of files) {
    const source = stripRustComments(fs.readFileSync(file, 'utf8'));
    let idx = 0;
    while ((idx = source.indexOf('#[tauri::command]', idx)) !== -1) {
      const fnMatch = /pub\s+(?:async\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(source.slice(idx));
      if (!fnMatch) {
        idx += 18;
        continue;
      }
      const name = fnMatch[1];
      const fnStart = idx + fnMatch.index;
      const open = source.indexOf('(', fnStart);
      const close = scanBalanced(source, open, '(', ')', { singleQuote: false });
      if (close === -1) {
        idx += 18;
        continue;
      }
      const paramText = source.slice(open + 1, close);
      const afterParams = source.slice(close + 1, source.indexOf('{', close));
      const returnType = afterParams.includes('->') ? afterParams.split('->')[1].trim() : '()';
      const params = splitTopLevel(paramText, ',', { singleQuote: false })
        .map((part) => {
          const pieces = part.split(':');
          if (pieces.length < 2) return null;
          const rawName = pieces[0].trim().replace(/^mut\s+/, '');
          const type = pieces.slice(1).join(':').trim();
          if (CONTROL_PARAM_NAMES.has(rawName) || CONTROL_PARAM_TYPES.some((re) => re.test(type))) return null;
          return {
            rustName: rawName,
            tsName: snakeToCamel(rawName),
            type,
            optional: /^Option\s*</.test(type),
          };
        })
        .filter(Boolean);
      commands.set(name, {
        name,
        file: rel(file),
        params,
        returnType,
      });
      idx = close + 1;
    }
  }
  return commands;
}

function parseRustStructs(files) {
  const structs = new Map();
  for (const file of files) {
    const source = stripRustComments(fs.readFileSync(file, 'utf8'));
    const re = /pub\s+struct\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/g;
    let match;
    while ((match = re.exec(source))) {
      const open = source.indexOf('{', match.index);
      const close = scanBalanced(source, open, '{', '}', { singleQuote: false });
      if (close === -1) continue;
      const body = source.slice(open + 1, close);
      const fields = new Set();
      for (const part of splitTopLevel(body, ',', { singleQuote: false })) {
        const m = /^\s*(?:#\[[^\]]+\]\s*)*pub\s+([A-Za-z_][A-Za-z0-9_]*)\s*:/.exec(part.trim());
        if (m) fields.add(snakeToCamel(m[1]));
      }
      structs.set(match[1], { fields, file: rel(file) });
      re.lastIndex = close + 1;
    }
  }
  return structs;
}

function parseGenerateHandlerNames() {
  // build.rs reads these manifests and writes the real generate_handler! list
  // into OUT_DIR. Read that same source of truth rather than lib.rs, which only
  // includes the generated fragment.
  const manifestRoot = path.join(REPO_ROOT, 'src-tauri/src');
  const manifests = walk(manifestRoot, (file) => path.basename(file) === 'command-manifest.txt');
  const names = new Set();
  let manifestCommandCount = 0;
  const rustPath = /^crate::[A-Za-z_][A-Za-z0-9_]*(?:::[A-Za-z_][A-Za-z0-9_]*)*$/;

  for (const manifest of manifests) {
    for (const [index, rawLine] of fs.readFileSync(manifest, 'utf8').split(/\r?\n/).entries()) {
      const line = rawLine.split('#', 1)[0].trim();
      if (!line) continue;
      const fields = line.split(/\s+/);
      if (fields.length < 3 || fields.length > 4 || !['command', 'state'].includes(fields[0])
        || !/^\d+$/.test(fields[1]) || !rustPath.test(fields[2])) {
        throw new Error(`${rel(manifest)}:${index + 1}: invalid native command manifest entry`);
      }
      if (fields[0] !== 'command') continue;
      manifestCommandCount += 1;
      const name = fields[2].split('::').at(-1);
      if (startsWithTargetPrefix(name)) names.add(name);
    }
  }
  return { names, manifestCommandCount };
}

function resultInner(returnType) {
  const idx = returnType.indexOf('Result<');
  if (idx === -1) return returnType.trim();
  const open = returnType.indexOf('<', idx);
  const close = scanBalanced(returnType, open, '<', '>');
  if (close === -1) return returnType.trim();
  return splitTopLevel(returnType.slice(open + 1, close))[0]?.trim() ?? returnType.trim();
}

function unwrapType(type, wrapper) {
  const trimmed = type.trim();
  if (!trimmed.startsWith(`${wrapper}<`)) return null;
  const open = trimmed.indexOf('<');
  const close = scanBalanced(trimmed, open, '<', '>');
  if (close === -1) return null;
  return trimmed.slice(open + 1, close).trim();
}

function rustShape(returnType, rustStructs) {
  let inner = resultInner(returnType).replace(/\s+/g, ' ');
  const optionInner = unwrapType(inner, 'Option');
  if (optionInner) inner = optionInner;
  const vecInner = unwrapType(inner, 'Vec');
  if (inner === '()') return { kind: 'void' };
  if (inner === 'bool') return { kind: 'boolean' };
  if (inner === 'String' || inner === '&str') return { kind: 'string' };
  if (/^(u|i|f)(8|16|32|64|size)\b/.test(inner)) return { kind: 'number' };
  if (vecInner) {
    const fields = rustStructs.get(vecInner)?.fields ?? null;
    return { kind: 'array', element: vecInner, fields };
  }
  return { kind: 'object', type: inner, fields: rustStructs.get(inner)?.fields ?? null };
}

function parseInlineTsFields(type) {
  const trimmed = type.trim();
  if (!trimmed.startsWith('{')) return null;
  const close = scanBalanced(trimmed, 0, '{', '}');
  if (close === -1) return null;
  const body = trimmed.slice(1, close);
  const fields = new Set();
  for (const part of splitTopLevel(body, ';').flatMap((p) => p.split(','))) {
    const m = /^\s*([A-Za-z_$][\w$-]*)(?:\?)?\s*:/.exec(part);
    if (m) fields.add(m[1]);
  }
  return { fields, allowExtra: /\[\s*key\s*:\s*string\s*\]/.test(body) };
}

function tsShape(generic, tsTypes) {
  if (!generic) return { kind: 'unknown' };
  const type = generic.trim().replace(/\s+/g, ' ');
  if (type === 'void') return { kind: 'void' };
  if (type === 'boolean') return { kind: 'boolean' };
  if (type === 'string') return { kind: 'string' };
  if (type === 'number') return { kind: 'number' };
  const arrayMatch = /^([A-Za-z_$][\w$]*)\[\]$/.exec(type);
  if (arrayMatch) {
    const info = tsTypes.get(arrayMatch[1]);
    return { kind: 'array', element: arrayMatch[1], fields: info?.fields ?? null, allowExtra: info?.allowExtra ?? false };
  }
  const inline = parseInlineTsFields(type);
  if (inline) return { kind: 'object', fields: inline.fields, allowExtra: inline.allowExtra };
  const named = /^([A-Za-z_$][\w$]*)$/.exec(type);
  if (named) {
    const info = tsTypes.get(named[1]);
    return { kind: 'object', type: named[1], fields: info?.fields ?? null, allowExtra: info?.allowExtra ?? false };
  }
  return { kind: 'object', type };
}

function compatibleReturn(ts, rust) {
  if (ts.kind === 'unknown') return { ok: true };
  if (ts.kind !== rust.kind) return { ok: false, reason: `TS expects ${ts.kind}, Rust returns ${rust.kind}` };
  if ((ts.kind === 'object' || ts.kind === 'array') && ts.fields && rust.fields) {
    const missing = [...rust.fields].filter((field) => !ts.fields.has(field));
    const extra = [...ts.fields].filter((field) => !rust.fields.has(field));
    if (missing.length > 0 && !ts.allowExtra) return { ok: false, reason: `TS type is missing Rust field(s): ${missing.join(', ')}` };
    if (extra.length > 0 && !ts.allowExtra) return { ok: false, reason: `TS type has field(s) Rust does not return: ${extra.join(', ')}` };
  }
  return { ok: true };
}

function main() {
  const tsFiles = walk(path.join(REPO_ROOT, 'src'), (file) =>
    /\.(ts|tsx)$/.test(file) && !/\.(test|spec)\./.test(file)
  );
  const rustFiles = walk(path.join(REPO_ROOT, 'src-tauri/src/commands'), (file) => file.endsWith('.rs'));

  const tsCalls = tsFiles.flatMap(invokeCallsFromFile);
  const tsTypes = parseTsTypes(tsFiles);
  const rustCommands = parseRustCommands(rustFiles);
  const rustStructs = parseRustStructs(rustFiles);
  const { names: registered, manifestCommandCount } = parseGenerateHandlerNames();
  const errors = [];
  const warnings = [];

  for (const [name, command] of rustCommands) {
    if (!startsWithTargetPrefix(name)) continue;
    if (!registered.has(name)) errors.push(`${name}: Rust command exists in ${command.file} but is missing from generate_handler`);
  }
  for (const name of registered) {
    if (!rustCommands.has(name)) errors.push(`${name}: generate_handler registers a command no #[tauri::command] function was found for`);
  }

  for (const call of tsCalls) {
    const command = rustCommands.get(call.name);
    if (!command) {
      errors.push(`${call.name}: TS invokes this in ${call.file}, but no Rust #[tauri::command] exists`);
      continue;
    }
    if (!registered.has(call.name)) {
      errors.push(`${call.name}: TS invokes this in ${call.file}, but it is not registered in generate_handler`);
    }
    const allowed = new Set(command.params.map((p) => p.tsName));
    const required = command.params.filter((p) => !p.optional).map((p) => p.tsName);
    if (call.argsVerifiable) {
      call.argVariants.forEach((keys, index) => {
        const unknown = [...keys].filter((key) => !allowed.has(key));
        const missing = required.filter((key) => !keys.has(key));
        const suffix = call.argVariants.length > 1 ? ` variant ${index + 1}` : '';
        if (unknown.length > 0) {
          errors.push(`${call.name}${suffix}: ${call.file} sends unknown arg(s): ${unknown.join(', ')}; Rust accepts ${[...allowed].join(', ') || '(none)'}`);
        }
        if (missing.length > 0) {
          errors.push(`${call.name}${suffix}: ${call.file} is missing required arg(s): ${missing.join(', ')}`);
        }
      });
    }
    const result = compatibleReturn(tsShape(call.generic, tsTypes), rustShape(command.returnType, rustStructs));
    if (!result.ok) errors.push(`${call.name}: ${call.file} return mismatch: ${result.reason}`);
  }

  const invoked = new Set(tsCalls.map((call) => call.name));
  for (const name of [...registered].sort()) {
    if (!invoked.has(name)) warnings.push(`${name}: registered Rust command has no non-test TS invoke call yet`);
  }

  if (warnings.length > 0) {
    console.log('Tauri contract warnings:');
    for (const warning of warnings) console.log(`  - ${warning}`);
    console.log('');
  }

  if (errors.length > 0) {
    console.error('Tauri contract check failed:');
    for (const error of errors) console.error(`  - ${error}`);
    process.exit(1);
  }

  console.log(
    `Tauri contract check passed: ${tsCalls.length} TS invokes, ${registered.size} target registered Rust commands checked (${manifestCommandCount} total manifest commands).`,
  );
}

main();
