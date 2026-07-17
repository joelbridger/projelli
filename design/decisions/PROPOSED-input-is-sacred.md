# PROPOSED design principle — User input is sacred

**Status: PROPOSED — pending design-office adoption (delegated expert review or Jameson).**
Proposed 2026-07-17 (c27) after a confirmed data-loss bug: a Schwab prefill form silently wiped an
advisor's typed field values when a background prefill/household-data load re-initialized the form.
The bug was caught by a flaky test that was refused quarantine and diagnosed as a real PRODUCT race.

## The principle (proposed for DESIGN-CHARTER / DS rulebook)

> **User input is sacred. No background process may overwrite, clear, or re-seed a field the user
> has edited.** Once a user has touched an input, asynchronous loads (prefill, autofill, sync,
> re-fetch, live updates) must preserve the user's value — merging around it, never clobbering it.
> A field may be re-seeded from an async source ONLY while it is still pristine (never edited).

## Why this belongs at DESIGN time, not just in tests

A test catches the bug in one surface after it is built. A design principle makes every future
feature inherit the rule at design time, and gives design reviewers a concrete thing to judge:
"does this surface's async loading preserve edited fields?" becomes a review question, not a
post-hoc flake. It is the truth-in-UI lens applied to data integrity — the highest-stakes version,
because the failure mode is silent loss of an advisor's work.

## Review guidance (for the design-review mandate)

Any surface with BOTH user-editable fields AND an async source that populates those fields owes:
- a stated dirty-preservation rule in its design source;
- proof (a determinism test, run repeatedly) that a value entered mid-load survives;
- a design-review check that the loading/error states never reset edited input.

## Adoption path

This is a new design PRINCIPLE (a design decision), so it goes through the design-office ceremony:
expert-proxy review per DELEGATED-OWNER-REVIEW.md (or Jameson directly). On adoption, promote the
principle line into DESIGN-CHARTER and add the review check to the design-review mandate; retire
this PROPOSED file's "pending" status.
