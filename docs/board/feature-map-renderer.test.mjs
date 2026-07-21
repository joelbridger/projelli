import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, 'feature-map.html'), 'utf8');
const controlPath = '/home/jameson/lantern/coordination/control/generated/feature-map-data.json';
const accepted = JSON.parse(fs.readFileSync(controlPath, 'utf8'));
const page = source.replace(/<script>\/\* panzoom[\s\S]*?<\/script>/, `<script>
window.panzoom=function(){var transform={x:0,y:0,scale:1};return {getTransform:function(){return transform;},zoomAbs:function(x,y,scale){transform.scale=scale;},moveTo:function(x,y){transform.x=x;transform.y=y;},on:function(){}};};
</script>`);
const publisher = '/home/jameson/lantern/coordination/coordinator/tools/publish-control-views.py';
const parserProgram = `import importlib.util,sys
spec=importlib.util.spec_from_file_location('publisher',${JSON.stringify(publisher)})
module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
module.parse_marker(sys.stdin.buffer.read())`;

async function render(data, comments = []) {
  const requests = [];
  const dom = new JSDOM(page, {
    runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://lantern.test/feature-map.html',
    beforeParse(window) {
      window.fetch = async (url, options = {}) => {
        requests.push({ url: String(url), options });
        if (String(url) === 'feature-map-data.json') return { ok: true, json: async () => data };
        if (String(url) === '/api/feature-map/comments' && (!options.method || options.method === 'GET')) return { ok: true, json: async () => comments };
        if (String(url) === '/api/feature-map/comments' && options.method === 'POST') return { ok: true, json: async () => ({ id: 'new-comment', x: 12, y: 18, text: 'Saved note', author: 'Tester', ts: '2026-07-21T00:00:00Z' }) };
        return { ok: true, json: async () => ({}) };
      };
      window.confirm = () => true;
      window.alert = () => {};
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { dom, document: dom.window.document, requests };
}

function clone(value) { return structuredClone(value); }
function visibleFrom(data) { return data.stages.flatMap((stage) => stage.groups.flatMap((group) => group.features)).concat(data.foundation.features); }
function publisherAccepts(bytes) {
  return spawnSync('python3', ['-c', parserProgram], { input: bytes, encoding: 'utf8' }).status === 0;
}

assert.ok(publisherAccepts(source), 'the exact renderer document is accepted by the reviewed publisher');
for (const mutate of [
  (html) => `<!--leading-->${html}`,
  (html) => html.replace('<!DOCTYPE html>', '<!DOCTYPE html><?before-html?>'),
  (html) => html.replace('<!DOCTYPE html>', '<!DOCTYPE html><![CDATA[bad]]>'),
  (html) => html.replace('<!DOCTYPE html>', '<!DOCTYPE html>\0'),
  (html) => html.replace('<!DOCTYPE html>', '<!DOCTYPE html>&nbsp;'),
  (html) => html.replace('<!DOCTYPE html>', '<!DOCTYPE html foo>'),
  (html) => html.replace('<!DOCTYPE html>', '<!DOCTYPE html><!DOCTYPE html>'),
  (html) => html.replace('name="feature-map-renderer-version" content="four-label-v1"', 'name="feature-map-renderer-version" name="feature-map-renderer-version" content="four-label-v1"'),
  (html) => html.replace('name="feature-map-renderer-version" content="four-label-v1"', 'name="feature-map-renderer-version" content="four-label-v1" content="changed"'),
  (html) => html.replace('</head>', '<meta name="feature-map-renderer-version" content="four-label-v1"></head>'),
  (html) => `${html}</html>outside-body-text`,
  (html) => `${html}<trailing-fragment>`,
]) assert.equal(publisherAccepts(mutate(source)), false, 'unsafe renderer document shape is rejected');

const validControlData = clone(accepted);
const rendered = await render(validControlData, [{ id: 'kept-comment', x: 5, y: 8, text: 'Keep this comment', author: 'Reviewer', ts: '2026-07-21T00:00:00Z' }]);
const { document, dom, requests } = rendered;
const renderer = dom.window.FeatureMapRenderer;

assert.equal(renderer.version, 'four-label-v1');
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
const fourLabelRender = await render(fourLabels);
assert.deepEqual([...fourLabelRender.document.querySelectorAll('#counts .count')].map((chip) => chip.textContent.trim()), [
  '○ 75 Planned', '◐ 1 Being built', '◒ 1 Built — checking it', '✓ 1 Proven on Windows',
], 'all and only the four public labels render as count chips');

for (const mutate of [
  (data) => { delete data.input_hash; },
  (data) => { data.input_hash = ' '; },
  (data) => { data.extra = 'invented'; },
  (data) => { delete data.requirementUniverse; },
  (data) => { data.requirementUniverse.v1.pop(); },
  (data) => { data.requirementUniverse.v1[0].id = data.requirementUniverse.v1[1].id; },
  (data) => { data.requirementUniverse.v1[0].label = 'shipped'; },
  (data) => { data.requirementUniverse.outside_v1.push(clone(data.requirementUniverse.outside_v1[0])); },
  (data) => { data.stages[0].groups[0].features[1].id = data.stages[0].groups[0].features[0].id; },
  (data) => { data.stages[0].groups[0].features[0].requirementIds = ['SC-022', ' sc-022 ']; },
  (data) => { data.stages[0].groups[0].features[0].requirementIds = ['NO-001']; },
  (data) => { data.stages[0].groups[0].features[0].requirementIds = ['WB-145']; },
  (data) => { data.stages[0].groups[0].features[0].status = 'shipped'; },
  (data) => { data.nonV1Features[0].outsideV1Reason = ' '; },
]) {
  const invalid = clone(validControlData);
  mutate(invalid);
  assert.equal(renderer.validateMapData(invalid).ok, false, 'missing, malformed, duplicate, mismatched, or invented control data fails closed');
}
const rejected = clone(validControlData); delete rejected.requirementUniverse;
const failedRender = await render(rejected);
assert.equal(failedRender.document.querySelectorAll('.stagecard').length, 0, 'missing requirement universe prevents map rendering');
assert.match(failedRender.document.querySelector('.error').textContent, /top-level control fields/, 'missing contract data has a clear error');

assert.deepEqual({ ...renderer.countFeatures(visibleFrom(validControlData)) }, { planned: 78, 'being-built': 0, 'built-checking': 0, 'proven-windows': 0 });
console.log('feature-map renderer DOM tests passed: 69 journey cards, 9 foundation cards, 238 V1 requirements, and 21 outside-V1 requirements');
