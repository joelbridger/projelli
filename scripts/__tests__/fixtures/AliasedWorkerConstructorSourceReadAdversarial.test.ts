import { Worker } from 'node:worker_threads';

// Reproduced (REVIEW-speedup-b-MANIFEST-VERDICT.md): aliasing the Worker
// *constructor itself* escaped the earlier call-site recognition, which only
// matched `new <name>(...)` where `<name>` was the name Worker was imported
// as (or a namespace-qualified `.Worker`) -- `const W = Worker` is neither,
// so `new W(...)` was never recognized, its script argument was never
// resolved into a graph edge, and the worker script's own node:fs import
// never propagated. Closed instead by blanket-flagging the
// node:worker_threads import itself, which cannot be aliased away (and is
// free: zero real test in this suite imports it for a non-reading reason).
const W = Worker;
const worker = new W(new URL('./WorkerThreadsSourceReadWorker.ts', import.meta.url));
worker.unref();
