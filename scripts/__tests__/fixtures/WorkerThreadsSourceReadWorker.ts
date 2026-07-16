import { readFileSync } from 'node:fs';
import { parentPort } from 'node:worker_threads';

// The worker script itself, not the test file, is what actually reads
// source. It has a plain, direct node:fs import -- the graph edge from the
// test into this file (via new Worker(...)'s literal script path) is what
// must propagate that capability up to the test.
const registrySource = readFileSync('src/platform/flags/registry.ts', 'utf8');
parentPort?.postMessage(registrySource);
