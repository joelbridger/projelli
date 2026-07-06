codex
DIFFERENT.

**All Clients path**
- The pill is `all-matters`: [ScopeToggle.tsx](/home/jameson/lantern-plus/src/features/ask/ScopeToggle.tsx:35)
- It uses normal Ask submit, because only `whole-practice` is diverted: [Ask.tsx](/home/jameson/lantern-plus/src/features/ask/Ask.tsx:221)
- Retrieval scope becomes `{ kind: 'allMatters' }`: [useAsk.ts](/home/jameson/lantern-plus/src/features/ask/useAsk.ts:714)
- It calls `MemoryService.retrieve(...)`: [useAsk.ts](/home/jameson/lantern-plus/src/features/ask/useAsk.ts:738)
- `MemoryService.retrieve` forwards that scope to the RAG backend: [MemoryService.ts](/home/jameson/lantern-plus/src/platform/rag/MemoryService.ts:492)
- Rust turns `AllMatters` into `None`, meaning no single-client matter filter: [query.rs](/home/jameson/lantern-plus/src-tauri/src/commands/rag/query.rs:141)
- Store layer says `None` searches all matters: [retrieval.rs](/home/jameson/lantern-plus/src-tauri/src/commands/rag/store/retrieval.rs:110)

**Whole Practice path**
- The pill is `whole-practice`: [ScopeToggle.tsx](/home/jameson/lantern-plus/src/features/ask/ScopeToggle.tsx:40)
- Ask diverts it before normal retrieval: [Ask.tsx](/home/jameson/lantern-plus/src/features/ask/Ask.tsx:221)
- It calls `runWholePracticeAsk`, not `handleAsk`: [Ask.tsx](/home/jameson/lantern-plus/src/features/ask/Ask.tsx:202)
- That file says it deliberately never imports `MemoryService` or calls `rag_retrieve`: [wholePracticeAsk.ts](/home/jameson/lantern-plus/src/features/ask/book/wholePracticeAsk.ts:1)
- It builds a digest from Client Map facts only: [wholePracticeAsk.ts](/home/jameson/lantern-plus/src/features/ask/book/wholePracticeAsk.ts:40), [bookFacts.ts](/home/jameson/lantern-plus/src/features/ask/book/bookFacts.ts:16)
- The test guard confirms it never calls retrieval: [wholePracticeAsk.test.ts](/home/jameson/lantern-plus/src/features/ask/book/wholePracticeAsk.test.ts:64)

Recommendation: do **not** remove Whole Practice as a duplicate. Rename it to make the difference obvious, like `Client summaries` or `Whole practice summaries`.

DIFFERENT: All Clients searches raw indexed files across clients; Whole Practice searches only saved Client Map summaries across clients.
tokens used
128,851
DIFFERENT.

**All Clients path**
- The pill is `all-matters`: [ScopeToggle.tsx](/home/jameson/lantern-plus/src/features/ask/ScopeToggle.tsx:35)
- It uses normal Ask submit, because only `whole-practice` is diverted: [Ask.tsx](/home/jameson/lantern-plus/src/features/ask/Ask.tsx:221)
- Retrieval scope becomes `{ kind: 'allMatters' }`: [useAsk.ts](/home/jameson/lantern-plus/src/features/ask/useAsk.ts:714)
- It calls `MemoryService.retrieve(...)`: [useAsk.ts](/home/jameson/lantern-plus/src/features/ask/useAsk.ts:738)
- `MemoryService.retrieve` forwards that scope to the RAG backend: [MemoryService.ts](/home/jameson/lantern-plus/src/platform/rag/MemoryService.ts:492)
- Rust turns `AllMatters` into `None`, meaning no single-client matter filter: [query.rs](/home/jameson/lantern-plus/src-tauri/src/commands/rag/query.rs:141)
- Store layer says `None` searches all matters: [retrieval.rs](/home/jameson/lantern-plus/src-tauri/src/commands/rag/store/retrieval.rs:110)

**Whole Practice path**
- The pill is `whole-practice`: [ScopeToggle.tsx](/home/jameson/lantern-plus/src/features/ask/ScopeToggle.tsx:40)
- Ask diverts it before normal retrieval: [Ask.tsx](/home/jameson/lantern-plus/src/features/ask/Ask.tsx:221)
- It calls `runWholePracticeAsk`, not `handleAsk`: [Ask.tsx](/home/jameson/lantern-plus/src/features/ask/Ask.tsx:202)
- That file says it deliberately never imports `MemoryService` or calls `rag_retrieve`: [wholePracticeAsk.ts](/home/jameson/lantern-plus/src/features/ask/book/wholePracticeAsk.ts:1)
- It builds a digest from Client Map facts only: [wholePracticeAsk.ts](/home/jameson/lantern-plus/src/features/ask/book/wholePracticeAsk.ts:40), [bookFacts.ts](/home/jameson/lantern-plus/src/features/ask/book/bookFacts.ts:16)
- The test guard confirms it never calls retrieval: [wholePracticeAsk.test.ts](/home/jameson/lantern-plus/src/features/ask/book/wholePracticeAsk.test.ts:64)

Recommendation: do **not** remove Whole Practice as a duplicate. Rename it to make the difference obvious, like `Client summaries` or `Whole practice summaries`.

DIFFERENT: All Clients searches raw indexed files across clients; Whole Practice searches only saved Client Map summaries across clients.
