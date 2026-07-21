import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, 'feature-map.html'), 'utf8');
const accepted = JSON.parse(fs.readFileSync('/home/jameson/lantern/coordination/control/generated/feature-map-data.json', 'utf8'));
const page = source.replace(/<script>\/\* panzoom[\s\S]*?<\/script>/, `<script>
window.panzoom=function(){var transform={x:0,y:0,scale:1};return {getTransform:function(){return transform;},zoomAbs:function(x,y,scale){transform.scale=scale;},moveTo:function(x,y){transform.x=x;transform.y=y;},on:function(){}};};
</script>`);

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

assert.equal(accepted.input_hash, '40848090b7b3d22e1bbe393f204c7240a9272d0e7fd463ab4bdecdab5d21513d');
const validControlData = clone(accepted);
for (const group of validControlData.stages.flatMap((stage) => stage.groups)) {
  // This fixture is deliberately supplied by the harness: the renderer never supplies labels itself.
  if (!group.visionLabel) group.visionLabel = 'Future vision label supplied by control data';
}
const rendered = await render(validControlData, [{ id: 'kept-comment', x: 5, y: 8, text: 'Keep this comment', author: 'Reviewer', ts: '2026-07-21T00:00:00Z' }]);
const { document, dom, requests } = rendered;
const renderer = dom.window.FeatureMapRenderer;

assert.equal(renderer.version, 'four-label-v1');
assert.equal(renderer.validateMapData(validControlData).ok, true, 'valid supplied control data is valid');
assert.equal(document.querySelectorAll('.stagecard').length, 7, 'all journey stories render');
assert.equal(document.querySelectorAll('.stagecard .picto').length, 7, 'journey icons render');
assert.ok(document.querySelectorAll('#arrows path').length >= 7, 'journey arrows render');
assert.equal(document.querySelectorAll('li.feat').length + document.querySelectorAll('.foundation li').length, 78, 'renders 69 journey and 9 foundation V1 cards');
assert.equal(document.querySelectorAll('#nonv1').length, 1, 'outside-V1 items render in their own collection');
assert.match(document.querySelector('#nonv1').textContent, /Outside the accepted V1 feature set\./, 'outside-V1 wording does not borrow status notes');
assert.equal(document.querySelector('#updated').dataset.inputHash, validControlData.input_hash, 'full exact input hash has a stable DOM marker');
assert.match(document.querySelector('#updated').textContent, /input 40848090b7b3\.\.\./, 'visible input hash uses the exact prefix');
assert.ok(document.querySelector('.cnote')?.textContent.includes('Keep this comment'), 'existing comments still render');

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
  (data) => { data.input_hash = 'not-a-hash'; },
  (data) => { data.stages[0].groups[0].label = ' '; },
  (data) => { delete data.stages[0].groups[0].visionLabel; },
  (data) => { data.stages[0].groups[0].features[1].id = data.stages[0].groups[0].features[0].id; },
  (data) => { data.stages[0].groups[0].features[0].requirementIds = ['SC-022', ' sc-022 ']; },
  (data) => { data.stages[0].groups[0].features[0].status = 'shipped'; },
  (data) => { data.nonV1Features[0].outsideV1Reason = ' '; },
]) {
  const invalid = clone(validControlData);
  mutate(invalid);
  assert.equal(renderer.validateMapData(invalid).ok, false, 'invalid control data fails closed');
}
const rejected = clone(validControlData); delete rejected.input_hash;
const failedRender = await render(rejected);
assert.equal(failedRender.document.querySelectorAll('.stagecard').length, 0, 'missing input_hash prevents map rendering');
assert.match(failedRender.document.querySelector('.error').textContent, /valid input_hash/, 'missing hash has a clear error');

const counts = renderer.countFeatures(visibleFrom(validControlData));
assert.deepEqual({ ...counts }, { planned: 78, 'being-built': 0, 'built-checking': 0, 'proven-windows': 0 });
assert.equal(validControlData.nonV1Features.length, 1);
console.log('feature-map renderer DOM tests passed: 78 V1 cards (69 journey + 9 foundation), 1 outside-V1 item');
