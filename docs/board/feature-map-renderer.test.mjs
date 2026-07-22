import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { webcrypto } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, 'feature-map.html'), 'utf8');
const coordinationRoot = process.env.LANTERN_COORDINATION_ROOT || '/home/jameson/lantern/coordination';
const controlPath = path.join(coordinationRoot, 'control/generated/feature-map-data.json');
const vectorsPath = path.join(coordinationRoot, 'control/fixtures/payload-sha256-vectors.json');
const referencePath = path.join(coordinationRoot, 'coordinator/tools/verify-feature-map-payload.mjs');
const publisher = path.join(coordinationRoot, 'coordinator/tools/publish-control-views.py');
for (const requiredPath of [controlPath, vectorsPath, referencePath, publisher]) {
  if (!fs.existsSync(requiredPath)) throw new Error(`LANTERN_COORDINATION_ROOT is missing required file: ${requiredPath}`);
}
const accepted = JSON.parse(fs.readFileSync(controlPath, 'utf8'));
const acceptedRaw = fs.readFileSync(controlPath, 'utf8');
const vectors = JSON.parse(fs.readFileSync(vectorsPath, 'utf8'));
const reference = await import(`${pathToFileURL(referencePath).href}?renderer-test=${Date.now()}`);
const page = source.replace(/<script>\/\* panzoom[\s\S]*?<\/script>/, `<script>
window.panzoom=function(){var transform={x:0,y:0,scale:1};return {getTransform:function(){return transform;},zoomAbs:function(x,y,scale){transform.scale=scale;},moveTo:function(x,y){transform.x=x;transform.y=y;},on:function(){}};};
</script>`);
const parserProgram = `import importlib.util,sys
spec=importlib.util.spec_from_file_location('publisher',${JSON.stringify(publisher)})
module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
module.parse_marker(sys.stdin.buffer.read())`;

async function render(raw = acceptedRaw, comments = [], options = {}) {
  const requests = [];
  const dom = new JSDOM(page, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://lantern.test/feature-map.html',
    beforeParse(window) {
      window.fetch = async (url, fetchOptions = {}) => {
        requests.push({ url: String(url), options: fetchOptions });
        if (String(url) === 'feature-map-data.json') {
          if (options.networkError) throw new Error('network unavailable');
          if (options.dataPromise) return options.dataPromise;
          return { ok: options.ok !== false, text: async () => raw };
        }
        if (String(url) === '/api/feature-map/comments' && (!fetchOptions.method || fetchOptions.method === 'GET')) return { ok: true, json: async () => comments };
        if (String(url) === '/api/feature-map/comments' && fetchOptions.method === 'POST') return { ok: true, json: async () => ({ id: 'new-comment', x: 12, y: 18, text: 'Saved note', author: 'Tester', ts: '2026-07-21T00:00:00Z' }) };
        return { ok: true, json: async () => ({}) };
      };
      window.confirm = () => true;
      window.alert = () => {};
      Object.defineProperty(window, 'crypto', { configurable: true, value: options.crypto === undefined ? webcrypto : options.crypto });
    },
  });
  const result = { dom, document: dom.window.document, requests };
  if (options.waitFor !== false) await waitForRendererState(result, options.expectState || 'success', options.label || 'renderer');
  return result;
}

function clone(value) { return structuredClone(value); }
function visibleFrom(data) { return data.stages.flatMap((stage) => stage.groups.flatMap((group) => group.features)).concat(data.foundation.features); }
function publisherAccepts(bytes) {
  return spawnSync('python3', ['-c', parserProgram], { input: bytes, encoding: 'utf8' }).status === 0;
}
function raw(value) { return JSON.stringify(value); }
function renderCounts(document) {
  return [document.querySelectorAll('li.feat').length, document.querySelectorAll('.foundation li').length, document.querySelectorAll('#nonv1').length];
}
function rendererState(result) {
  const controls = [...result.document.querySelectorAll('#layers button,#styles button,#statusfilters button,#zin,#zout,#zfit,#cmode')];
  const cards = renderCounts(result.document);
  const commentRequests = result.requests.filter((request) => request.url.includes('/api/feature-map/comments')).length;
  if (result.document.querySelector('.error')) return { state: 'error', cards, controlsEnabled: controls.every((button) => !button.disabled), commentRequests };
  if (cards[0] === 69 && controls.length > 0 && controls.every((button) => !button.disabled) && commentRequests > 0) return { state: 'success', cards, controlsEnabled: true, commentRequests };
  return { state: 'pending', cards, controlsEnabled: controls.every((button) => !button.disabled), commentRequests };
}
async function waitForRendererState(result, expected, label) {
  const deadline = Date.now() + 2_000;
  for (;;) {
    const current = rendererState(result);
    if (current.state === expected) return current;
    if (current.state !== 'pending') throw new Error(`${label}: expected ${expected} renderer state, got ${current.state} (${JSON.stringify(current)})`);
    if (Date.now() >= deadline) throw new Error(`${label}: timed out waiting for ${expected} renderer state (${JSON.stringify(current)})`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
function assertRejected(result, message) {
  assert.deepEqual(renderCounts(result.document), [0, 0, 0], `${message}: no journey, foundation, or outside-V1 cards render`);
  assert.equal(result.document.querySelectorAll('.error').length, 1, `${message}: one visible error renders`);
  assert.equal(result.requests.filter((request) => request.url.includes('/api/feature-map/comments')).length, 0, `${message}: no comment request occurs`);
  assert.ok([...result.document.querySelectorAll('#layers button,#styles button,#statusfilters button,#zin,#zout,#zfit,#cmode')].every((button) => button.disabled), `${message}: every map control stays inert`);
}

assert.ok(publisherAccepts(source), 'the exact renderer document is accepted by the reviewed publisher');
for (const [i, mutate] of [
  (html) => `<!--leading-->${html}`,
  (html) => html.replace('<!DOCTYPE html>', '<!DOCTYPE html><?before-html?>'),
  (html) => html.replace('<!DOCTYPE html>', '<!DOCTYPE html><![CDATA[bad]]>'),
  (html) => html.replace('<!DOCTYPE html>', '<!DOCTYPE html>\0'),
  (html) => html.replace('<!DOCTYPE html>', '<!DOCTYPE html>&nbsp;'),
  (html) => html.replace('<!DOCTYPE html>', '<!DOCTYPE html foo>'),
  (html) => html.replace('<!DOCTYPE html>', '<!DOCTYPE html><!DOCTYPE html>'),
  (html) => html.replace('<html lang="en">', '<html lang="en"><!--outside-head-->'),
  (html) => html.replace('</head>', '</head><!--outside-body-->'),
  (html) => html.replace('</head>', '</head><?outside-body?>'),
  (html) => html.replace('</body>', '</body><!--after-body-->'),
  (html) => html.replace('<html lang="en">', '<html lang="en"><?outside-head?>'),
  (html) => html.replace('</body>', '</body><?after-body?>'),
  (html) => html.replace('<html lang="en">', '<html lang="en"><![CDATA[outside-head]]>'),
  (html) => html.replace('</head>', '</head><![CDATA[outside-body]]>'),
  (html) => html.replace('</body>', '</body><![CDATA[after-body]]>'),
  (html) => html.replace('name="feature-map-renderer-version" content="four-label-v1"', 'name="feature-map-renderer-version" name="feature-map-renderer-version" content="four-label-v1"'),
  (html) => html.replace('name="feature-map-renderer-version" content="four-label-v1"', 'name="feature-map-renderer-version" content="four-label-v1" content="changed"'),
  (html) => html.replace('</head>', '<meta name="feature-map-renderer-version" content="four-label-v1"></head>'),
  (html) => `${html}</html>outside-body-text`,
  (html) => `${html}<trailing-fragment>`,
].entries()) assert.equal(publisherAccepts(mutate(source)), false, 'unsafe renderer document shape is rejected at probe '+i);

const validControlData = clone(accepted);
const rendered = await render(acceptedRaw, [{ id: 'kept-comment', x: 5, y: 8, text: 'Keep this comment', author: 'Reviewer', ts: '2026-07-21T00:00:00Z' }]);
const { document, dom, requests } = rendered;
const renderer = dom.window.FeatureMapRenderer;

assert.equal(renderer.version, 'four-label-v1');
let releaseDelayedPayload;
const delayedPayload = new Promise((resolve) => { releaseDelayedPayload = resolve; });
const delayed = await render(acceptedRaw, [], { dataPromise: delayedPayload, waitFor: false });
const delayedBefore = {
  hash: delayed.dom.window.location.hash,
  body: delayed.document.body.className,
  layer: delayed.document.querySelector('[data-l="vision"]').className,
  filter: delayed.document.querySelector('[data-f="planned"]').getAttribute('aria-pressed'),
  cards: renderCounts(delayed.document),
};
for (const control of delayed.document.querySelectorAll('#layers button,#styles button,#statusfilters button,#zin,#zout,#zfit,#cmode')) control.click();
const delayedAfter = {
  hash: delayed.dom.window.location.hash,
  body: delayed.document.body.className,
  layer: delayed.document.querySelector('[data-l="vision"]').className,
  filter: delayed.document.querySelector('[data-f="planned"]').getAttribute('aria-pressed'),
  cards: renderCounts(delayed.document),
};
assert.deepEqual(delayedAfter, delayedBefore, 'a delayed payload keeps hash, body state, selected controls, and cards unchanged');
assert.equal(delayed.requests.filter((request) => request.url.includes('/api/feature-map/comments')).length, 0, 'a delayed payload makes no comment request');
assert.ok([...delayed.document.querySelectorAll('#layers button,#styles button,#statusfilters button,#zin,#zout,#zfit,#cmode')].every((button) => button.disabled), 'a delayed payload keeps every map control disabled');
releaseDelayedPayload({ ok: true, text: async () => acceptedRaw });
await waitForRendererState(delayed, 'success', 'delayed valid payload');
assert.equal(delayed.document.querySelectorAll('.error').length, 0, 'the delayed valid payload can still finish normally');
delayed.dom.window.close();

for (const vector of vectors.vectors) {
  assert.equal(renderer.canonicalizePayload(renderer.parseStrictJson(JSON.stringify(vector.value))), vector.canonical, `${vector.name}: inline canonical form matches the shared vector`);
  assert.equal(await renderer.sha256Hex(vector.canonical), vector.sha256, `${vector.name}: inline digest matches the shared vector`);
  assert.equal(reference.canonicalizePayload(vector.value), vector.canonical, `${vector.name}: reference canonical form matches the shared vector`);
  assert.equal(await reference.sha256Hex(vector.canonical), vector.sha256, `${vector.name}: reference digest matches the shared vector`);
}
for (const vector of vectors.invalid_numeric_vectors) {
  assert.throws(() => renderer.parseStrictJson(vector.raw), undefined, `${vector.name}: inline parser rejects unsafe number spelling`);
  assert.throws(() => reference.parseStrictJson(vector.raw), undefined, `${vector.name}: reference parser rejects unsafe number spelling`);
}
assert.equal(renderer.canonicalizePayload(renderer.parseStrictJson('{"2":"two","10":"ten","01":"leading"}')), '{"01":"leading","10":"ten","2":"two"}', 'numeric-looking keys use scalar order, not JavaScript property order');
assert.throws(() => renderer.parseStrictJson('{"nested":{"id":1,"id":2}}'), /duplicate JSON object key/, 'duplicate keys are rejected before JSON.parse could erase them');

// These are JSON bytes with one backslash before each "u", not JavaScript strings
// containing two literal backslashes. Keep the byte proof beside the parser proof.
const pairedSurrogate = '{"text":"\\ud83d\\ude00"}';
const unpairedHighSurrogate = '{"text":"\\ud800"}';
const unpairedLowSurrogate = '{"text":"\\udc00"}';
assert.equal(Buffer.from(pairedSurrogate, 'utf8').toString('hex'), '7b2274657874223a225c75643833645c7564653030227d', 'paired-surrogate input supplies real JSON Unicode escapes');
assert.equal(Buffer.from(unpairedHighSurrogate, 'utf8').toString('hex'), '7b2274657874223a225c7564383030227d', 'unpaired-high input supplies a real JSON Unicode escape');
assert.equal(Buffer.from(unpairedLowSurrogate, 'utf8').toString('hex'), '7b2274657874223a225c7564633030227d', 'unpaired-low input supplies a real JSON Unicode escape');
const intendedScalar = String.fromCodePoint(0x1f600);
assert.equal(renderer.parseStrictJson(pairedSurrogate).text, intendedScalar, 'inline parser accepts a paired surrogate escape as its scalar value');
assert.equal(reference.parseStrictJson(pairedSurrogate).text, intendedScalar, 'reference parser accepts a paired surrogate escape as its scalar value');
for (const [name, rawSurrogate] of [
  ['unpaired high surrogate', unpairedHighSurrogate],
  ['unpaired low surrogate', unpairedLowSurrogate],
]) {
  assert.throws(() => renderer.parseStrictJson(rawSurrogate), /unpaired surrogate/, `inline parser rejects ${name} for the surrogate reason`);
  assert.throws(() => reference.parseStrictJson(rawSurrogate), /unpaired surrogate/, `reference parser rejects ${name} for the surrogate reason`);
}

const acceptedVerdict = renderer.validateMapData(validControlData);
assert.equal(acceptedVerdict.ok, true, acceptedVerdict.error || 'the accepted control contract is valid');
assert.equal(document.querySelectorAll('.stagecard').length, 7, 'all journey stories render');
assert.equal(document.querySelectorAll('.stagecard .picto').length, 7, 'journey icons render');
assert.ok(document.querySelectorAll('#arrows path').length >= 7, 'journey arrows render');
assert.equal(document.querySelectorAll('li.feat').length, 69, 'renders exactly 69 journey cards');
assert.equal(document.querySelectorAll('.foundation li').length, 9, 'renders exactly 9 foundation cards');
assert.equal(document.querySelectorAll('#nonv1').length, 1, 'the one separate outside-V1 feature-map item renders');
assert.match(document.querySelector('#nonv1').textContent, /Outside the accepted V1 feature set\./, 'outside-V1 feature wording does not borrow status notes');
assert.equal(document.querySelector('#updated').dataset.inputHash, validControlData.input_hash, 'the full control-derived hash remains in the stable DOM marker');
assert.match(document.querySelector('#updated').textContent, new RegExp(`input ${validControlData.input_hash.slice(0, 12)}\\.\\.\\.`), 'the visible hash derives from control data');
assert.ok(document.querySelector('.cnote')?.textContent.includes('Keep this comment'), 'existing comments still render');

const universe = validControlData.requirementUniverse;
assert.equal(universe.v1.length, 238, 'the separate V1 requirement universe has 238 rows');
assert.equal(universe.v1.filter((row) => row.id.startsWith('WB-')).length, 151, 'the V1 universe has 151 Wealthbox rows');
assert.equal(universe.v1.filter((row) => row.id.startsWith('JP-')).length, 63, 'the V1 universe has 63 Jump rows');
assert.equal(universe.v1.filter((row) => row.id.startsWith('SC-')).length, 24, 'the V1 universe has 24 shared rows');
assert.equal(universe.outside_v1.length, 21, 'the 21 outside-V1 requirement rows stay outside the V1 total');
assert.equal(document.querySelector('#updated').dataset.requirementV1Count, '238', 'the DOM retains the separate V1 requirement total');
assert.equal(document.querySelector('#updated').dataset.requirementOutsideV1Count, '21', 'the DOM retains the separate outside-V1 requirement total');
assert.equal(document.querySelector('#updated').dataset.requirementSourceSplit, 'Wealthbox 151, Jump 63, shared 24', 'the DOM retains the exact source split');

const planned = document.querySelector('[data-f="planned"]');
assert.equal(planned.getAttribute('aria-pressed'), 'false');
planned.click();
assert.equal(planned.getAttribute('aria-pressed'), 'true', 'filter click exposes selected state');
assert.equal(document.querySelector('[data-f="all"]').getAttribute('aria-pressed'), 'false');
assert.ok(document.body.classList.contains('f-planned'), 'filter click changes rendered map state');
planned.focus();
planned.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
assert.equal(document.activeElement, planned, 'native button remains keyboard focusable');
document.querySelector('[data-l="vision"]').click();
assert.equal(document.querySelector('[data-f="all"]').getAttribute('aria-pressed'), 'true', 'layer change resets filter accessibility state');
assert.equal(planned.getAttribute('aria-pressed'), 'false');

document.querySelector('#cmode').click();
const viewport = document.querySelector('#viewport');
viewport.dispatchEvent(new dom.window.PointerEvent('pointerdown', { bubbles: true, clientX: 30, clientY: 30 }));
viewport.dispatchEvent(new dom.window.PointerEvent('pointerup', { bubbles: true, clientX: 30, clientY: 30 }));
const composer = document.querySelector('.composer');
assert.ok(composer, 'comment composer still opens from the map');
composer.querySelector('textarea').value = 'Saved note';
composer.querySelector('.cname').value = 'Tester';
composer.querySelector('.csave').click();
await new Promise((resolve) => setTimeout(resolve, 0));
assert.ok(requests.some((request) => request.options.method === 'POST' && String(request.options.body).includes('Saved note')), 'comment save still posts its text');
assert.ok(document.querySelectorAll('.cnote').length >= 2, 'saved comment stays visible');

const fourLabels = clone(validControlData);
visibleFrom(fourLabels).slice(0, 4).forEach((feature, index) => { feature.status = ['Planned', 'Being built', 'Built — checking it', 'Proven on Windows'][index]; });
fourLabels.payload_sha256 = await reference.sha256Hex(reference.canonicalizePayload(fourLabels));
assert.equal(await renderer.sha256Hex(renderer.canonicalizePayload(renderer.parseStrictJson(raw(fourLabels)))), fourLabels.payload_sha256, 'the inline verifier agrees with the reference digest for the four-label fixture');
const fourLabelRender = await render(raw(fourLabels));
assert.deepEqual([...fourLabelRender.document.querySelectorAll('#counts .count')].map((chip) => chip.textContent.trim()), [
  '○ 75 Planned', '◐ 1 Being built', '◒ 1 Built — checking it', '✓ 1 Proven on Windows',
], 'all and only the four public labels render as count chips: '+(fourLabelRender.document.querySelector('.error')?.textContent||'no error'));

const failureCases = [
  ['duplicate top key', acceptedRaw.replace('"updated":', '"updated":"duplicate","updated":'), {}],
  ['duplicate nested key', '{"outer":{"x":1,"x":2}}', {}],
  ['duplicate array-object key', '[{"x":1,"x":2}]', {}],
  ['even escape parity', '{"text":"\\\\\\\\","payload_sha256":"x"}', {}],
  ['odd escape parity', '{"text":"\\\\\\"}', {}],
  ['prefix bytes', 'prefix'+acceptedRaw, {}],
  ['trailing bytes', acceptedRaw+' trailing', {}],
  ['two JSON values', acceptedRaw+' {}', {}],
  ['malformed array', '[1,]', {}],
  ['malformed object', '{"x":}', {}],
  ['missing digest', raw(Object.fromEntries(Object.entries(validControlData).filter(([key]) => key !== 'payload_sha256'))), {}],
  ['bad digest', raw({ ...validControlData, payload_sha256: '0'.repeat(64) }), {}],
  ['extra field', raw({ ...validControlData, invented: true }), {}],
  ['network error', acceptedRaw, { networkError: true }],
  ['HTTP failure', acceptedRaw, { ok: false }],
  ['WebCrypto unavailable', acceptedRaw, { crypto: {} }],
  ['WebCrypto rejects', acceptedRaw, { crypto: { subtle: { digest: async () => { throw new Error('digest unavailable'); } } } }],
];
for (const vector of vectors.invalid_numeric_vectors) failureCases.push([vector.name, vector.raw, {}]);
for (const [name, body, options] of failureCases) assertRejected(await render(body, [], { ...options, expectState: 'error', label: name }), name);

for (const [name, mutate] of [
  ['input hash', (data) => { data.input_hash = '0'.repeat(64); }],
  ['top-level truth', (data) => { data.updated = 'changed'; }],
  ['journey truth', (data) => { data.stages[0].groups[0].features[0].name = 'changed'; }],
  ['journey layout', (data) => { data.stages[0].num = 99; }],
  ['journey link', (data) => { data.stages[0].groups[0].features[0].requirementIds = ['WB-145']; }],
  ['foundation truth', (data) => { data.foundation.features[0].name = 'changed'; }],
  ['outside-V1 truth', (data) => { data.nonV1Features[0].outsideV1Reason = 'changed'; }],
  ['requirement truth', (data) => { data.requirementUniverse.v1[0].label = 'Being built'; }],
  ['requirement order', (data) => { data.requirementUniverse.v1.reverse(); }],
  ['stage order', (data) => { data.stages.reverse(); }],
]) {
  const changed = clone(validControlData); mutate(changed);
  assertRejected(await render(raw(changed), [], { expectState: 'error', label: 'digest mismatch after '+name+' mutation' }), 'digest mismatch after '+name+' mutation');
}

assert.deepEqual({ ...renderer.countFeatures(visibleFrom(validControlData)) }, { planned: 78, 'being-built': 0, 'built-checking': 0, 'proven-windows': 0 });
console.log('feature-map renderer DOM tests passed: 69 journey cards, 9 foundation cards, 238 V1 requirements, and 21 outside-V1 requirements');
