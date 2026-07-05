# How we're building Advisor Prep Hero — a whole-system assessment

*Coordinator's high-level read, 2026-07-04, after a day of ~23 merges + a trust review + a fresh-eyes QA campaign. Not about individual bugs — about the patterns underneath them.*

## The single biggest signal: we keep fixing the same TWO bug shapes

Almost every serious bug today was one of two recurring shapes, not a unique mistake:

1. **"A failure is silently swallowed, so a broken thing looks fine (or stuck forever)."** The notes that hung, the transcript that "hung" (really failed in 0.1s and got thrown away), the save that said "Saved" while losing data, the new-doc that wasn't searchable, the privilege-retag that failed silently. A static sweep today found **eight more** of the exact same shape in one pass.
2. **"An async step finishes late and acts on the wrong current state."** A note-trail loaded for one client showing on another; a cancelled question sending anyway; a whole-practice question resolving late and sending against the wrong client set.

**Why this matters at the system level:** these aren't bad luck — they're a *missing discipline* baked into how the code was written. The codebase pervasively treats "the async thing failed" as "nothing happened," and rarely guards against "the user moved on while I was waiting." Fixing instances one by one is a treadmill. The leverage move is to make the fix **structural**: a lint rule that bans empty/silent catches on user-facing paths, a single standard "run-async-into-state" helper that always has an error path and a still-current guard, and a "no eternal pending/loading state without a terminal error path" review checklist. Fix the *pattern*, and a whole future class of bugs never gets written.

## For a TRUST product, honesty is audited, not enforced

The Tier A honesty pass and the trust review found the app *saying things that weren't true* — "never writes back to your CRM" next to a write feature, "nothing ever leaves your machine" that's only true in one mode, a provider name that disagreed with itself across screens. None of these were malicious; they happened because **features get built and their trust-copy gets written independently, with nothing checking that a claim matches the behavior.** For a product whose entire differentiator is trust, that's backwards. The systemic improvement: every user-facing trust claim should be verified against the code as a *build-time or review gate*, and trust/compliance should be a *design input* for each feature (a short checklist: what does this feature claim, is it true, what does the other person in the room experience, what would a compliance officer ask) — not a post-hoc review that catches it late.

## Server tests are structurally blind; real-OS testing keeps being the thing that saves us

Every one of the scariest bugs — the second-cycle save loss, the notes hang, the Windows path bug, the transcript-empty-file bug — **passed all unit tests and only died on real Windows.** This is inherent: it's a desktop app, and `tsc + vitest + cargo` cannot see file locks, path shapes, native dialogs, or engine subprocesses. We've been *reactive* about this (find on the bench → fix). The higher-level shift is to treat real-OS smoke as a **first-class, continuous** part of the loop, not an after-merge afterthought — which today's move toward parallel cloud benches + a pre-warmed Legion + the planned recurring QA campaign is already starting to do. Worth making it doctrine, not improvisation.

## The velocity is real, but it's on a fork that's quietly getting harder to reunite

23 merges in a day is genuine throughput. But it's all on the `lantern-plus` fork, which is diverging from the main product line a little more with every merge. The divergence report exists; the fork→main integration keeps getting (reasonably) deferred. **Day-to-day velocity masks a compounding cost** — the longer the fork runs hot, the more painful that eventual reunification. It's not urgent today, but it's the kind of thing that's cheap to plan now and expensive to ignore for another week.

## Two process leaks the speed is hiding

- **Workers declared "done" twice today without actually pushing/committing their work** — caught only because I check git state on every handoff. The "done" signal doesn't currently *mean* "integrated-ready." That should be enforced (a worker isn't done until the branch is pushed AND reconciled), not dependent on my vigilance.
- **Every parallel merge fights the same file** — the i18n key-count snapshot test has a hardcoded number that conflicts on essentially every concurrent merge, so I hand-resolve it repeatedly. That's a recurring *friction tax* the design creates; a self-deriving check would remove it.

## What's genuinely strong (don't "fix" these)

- **The evidence-before-assertions discipline is real and rare.** Nothing is called done without a command output or a live screenshot. That's why the merges are safe at this pace.
- **Layered adversarial review works.** Worker self-review via a second AI, then an independent coordinator review, then live verification — it caught a P0 privilege leak, a duplicate-email bug, a wrong-client send, and dozens more *before* users would. The "second independent model" habit is a genuine quality multiplier.
- **The trust architecture itself is honest and mostly built** — local-first, citations that verify, a tamper-evident audit chain, isolation that actually holds. The gaps are about *proving* and *not overclaiming*, which is a far better place to be than not having the substance.

## The three I'd change first (if you agree)

1. **Systematize the two bug classes** — lint rules + standard helpers + a review checklist so the swallowed-failure and stale-async shapes stop being *writable*. Highest leverage; it's a treadmill otherwise.
2. **Make "trust-copy matches behavior" a gate, and trust a design-time checklist** — so honesty stops being something a review catches late on a product that lives or dies on trust.
3. **Promote real-OS smoke + the recurring QA campaign to doctrine**, and fix the two process leaks (push-before-done; self-deriving i18n check) — cheap, removes recurring drag.

*None of these slow the current work; they change the shape of the next month. Your call on which to act on — I've changed nothing.*
