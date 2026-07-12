import type { RagHit } from '@/platform/utils/tauri-commands';

/**
 * The camelCase wire shape asserted by the real Rust `rag_retrieve` test in
 * `src-tauri/tests/rag_dated_retrieval_e2e.rs`. It contains two imported copies
 * of one mail record plus one CRM note — not two documents that disagree about
 * a business fact.
 */
export const REAL_RAG_RETRIEVE_DATE_HITS: RagHit[] = [
  {
    id: 'mail-copy-older',
    sourceId: 'mail:mail-copy-older',
    path: 'mail:mail-copy-older',
    sourceType: 'mail',
    chunkText: 'Jordan review chronology: inbox copy.',
    score: 0.98,
    paragraphIndex: 0,
    matterId: 'jordan',
    sourceDate: {
      value: '2026-07-10T14:30:00.000Z',
      kind: 'received',
      confidence: 'source',
    },
    datedFact: {
      key: 'mail-message:<jordan-review@example.test>:received-date',
      value: '2026-07-10T14:30:00Z',
    },
    dateConflict: {
      kind: 'conflicting-dated-evidence',
      factKey: 'mail-message:<jordan-review@example.test>:received-date',
      relation: 'older-conflicts-with-newer',
      evidence: [
        {
          sourceId: 'mail:mail-copy-older',
          path: 'mail:mail-copy-older',
          value: '2026-07-10T14:30:00Z',
          sourceDate: {
            value: '2026-07-10T14:30:00.000Z',
            kind: 'received',
            confidence: 'source',
          },
        },
        {
          sourceId: 'mail:mail-copy-newer',
          path: 'mail:mail-copy-newer',
          value: '2026-07-11T14:30:00Z',
          sourceDate: {
            value: '2026-07-11T14:30:00.000Z',
            kind: 'received',
            confidence: 'source',
          },
        },
      ],
    },
  },
  {
    id: 'mail-copy-newer',
    sourceId: 'mail:mail-copy-newer',
    path: 'mail:mail-copy-newer',
    sourceType: 'mail',
    chunkText: 'Jordan review chronology: archive copy.',
    score: 0.97,
    paragraphIndex: 0,
    matterId: 'jordan',
    sourceDate: {
      value: '2026-07-11T14:30:00.000Z',
      kind: 'received',
      confidence: 'source',
    },
    datedFact: {
      key: 'mail-message:<jordan-review@example.test>:received-date',
      value: '2026-07-11T14:30:00Z',
    },
    dateConflict: {
      kind: 'conflicting-dated-evidence',
      factKey: 'mail-message:<jordan-review@example.test>:received-date',
      relation: 'newer-conflicts-with-older',
      evidence: [
        {
          sourceId: 'mail:mail-copy-older',
          path: 'mail:mail-copy-older',
          value: '2026-07-10T14:30:00Z',
          sourceDate: {
            value: '2026-07-10T14:30:00.000Z',
            kind: 'received',
            confidence: 'source',
          },
        },
        {
          sourceId: 'mail:mail-copy-newer',
          path: 'mail:mail-copy-newer',
          value: '2026-07-11T14:30:00Z',
          sourceDate: {
            value: '2026-07-11T14:30:00.000Z',
            kind: 'received',
            confidence: 'source',
          },
        },
      ],
    },
  },
  {
    id: 'crm-note',
    sourceId: 'crm:note:42',
    path: 'crm:note:42',
    sourceType: 'crm',
    chunkText: 'Jordan review chronology: CRM note is complete.',
    score: 0.96,
    paragraphIndex: 0,
    matterId: 'jordan',
    sourceDate: {
      value: '2026-07-12T14:30:00.000Z',
      kind: 'updated',
      confidence: 'source',
    },
    datedFact: {
      key: 'crm-record:note:42:updated-date',
      value: '2026-07-12T14:30:00Z',
    },
  },
];
