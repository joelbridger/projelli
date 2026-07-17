# PROPOSED design-office decision — unsaved-changes guard on record/client switch

**Status: PROPOSED design-office decision item (NOT a v1 blocker). Surfaced 2026-07-17 (c27) by the
data-loss dirty-tracking fix.**

## The tension
The "user input is sacred" fix (dirty-tracking: a background reload no longer overwrites fields the
advisor has edited) correctly preserves typed input WITHIN one record/client context. But a GENUINE
context switch (to a different client/record/account type) now fully re-seeds the form — which
DISCARDS unsaved typing by design. That is also input loss: the principle cuts both ways. Right now
the discard-on-switch is silent.

## The decision to make
Should a switch-while-dirty prompt an unsaved-changes guard ("You have unsaved edits — discard and
switch, or stay?") rather than silently discarding? This applies to every surface using the
dirty-tracking pattern (SchwabPrefillReview + the cross-pollination siblings: EmailDropbox,
CustomFields, NudgeReview, and any future prefill/autofill surface).

## Why it's not a v1 blocker but must be logged
The immediate data-loss bug (silent wipe on background reload) is fixed and far more dangerous.
Discard-on-explicit-switch is a lesser, user-initiated case. But letting it become silent precedent
contradicts the principle, so it is logged as an explicit design-office decision rather than an
accident. Route through the design-office ceremony (delegated expert review or Jameson).

## Companion hard rule (already enforced by the fix + its review)
A genuine context switch MUST fully re-seed (no client-A data persisting under client-B) — that is
the cross-client isolation boundary, adversarially probed in the data-loss reviews. This decision is
only about whether the discard is GUARDED (a prompt), never about weakening the re-seed.
