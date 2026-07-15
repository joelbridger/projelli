# Form activity durability drive

Date: 2026-07-15

The approved current TypeScript data seam is the durable `LiveCrmRecord[]` reader
used by `useLiveCrmRecords`. This lane intentionally has no submission writer and
does not touch intake ingestion or native storage.

Drive result:

1. Seeded one `intakeLink`, one linked household, and two `intakeSubmission` records
   into the surface's approved read-model fixture.
2. Rehydrated the same records through a JSON persistence boundary, representing a
   restart after the current live-record reader returns them again.
3. Verified newest-first ordering stayed `submission-new`, then `submission-old`.
4. Verified the client-facing + Contact created filter still returns only
   `submission-new` after rehydrate.

Machine proof: `selectors.test.ts` test “keeps the persisted live-record order and
filters after a restart-style rehydrate”. No write/review action was added because
no existing public TypeScript contract authorizes one for this surface.
