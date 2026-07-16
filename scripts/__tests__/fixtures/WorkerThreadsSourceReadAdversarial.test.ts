import { Worker } from 'node:worker_threads';

// Reproduced (REVIEW-speedup-b-REDESIGN-VERDICT.md): a test can read a
// production source file's raw text inside a worker thread, with no fs
// import in the test file itself. Closed via a blanket node:worker_threads
// capability signal (REVIEW-speedup-b-MANIFEST-VERDICT.md: free, zero real
// test importers in the whole suite) -- the import specifier itself is what
// is flagged, regardless of what the worker script does or how the Worker
// constructor is later called/renamed. ./WorkerThreadsSourceReadWorker.ts is
// kept alongside this fixture for narrative fidelity (a real worker script
// that actually reads source) but is no longer load-bearing for
// classification: this file is opaque purely from importing
// node:worker_threads.
const worker = new Worker(new URL('./WorkerThreadsSourceReadWorker.ts', import.meta.url));
worker.unref();
