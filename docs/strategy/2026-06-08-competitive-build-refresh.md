# Competitive-build refresh (2026-06-08)

Layers onto `docs/strategy/2026-06-06-competitive-build-handoff.md` and
`...-vertical-competitive-landscape.md`. **Build subagents read all three.** The
original drafted copy in the handoff still stands; this updates three things and
re-states the guardrails. The handoff predates the email feature, so the main job
of this refresh is folding email in.

## 1. Email is now a first-class wedge (shipped in v2.5.0, 2026-06-08)

Multi-provider email (Microsoft 365 + IMAP + Gmail) is imported INTO Keepance,
kept on the user's machine, encrypted at rest, searchable locally, never routed
through a Keepance server. It is the one capability the cloud-AI incumbents
structurally cannot copy. Fold it into each build item:

- **Item 1 (per-vertical comparison sections):** add an email line to each
  vertical's "How Keepance compares to the AI you already have" table:
  *Keepance* = "Your email, imported and searchable on your machine"; the
  incumbent = how it handles mail (most read/process it in their cloud). Sharpest
  vs Microsoft 365 Copilot, which reads Outlook mail in Microsoft's cloud.
- **Item 2 (/vs/ incumbent pages):** for **Copilot (M365)**, make the email
  contrast a lead row (Copilot reads your Outlook in the cloud; Keepance imports +
  searches it locally). For Clio Duo / CoCounsel / Jump / Intuit Assist / Gamma,
  add an "email, local + searchable" row (a Keepance-only capability where they
  don't offer it; the local-vs-cloud contrast where they do). Add the same row to
  the `/vs/index.html` comparison if one exists.
- **Item 3 (hero):** the local-model, zero-egress story now extends to email.
  Email is the concrete, felt proof of the local-first promise.
- Out of scope for now: dedicated /vs/ pages against email-AI tools
  (Shortwave/Superhuman). They are not "the AI a lawyer/CPA already has." Revisit
  only if email becomes the primary go-to-market.
- **Honesty (extends Guardrail 2):** email IMPORT, storage, and search are fully
  local. AI *over* that mail still depends on the model: a local model = nothing
  leaves the machine; a cloud key still sends the prompt to the provider. Never
  imply a cloud-key setup keeps mail content local beyond storage/search.

## 2. Pricing — fix FIRST (Guardrail 4)

Canonical source = the homepage (`website/index.html` schema.org + the pricing
copy): **Personal $49 one-time; Professional $149/yr; Practice $499/yr (annual);**
founding offer = Professional $99/yr for the first 100 buyers per pack. Practice is
**yearly**, not one-time.

Stale surfaces to correct (done in this refresh commit; verify none remain before
building price-citing tables):
- `website/vs/index.html` (Practice "$499 once" -> "$499/yr").
- `website/docs/faq.html` (text calling Practice a one-time purchase -> yearly).
- Any app EULA / other surface that still says Practice is one-time.

Comparison tables: pull Keepance's price from these canonical values; competitor
prices = approximate bands + "approximate, as of 2026, check vendor" footnote +
outbound link. Never hardcode a hard competitor price.

## 3. Hero direction (the front-door decision)

Decision (my call; flag for Jameson's deploy-review): **keep the workspace +
local-first as the core promise, lead the hero with the local-model zero-egress
wedge, and feature email as the headline NEW proof point** (a prominent secondary,
not a full email-first pivot). Rationale: the product is the workspace; email is
the sharpest new proof of the moat and maps to a felt pain, but pivoting the whole
front door to "email app" undersells the workspace and risks miscategorizing the
product. Hero shape: "The AI workspace where your work stays on your machine" +
a strong email sub-hook ("now including your email, finally searchable and
private"). This satisfies handoff item 3 (lead with local-model) and folds email in.

## 4. Guardrails (carry forward from the handoff, unchanged)

Honesty (every comparison says where the competitor genuinely wins; represent
their privacy fairly: cloud + contractual no-training, not "they steal your
data"); local-vs-cloud precision (only a LOCAL model = nothing leaves your
machine); Heppner / IRC §7216 / Reg S-P as sourced, cautionary, "informational,
not legal advice"; pricing from canonical source; voice (no em dashes, no AI
tells, first-person, light theme, Satoshi, reuse `/vs/` styles + shared nav +
`kp-footer`).

## Build sequencing (subagent-driven, per the handoff)

0. Pricing consistency fix (this commit handles /vs/ + faq; verify EULA).
1. Per-vertical comparison sections (Legal, Tax, Consulting, Advisors) with the email line.
2. /vs/ hub section + per-incumbent pages: Copilot first (email angle), then build
   from the Clio Duo template -> CoCounsel, Jump, Intuit Assist, Gamma.
3. Hero reframe (local-model lead + email sub-hook), folded with the 06-04
   cloud-key-overclaim fixes (do not duplicate).
4. Gatekeeper one-pagers: add the competitive angle.

Run the site lint. **Do NOT deploy to keepance.com until Jameson reviews the
competitive claims and gives the go.**
