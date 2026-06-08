# Website messaging notes + competitive-build status (2026-06-08)

Working notes from the messaging conversation, plus an evaluation of whether the
2026-06-06 competitive-build handoff was ever executed. Not a final spec yet.

## A. Messaging first-thoughts (the email wedge)

- **Current positioning:** the local-first AI workspace for confidential client work
  (solo/small-firm attorneys, CPAs/EAs, consultants, RIAs). A "where your work lives" story.
- **New wedge (shipped in v2.5.0, 2026-06-08):** multi-provider **email** imported INTO
  Keepance, kept on your machine, searchable, encrypted at rest, never routed through a
  Keepance server. This is the one capability the cloud-AI incumbents (M365 Copilot,
  Shortwave, Superhuman) structurally cannot copy.
- **Felt pain it maps to:** "Outlook/Gmail search is broken, I can't find anything," and
  "I can't pipe privileged/confidential mail into a cloud AI."
- **Directions to explore (not yet decided):**
  1. *Email-led front door:* "Your email, finally searchable, and it never leaves your
     machine" as the hero hook that pulls people into the larger workspace story.
  2. *Workspace-led, email as proof:* keep the workspace as the core promise; use email
     as the concrete, felt wedge that demonstrates the local-first moat.
  3. *Lead-with-the-local-model:* foreground that a local model means your work (and now
     your mail) never leaves the device.
- **Honesty precision (hard bar):** "nothing leaves your machine" is true only for a
  LOCAL model; a cloud API key still sends prompts to the provider. Email import,
  storage, and search are fully local; AI *over* that mail depends on the model choice.
  Do not blur these.
- **Open decision:** which front door (email-led vs workspace-led), and how tightly to
  couple it to the cold-outreach push.

## B. Competitive-build handoff status — was it done? NO.

The instructions referenced `docs/strategy/2026-06-06-vertical-competitive-landscape.md`
and `...-competitive-build-handoff.md`. Both are **UNTRACKED / never committed**, and the
deliverables are not on the live site:

1. **Per-vertical "How Keepance compares to the AI you already have"** on /legal, /tax,
   /consulting, /financial-advisors: **NOT built** (grep for "the AI you already have" /
   "Clio Duo" / "CoCounsel" / "Intuit Assist" across `website/` returns zero hits).
2. **/vs/ profession-incumbent pages** (Clio Duo, CoCounsel, Jump, Intuit Assist, Gamma,
   Copilot): **NOT built.** `website/vs/` holds general-tool comparisons only (Notion,
   Obsidian, ChatGPT, Tana, Reflect, Mem, Logseq, Heyday, Claude Projects, Cursor) from
   earlier work — none of the profession incumbents the handoff specifies.
3. **Lead-with-the-local-model hero:** the adjacent privacy-overclaim cleanup WAS done
   earlier (commit `3e50d9b`, accurate local-vs-cloud framing); the positive
   lead-with-local-model reframe in this handoff is not evident.
4. **Gatekeeper one-pagers:** the four EXIST (commit `c14f4fb`): `advisor-cco-reg-sp`,
   `consulting-client-data-statement`, `legal-malpractice-carrier`, `tax-7216-data-handling`.
   The handoff's "add the competitive angle" enhancement was NOT added.

## C. Synthesis / recommendation

- The handoff predates the email feature (it is dated 2026-06-06; email shipped 2026-06-08),
  so it needs a refresh to fold in email as a wedge and to reflect the current product state.
- The competitive-build work and the messaging tweaks are really one effort: refresh the
  positioning (local-model + email wedge), build the per-vertical comparison sections and
  the profession-incumbent /vs/ pages, and add the competitive angle to the one-pagers.
- Carry forward the handoff's honesty guardrails: represent competitors fairly (cloud +
  contractual no-training, not "they steal your data"); local-vs-cloud precision; Heppner /
  IRC §7216 / Reg S-P as sourced, informational-not-legal-advice cautionary cases; pricing
  from the canonical source.
- **Resolve first (per the handoff):** the pricing inconsistency where `/vs/index` says
  "Practice $499 once" but the homepage moved Practice to yearly. Make homepage, /vs/, and
  the EULA consistent before building comparison tables that cite price.
- The two untracked strategy docs are valuable; track them (commit) if we pursue this.
