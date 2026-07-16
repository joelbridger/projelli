import { Worker } from 'node:worker_threads';

// Reproduced (REVIEW-speedup-b-REDESIGN-VERDICT.md): a test can read a
// production source file's raw text inside a worker thread, with no fs
// import in the test file itself. Unlike child_process, the worker's script
// is named by a resolvable module specifier -- `new URL('./path', import.meta.url)`
// is the standard pattern -- so it is resolved as a real graph edge into
// ./WorkerThreadsSourceReadWorker.ts instead of blanket-flagging every
// node:worker_threads import. That helper file's own node:fs import is what
// makes this test opaque, transitively, exactly like the existing local
// re-export fixtures.
const worker = new Worker(new URL('./WorkerThreadsSourceReadWorker.ts', import.meta.url));
worker.unref();
