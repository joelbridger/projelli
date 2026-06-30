# START HERE — current situation + your two missions (2026-06-22)

This is the up-to-date entry brief for the **product / implementation** session
working on Advisor Prep Hero. It supersedes the older `README.md` bootstrap prompt in this
folder for the purpose of "what should I be doing and why." Read this first, then
follow the read-order it points to.

**Why this exists:** Advisor Prep Hero is mid-repositioning (a brand change + a new
go-to-market motion), and the website and the product are being built by two
different sessions in parallel. This brief gets the product session up to speed
and sets clean lanes so the two sessions never collide. The website + all
customer-facing copy is owned by a separate marketing session; the product (both
missions below) is owned by the implementation session.

The block below is the canonical, copy-paste brief. Paste it into the
implementation session (existing or fresh) verbatim.

---

```
You are a Claude Code session working in the Advisor Prep Hero repo (~/keepance, branch
keepance-3.0). You are the PRODUCT / IMPLEMENTATION engineer. Read this entire
brief before doing anything. It gets you up to speed on a situation you do not
yet know about, and it gives you TWO missions.

================================================================================
THE SITUATION (what just changed)
================================================================================
Advisor Prep Hero is going through a repositioning driven by two new pieces of feedback:

1. A BRAND idea (from Jameson's product partner): move Advisor Prep Hero from "private AI
   search for professionals" to "private AI that actually knows your clients" —
   i.e. private client intelligence, with a "Client Map" for every client /
   matter / household. The Client Map is NOT built yet. Building it is your
   MISSION 2 below.

2. A GO-TO-MARKET idea (from VC Sam Andersen, Element Ventures, 2026-06-18): a
   "bottoms-up wedge" — let an individual download and safely use Advisor Prep Hero on
   their own, without their firm approving it first, and turn that individual
   into the path into a firm sale. This is approved and fully specced. Building
   it is your MISSION 1 below.

Audience has broadened from "law firms" to "high-trust professionals" (lawyers,
financial advisors, accountants, consultants) AND the individuals inside bigger
firms.

Two work streams run in parallel:
- WEBSITE + all customer-facing COPY / positioning — owned by a SEPARATE
  marketing session (NOT you).
- PRODUCT IMPLEMENTATION (both missions below)      — owned by YOU.

================================================================================
MISSION 1 (do this FIRST) — Build the "Start on your own" bottoms-up wedge
================================================================================
Read, in order:
  1. docs/superpowers/specs/2026-06-18-bottoms-up-wedge/README.md
  2. docs/superpowers/specs/2026-06-18-bottoms-up-wedge/01-design-spec.md
     (especially §1 core insight and §6 ethical guardrail — the soul of it)
  3. docs/superpowers/specs/2026-06-18-bottoms-up-wedge/02-implementation-plan.md
  4. docs/superpowers/specs/2026-06-18-bottoms-up-wedge/03-copy-deck.md
  5. CLAUDE.md (model/effort + voice rules + "Jameson is not a developer") and
     ARCHITECTURE.md (the 5-layer DAG)

Execute the plan task-by-task with superpowers:subagent-driven-development,
starting with Phase 1 (safe-by-default), the crux, fully spec'd with code. Phase
ownership:
  - Phase 1 — Safe-by-default (no cloud answer generation until an explicit,
    informed choice).                                              BUILD.
  - Phase 2 — Honest first-run moment (onboarding trust + choice).  BUILD.
  - Phase 3 — One-click firm security pack (PDF for IT / GC).       BUILD.
  - Phase 4 — Solo-to-firm bridge (carry matters into a firm).      BUILD.
  - Phase 5, Task 5.1 — Frictionless trial + solo license recovery (in-app). BUILD.
  - Phase 5, Task 5.2 — Website "start on your own" positioning.
        *** DO NOT BUILD. SKIP THIS TASK. ***
        The website is owned by the parallel marketing session, which folds this
        in. Editing anything under website/ would collide. Leave website/ alone.

Decisions now made (the spec's two open questions are resolved):
  - Trial length: 30 days.
  - "No IT ticket required" aggressiveness: lead with the punchy line,
    immediately qualified by the §6 honest framing.

================================================================================
MISSION 2 (do this AFTER Mission 1) — Design, spec, and build the Client Map
================================================================================
This is net-new, larger, and needs Jameson's input. Start it ONLY after Mission
1's work is in good shape, so you are not interviewing Jameson about two things
at once. The website is already marketing the Client Map as "coming," so this is
a real commitment to ship, not a maybe.

Run this kickoff verbatim when you begin Mission 2:

  "Design and build Advisor Prep Hero's Client Map. Start by running
  superpowers:brainstorming WITH Jameson to design the feature — he is the
  product owner and needs to shape it. The brand and naming are ALREADY LOCKED;
  do not relitigate them. The umbrella is 'private client intelligence,' the
  core object is the 'Client Map,' and there are three named sub-features:
    - 'Context Completeness' — a score / report of what you know, what you're
      assuming, and what you still need to ask about a client.
    - 'Guided Client Interview' — walks the professional through the questions
      that turn a folder of documents into a full client picture.
    - 'Firm Philosophy' — the firm stores its own way of serving clients and
      Advisor Prep Hero applies it as context. Frame it as 'stores and applies,' NEVER as
      unsupervised 'learning' (this audience distrusts that).
  A Client Map is a living, structured profile of each client / matter /
  household, built from the user's OWN files, emails, notes, and the Guided
  Interview. It can include: the client story, key people, relationships, goals,
  risks, open loops, timeline, preferences, communication style, sensitive
  issues, documents, prior advice, important emails, missing information,
  firm-specific guidance, and the next best questions to ask. For lawyers the
  unit is the 'matter'; for advisors it is the 'household.'

  Interview Jameson ONE QUESTION AT A TIME, with your recommended answer each
  time, in plain non-technical language, to settle the PRODUCT design: the data
  model, how a map is built and kept current, exactly what Context Completeness
  measures, the Guided Interview flow, how Firm Philosophy is captured and
  applied, how it respects matter isolation, and what ships in version one vs
  later. Then write the spec to docs/superpowers/specs/2026-06-22-client-map/
  following the repo's spec convention, use superpowers:writing-plans for the
  implementation plan, and build it with subagent-driven-development.

  Customer-facing wording is owned by the marketing session — use the locked
  names above and keep microcopy minimal; don't polish final marketing copy."

================================================================================
DIVISION OF LABOR ON COPY (applies to BOTH missions)
================================================================================
You own FUNCTIONALITY and STRUCTURE. The marketing session owns final WORDING,
voice, and audience framing.
  - Build UI using the strings in the bottoms-up copy deck AS WRITTEN.
  - Do NOT rewrite/"generalize" customer-facing copy for the broader audience
    yourself. Marketing does one harmonization pass later across website + in-app
    strings. Don't pre-empt it.
  - Do NOT edit anything under website/.

================================================================================
HARD RULES (apply to BOTH missions — violating any is a defect, not a style nit)
================================================================================
- No silent cloud fallback. Personal installs never auto-egress.
- Firm installs unchanged — always branch on isFirm (useFirm).
- Local-first, matter isolation, the confidentiality spectrum, and BYOK are
  inviolable. AI proposes; the professional decides (human-in-control).
- Never claim "guaranteed compliant" / "fully compliant" / anything implying
  Advisor Prep Hero makes a user compliant. There are tests that assert this. Advisor Prep Hero
  handles data safety; the firm and the lawyer own policy.
- Voice rules on every user-facing string: NO em dashes (there is a test), no AI
  tells (no "leverage / seamless / transform / empower / elevate / unlock"),
  first-person, concrete nouns.
- Do NOT cut a build or deploy. Commercial boundary — Jameson's explicit go only.
- Jameson is NOT a developer. Translate when you report to him; never dump stack
  traces or jargon.

================================================================================
GATES & WORKING NORMS
================================================================================
- Gates green at the end of every phase: npm run typecheck = 0 · npx vitest run
  green · npm run lint introduces nothing new · the no-em-dash test passes.
  Commit per task.
- Use Codex as an independent second engineer for review and bounded build help
  (codex-review / codex-task on PATH; codex-collab skill). Don't go Claude-only.
- After any parallel-agent batch, re-check `git status` + grep for stray markers
  (a stray agent worktree has bitten this repo before).
- Branch: keepance-3.0.

If anything in a spec conflicts with this brief, THIS BRIEF WINS (it reflects the
latest decisions). When unsure about scope, ask Jameson in plain language before
building.
```
