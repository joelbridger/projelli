import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(here, 'feature-map.html'), 'utf8');
const accepted = JSON.parse(fs.readFileSync('/home/jameson/lantern/coordination/control/generated/feature-map-data.json', 'utf8'));
const contract = html.match(/\/\* renderer-contract:start \*\/([\s\S]*?)\/\* renderer-contract:end \*\//)?.[1];
assert.ok(contract, 'renderer contract must be extractable for deterministic tests');
const sandbox = { window: {} };
vm.runInNewContext(contract, sandbox);
const renderer = sandbox.window.FeatureMapRenderer;

assert.equal(renderer.version, 'four-label-v1');
assert.equal(renderer.validateMapData(accepted).ok, true, 'accepted generated data renders');

const fixture = structuredClone(accepted);
const visible = [];
for (const stage of fixture.stages) for (const group of stage.groups) visible.push(...group.features);
visible.push(...fixture.foundation.features);
['Planned', 'Being built', 'Built — checking it', 'Proven on Windows'].forEach((status, index) => { visible[index].status = status; });
const fixtureVerdict = renderer.validateMapData(fixture);
assert.equal(fixtureVerdict.ok, true, 'four-label fixture is valid');
assert.deepEqual({ ...renderer.countFeatures(visible) }, { planned: 75, 'being-built': 1, 'built-checking': 1, 'proven-windows': 1 });
assert.deepEqual(['Planned', 'Being built', 'Built — checking it', 'Proven on Windows'].map((label) => renderer.statusAdapter(label).slug), ['planned', 'being-built', 'built-checking', 'proven-windows']);
for (const [label, slug] of [['Planned', 'planned'], ['Being built', 'being-built'], ['Built — checking it', 'built-checking'], ['Proven on Windows', 'proven-windows']]) {
  assert.ok(html.includes(`data-f="${slug}"`), `${label} has a filter button`);
  assert.ok(html.includes(`c-${slug}`), `${label} has a count chip`);
  assert.ok(html.includes(`s-${slug}`), `${label} has a rendered feature style`);
}

const unknown = structuredClone(fixture); unknown.stages[0].groups[0].features[0].status = 'shipped';
assert.equal(renderer.validateMapData(unknown).ok, false, 'unknown labels fail closed');
const malformed = structuredClone(fixture); malformed.foundation.features[0].requirementIds = [];
assert.equal(renderer.validateMapData(malformed).ok, false, 'malformed feature data fails closed');
assert.equal(renderer.validateMapData({ ...fixture, statusLabels: ['Planned'] }).ok, false, 'wrong label set fails closed');

const withoutNonV1 = renderer.countFeatures(renderer.validateMapData(accepted).ok ? visibleFrom(accepted) : []);
assert.equal(Object.values(withoutNonV1).reduce((sum, value) => sum + value, 0), 78, 'visible V1 total excludes the one Not in V1 feature');
assert.equal(accepted.nonV1Features.length, 1, 'accepted data contains the separate Not in V1 item');

for (const required of [
  'Future vision:', 'This is not current proof.', 'renderNonV1', 'statusNote', 'visionLabel',
  'panzoom(world', 'zoomAbs', 'Fit map', 'style-editorial', 'style-metro', 'style-bento',
  '/api/feature-map/comments', 'SpeechRecognition', 'feature-map-renderer-version', 'four-label-v1',
  'background:#fff', '#layer=', 'body.layer-vision #statusfilters'
]) assert.ok(html.includes(required), `preserved renderer behavior: ${required}`);
assert.ok(!/Live now|\bshipped\b/.test(html), 'renderer never calls a feature live or shipped');

function visibleFrom(data) {
  return data.stages.flatMap((stage) => stage.groups.flatMap((group) => group.features)).concat(data.foundation.features);
}

console.log('feature-map renderer tests passed');
