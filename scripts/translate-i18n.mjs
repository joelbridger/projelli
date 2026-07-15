#!/usr/bin/env node
// Hash-incremental LLM translation for the base and feature-owned locale shards.
//
// Per spec section 8.4 + Stream E plan task 4.x. Reproducible by design:
// re-running with no English changes produces zero API calls and zero diff.
//
// Usage:
//   ANTHROPIC_API_KEY=sk-ant-... npm run translate-i18n
//
// Flags:
//   --dry-run         Walk every English catalog + report what would change, no API calls.
//   --max-tokens=N    Cost cap (default 5,000,000 tokens, ~$15 at Sonnet rates).
//                     Aborts BEFORE the first API call if estimate exceeds.
//   --batch-size=N    Keys per Anthropic request (default 50).
//   --locale=LANG     Restrict to one locale. Default: both es and de.
//   --model=ID        Override model ID. Default claude-sonnet-4-6.
//
// Output shape: each translated key carries a sibling `__sourceHash` key
// (SHA-256 of the English source string) at the same nesting level. The
// double-underscore separator is deliberate: it survives the nested-JSON
// shape that i18next consumes and never collides with a real translation
// key (kebab-case forbids underscores). Re-runs only translate keys whose
// hash changed. Keys with `__locked: true` are skipped (E5 review pass).

import Anthropic from '@anthropic-ai/sdk';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const ROOT = join(dirname(__filename), '..');
const LOCALES_DIR = join(ROOT, 'src/locales');
const FEATURES_DIR = join(ROOT, 'src/features');

const DEFAULT_MAX_TOKENS = 5_000_000;
const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_MODEL = 'claude-sonnet-4-6';

// Sonnet rates as of cutoff: $3/MTok input, $15/MTok output.
const SONNET_INPUT_RATE = 3 / 1_000_000;
const SONNET_OUTPUT_RATE = 15 / 1_000_000;

const LOCALE_LABELS = {
  es: 'Spanish (es-ES)',
  de: 'German (de-DE)',
};

function parseFlags(argv) {
  const flags = {
    dryRun: false,
    maxTokens: DEFAULT_MAX_TOKENS,
    batchSize: DEFAULT_BATCH_SIZE,
    locales: ['es', 'de'],
    model: DEFAULT_MODEL,
  };
  for (const arg of argv) {
    if (arg === '--dry-run') flags.dryRun = true;
    else if (arg.startsWith('--max-tokens=')) flags.maxTokens = parseInt(arg.split('=')[1], 10);
    else if (arg.startsWith('--batch-size=')) flags.batchSize = parseInt(arg.split('=')[1], 10);
    else if (arg.startsWith('--locale=')) flags.locales = [arg.split('=')[1]];
    else if (arg.startsWith('--model=')) flags.model = arg.split('=')[1];
  }
  return flags;
}

function sha256(s) {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

// Flatten nested JSON to dotted-key map: {a: {b: 'c'}} -> {'a.b': 'c'}
function flatten(obj, prefix = '') {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      Object.assign(out, flatten(v, key));
    } else {
      out[key] = v;
    }
  }
  return out;
}

// Inverse: nest a dotted-key map back into the JSON tree shape.
function unflatten(map) {
  const out = {};
  for (const [k, v] of Object.entries(map)) {
    const parts = k.split('.');
    let cursor = out;
    for (let i = 0; i < parts.length - 1; i++) {
      const seg = parts[i];
      if (cursor[seg] === undefined || typeof cursor[seg] !== 'object') {
        cursor[seg] = {};
      }
      cursor = cursor[seg];
    }
    cursor[parts[parts.length - 1]] = v;
  }
  return out;
}

function readJson(path) {
  if (!existsSync(path)) return {};
  const raw = readFileSync(path, 'utf8').trim();
  if (!raw) return {};
  return JSON.parse(raw);
}

function writeJson(path, obj) {
  writeFileSync(path, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

/**
 * Returns the base catalog followed by feature-owned locale shards in a
 * stable path order. A shard is registered simply by living beside a feature.
 */
function discoverEnglishCatalogPaths() {
  const paths = [join(LOCALES_DIR, 'en.json')];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = join(directory, entry.name);
      if (entry.isDirectory()) walk(entryPath);
      else if (entry.isFile() && entry.name === 'en.json' && entryPath.includes('/locales/')) {
        paths.push(entryPath);
      }
    }
  };
  walk(FEATURES_DIR);
  return [paths[0], ...paths.slice(1).sort()];
}

function localePathFor(englishPath, locale) {
  return englishPath.replace(/\/en\.json$/, `/${locale}.json`);
}

// In the existing locale, look up the translated value alongside its
// metadata siblings. Metadata is stored at the SAME nesting level as the
// translation, with double-underscore-prefixed keys: `<leaf>__sourceHash`
// and `<leaf>__locked`. Example:
//   {settings: {title: 'Ajustes', title__sourceHash: 'abc', title__locked: true}}
function existingMeta(flatExisting, key) {
  // key is dotted, e.g. 'settings.title'. Metadata sibling is 'settings.title__sourceHash'.
  return {
    value: flatExisting[key],
    sourceHash: flatExisting[`${key}__sourceHash`],
    locked: flatExisting[`${key}__locked`] === true,
  };
}

function pickMissing(en, existing) {
  const flatEn = flatten(en);
  const flatExisting = flatten(existing);
  const missing = [];
  const carryOver = {};
  for (const [key, val] of Object.entries(flatEn)) {
    if (typeof val !== 'string') continue;
    const meta = existingMeta(flatExisting, key);
    if (meta.locked) {
      // Preserve locked entry verbatim.
      carryOver[key] = meta.value;
      carryOver[`${key}__sourceHash`] = meta.sourceHash ?? sha256(val);
      carryOver[`${key}__locked`] = true;
      continue;
    }
    const enHash = sha256(val);
    if (meta.value !== undefined && meta.sourceHash === enHash) {
      // Up-to-date translation, no work.
      carryOver[key] = meta.value;
      carryOver[`${key}__sourceHash`] = enHash;
      continue;
    }
    missing.push([key, val]);
  }
  return { missing, carryOver };
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Rough token estimate: ~4 chars per token. Used purely for the cost cap;
// real billing comes from the API response.
function estimateTokens(s) {
  return Math.ceil(s.length / 4);
}

function buildSystemPrompt(targetLang) {
  return `You are translating UI strings for Keepance, a desktop AI workspace app.
Target language: ${LOCALE_LABELS[targetLang]}.

Rules:
- Translate the value for each key. Output only the translation, never the key.
- Preserve interpolation tokens like {{count}}, {{name}}, {{path}} EXACTLY as written.
- Preserve <Trans> component markers like <s>, <c>, <a>, <k>, <br/> EXACTLY as written.
- Keep punctuation style of the target language.
- Match the tone of a productivity app: clear, concise, professional but warm.
- Short labels (buttons, menu items) must stay concise; longer descriptions can breathe.
- Do NOT translate brand names: "Keepance", "Claude", "OpenAI", "Anthropic", "Markdown", "GitHub".
- Do NOT add em dashes (—). Use commas or restructure if needed.

CRITICAL JSON OUTPUT RULES:
- Output strict JSON: an object mapping each input key to its translation.
- No prose. No code fences. No markdown.
- Inside string values, do NOT use German typographic quotes („ ") or French guillemets (« »). Use straight ASCII quotes only, escaped as \\" if needed inside the value.
- If your translation needs to quote something, use single quotes (') or paraphrase to avoid quotes entirely.
- Every property value must be a valid JSON string. Validate mentally before emitting.`;
}

function buildUserPrompt(batch) {
  const payload = Object.fromEntries(batch);
  return `Translate the value of each key in this JSON object. Return JSON of the same shape with translated values:\n\n${JSON.stringify(payload, null, 2)}`;
}

// Best-effort JSON extraction. If the model wraps output in a fence or adds
// preamble despite the system prompt, recover the JSON object. As a last
// resort, normalize Unicode "smart" quotes that some target languages
// produce inside string values, where they collide with the JSON `"`
// terminator.
function extractJson(text) {
  const trimmed = text.trim();
  // Strip ``` fences.
  const fence = trimmed.match(/^```(?:json)?\n([\s\S]*?)\n```$/);
  const body = fence ? fence[1] : trimmed;
  const first = body.indexOf('{');
  const last = body.lastIndexOf('}');
  if (first === -1 || last === -1 || last < first) {
    throw new Error(`No JSON object in model response: ${text.slice(0, 200)}`);
  }
  const slice = body.slice(first, last + 1);
  try {
    return JSON.parse(slice);
  } catch (firstErr) {
    // Fallback: replace common Unicode quote characters that the model may
    // emit inside German / Spanish / French strings. JSON only treats `"`
    // (U+0022) as a string terminator, so safely rewrite typographic ones.
    const sanitized = slice
      .replace(/[“”„‟]/g, "'") // " " „ ‟
      .replace(/[‘’‚‛]/g, "'") // ' ' ‚ ‛
      .replace(/[«»]/g, "'"); // « »
    try {
      return JSON.parse(sanitized);
    } catch {
      throw firstErr;
    }
  }
}

async function translateLocale(client, locale, en, existing, flags, costTracker) {
  const { missing, carryOver } = pickMissing(en, existing);
  console.log(`\n[${locale}] ${missing.length} key(s) need translation, ${Object.keys(carryOver).filter((k) => !k.includes('._')).length} carried over.`);

  if (missing.length === 0) {
    return unflatten(carryOver);
  }

  if (flags.dryRun) {
    console.log(`[${locale}] DRY RUN: would translate ${missing.length} keys in ${Math.ceil(missing.length / flags.batchSize)} batch(es).`);
    // Carry over only; missing keys remain untranslated in the file.
    return unflatten(carryOver);
  }

  const flatEn = flatten(en);
  const result = { ...carryOver };
  const batches = chunk(missing, flags.batchSize);

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const system = buildSystemPrompt(locale);
    const user = buildUserPrompt(batch);

    const estimateThis = estimateTokens(system) + estimateTokens(user) + estimateTokens(JSON.stringify(Object.fromEntries(batch)));
    if (costTracker.estimatedTokens + estimateThis > flags.maxTokens) {
      throw new Error(
        `Cost cap reached: estimated ${costTracker.estimatedTokens + estimateThis} tokens > ${flags.maxTokens} max. ` +
          `Use --max-tokens=N to raise the cap.`,
      );
    }

    process.stdout.write(`[${locale}] batch ${i + 1}/${batches.length} (${batch.length} keys)... `);

    // Retry up to 2x on transient parse failures (model occasionally emits
    // mismatched quotes or trailing commas in long JSON outputs).
    let translations;
    let lastErr;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await client.messages.create({
          model: flags.model,
          max_tokens: 8192,
          system,
          messages: [{ role: 'user', content: user }],
        });
        costTracker.estimatedTokens += estimateThis;
        costTracker.actualInputTokens += response.usage.input_tokens;
        costTracker.actualOutputTokens += response.usage.output_tokens;
        const textBlock = response.content.find((b) => b.type === 'text');
        if (!textBlock) throw new Error(`No text block in response for ${locale} batch ${i + 1}`);
        try {
          translations = extractJson(textBlock.text);
        } catch (parseErr) {
          parseErr._rawText = textBlock.text;
          throw parseErr;
        }
        break;
      } catch (err) {
        lastErr = err;
        process.stdout.write(`(retry ${attempt + 1}) `);
        if (process.env.DEBUG_TRANSLATE) {
          console.error('\n  err:', err?.message);
          if (err?._rawText) console.error('  raw:', err._rawText.slice(0, 1000));
        }
      }
    }
    if (!translations) {
      console.warn(`\n  WARN: batch ${i + 1} failed after 3 attempts (${lastErr?.message ?? lastErr}), skipping`);
      continue;
    }

    for (const [key] of batch) {
      if (translations[key] === undefined) {
        console.warn(`\n  WARN: model did not return key ${key}, leaving untranslated`);
        continue;
      }
      result[key] = translations[key];
      result[`${key}__sourceHash`] = sha256(flatEn[key]);
    }
    console.log('done');
  }

  return unflatten(result);
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  console.log('translate-i18n config:', {
    locales: flags.locales,
    model: flags.model,
    batchSize: flags.batchSize,
    maxTokens: flags.maxTokens,
    dryRun: flags.dryRun,
  });

  if (!process.env.ANTHROPIC_API_KEY && !flags.dryRun) {
    console.error('ERROR: ANTHROPIC_API_KEY not set. Run with --dry-run to preview, or set the env var.');
    process.exit(2);
  }

  const englishPaths = discoverEnglishCatalogPaths();
  const enKeyCount = englishPaths.reduce((count, path) => count + Object.keys(flatten(readJson(path))).length, 0);
  console.log(`Discovered ${englishPaths.length} English locale catalog(s) with ${enKeyCount} leaf keys.`);

  const client = new Anthropic();
  const costTracker = { estimatedTokens: 0, actualInputTokens: 0, actualOutputTokens: 0 };

  for (const englishPath of englishPaths) {
    const en = readJson(englishPath);
    for (const locale of flags.locales) {
      const path = localePathFor(englishPath, locale);
      const existing = readJson(path);
      const next = await translateLocale(client, locale, en, existing, flags, costTracker);
      if (!flags.dryRun) {
        writeJson(path, next);
        console.log(`[${locale}] wrote ${path}`);
      }
    }
  }

  const inCost = costTracker.actualInputTokens * SONNET_INPUT_RATE;
  const outCost = costTracker.actualOutputTokens * SONNET_OUTPUT_RATE;
  console.log('\nDone.');
  console.log(`Input tokens:  ${costTracker.actualInputTokens.toLocaleString()}  ($${inCost.toFixed(4)})`);
  console.log(`Output tokens: ${costTracker.actualOutputTokens.toLocaleString()}  ($${outCost.toFixed(4)})`);
  console.log(`Total cost:    $${(inCost + outCost).toFixed(4)}`);
}

// Allow import without execute for tests.
const isCli = process.argv[1] === __filename;
if (isCli) {
  main().catch((err) => {
    console.error('translate-i18n failed:', err.message ?? err);
    process.exit(1);
  });
}

// Exports for unit testing.
export {
  flatten,
  unflatten,
  pickMissing,
  sha256,
  buildSystemPrompt,
  buildUserPrompt,
  extractJson,
  estimateTokens,
  parseFlags,
  translateLocale,
  discoverEnglishCatalogPaths,
  localePathFor,
};
