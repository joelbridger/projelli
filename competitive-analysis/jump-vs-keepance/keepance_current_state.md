# Keepance — Current State (grounded in the code, June 2026)

*Compiled 2026-06-28 for the Jump vs Keepance competitive analysis. Grounded in the live repo at `/home/jameson/kp-jump` (worktree of `keepance-3.0`, v3.3.x), the 2026-06-28 strategic advisor memo, `docs/board/board-data.json`, and `docs/PRODUCT-JOURNEY.md`. Where repo files disagree, the running code wins and the conflict is flagged.*

> **One-line summary:** Keepance is a genuinely well-built, **local-first / BYOK private desktop app** (Tauri) that reads a professional's own pile of documents + email and answers questions about each client/matter with **citations** — plus Word-native AI editing. It is **post-pivot (law → financial advisors, 2026-06-23)**, **pre-traction (zero outside paying users)**, and its public surfaces still tell **inconsistent stories** (law vs advisor) that must be fixed before any advisor sees it.

---

## A. Positioning today — REAL but INCONSISTENT (a trust problem for a trust product)

The advisor pivot is real in the **engine**, but several surfaces were never updated. This matters because Keepance sells *trust*, and a product whose own pages disagree about who it's for undercuts that.

| Surface | Says | Status |
|---|---|---|
| `professionStore.ts` (app default) | default profession = **`'advisor'`** | ✅ Pivoted |
| `docs/board/board-data.json` | "The private client-intelligence layer for a financial-advisory practice" | ✅ Advisor |
| Live keepance.com (per board docs) | advisor-framed (deployed from a separate worktree) | ✅ Advisor (reported) |
| **`src/config/pricing.ts`** (reaches in-app checkout) | audience strings still say **"A single attorney," "litigator," "5 to 50 attorneys"** | ❌ Stale — law |
| **In-repo `website/index.html`** | "The private intelligence layer for a law practice" | ❌ Stale — law |
| `README.md` / `ARCHITECTURE.md` | "the private intelligence layer for a law practice" | ❌ Stale — law |
| `docs/reference/FEATURES.md` | two pivots stale (describes an older "founder tool") | ❌ Stale |

**Net:** advisor is the lead ICP, but the law copy still reaches the checkout and the homepage in the repo. This is *cleanup, not building* — and it must happen before any advisor demo.

**Profession is a label facade, not a rebuild.** Per `PRODUCT-JOURNEY.md` (2026-06-23): *"under the hood the engine stayed exactly the same, only the labels and the story changed."* "Matter" → "client/household" is a display relabel; the underlying `matter_id` is never renamed. So the advisor product and the law product are the **same engine** with different vocabulary — the pivot was low-cost, which is good, but it also means nothing advisor-*specific* was deeply built.

---

## B. The three hero surfaces (Client Map · Ask · Workflows) — all REAL, shipped in v3.0

These are not prototypes. They are the head-to-head surfaces against Jump's "Client Profiles" + "AI Associate."

1. **Client Map** *(the hero)* — `src/platform/clientMap/` (real, shipped).
   - Builds a per-client/household brief by querying the **local RAG index** (LanceDB vectors) and running retrieved context through the user's chosen model (Claude/OpenAI/Gemini/Ollama).
   - Produces ~5 sections (story, people, standing, upcoming, next) + flagged gap questions.
   - **Per-item citations:** every item carries `sourceNumbers[]` pointing back to the source documents. This is the differentiator vs a generic summary.
   - **Built from the document/email pile** the user points it at — *not* from meetings or a CRM. This is the key contrast with Jump (whose profile is meeting/CRM-derived).

2. **Ask** — `src/features/ask/` (real, shipped). Cited Q&A chat over a matter/client or all files. Each turn re-runs RAG retrieval against LanceDB, injects context, streams the answer, renders citation chips that link to the exact source. Directly comparable to Jump's "AI Associate / Ask-Anything," but over the user's **local documents + email** instead of meetings/CRM.

3. **Workflows** — `src/features/workflows/` (real, shipped). Profession "packs" of repeatable templates (legal, tax, consulting, and a newer **advisor** pack). Functional but the advisor pack is thin/new.

---

## C. Local-first / BYOK / private AI — mostly REAL, one honest asterisk

**Genuinely true (architecture, not marketing):**
- **API keys live in the OS keychain** (`src-tauri/src/commands/keychain.rs`); never stored in plaintext.
- **AI calls go BYOK-direct to the provider** — the redline code documents it explicitly: *"Nothing here routes through a Keepance server… the document text goes to the user's OWN provider via their OWN key (BYOK), DIRECTLY."* Keepance never runs a content server in solo mode.
- **Local RAG**: LanceDB vectors + e5-small embeddings, stored under `<workspace>/.keepance/vectors/`. Indexing/search happen on-device.
- **Ollama support** (`OllamaSettingsSection.tsx`): if a local model is running at `127.0.0.1:11434`, Keepance can use it — true zero-egress mode.

**The honest asterisk (must stay honest — SEC is fining "AI-washing"):**
- "Private" is **architecturally** true in **local-model (Ollama) mode** — nothing leaves the machine. In **BYOK-cloud mode**, the *query text still goes to the AI provider the user chose* (OpenAI/Anthropic/etc.) — never to a Keepance server, but it does leave the device. The trust spectrum (Local-only / BYOK-direct / Assured) states this; it must be sold as **"far less to vet,"** not "nothing leaves."
- The **embedded/bundled local model is still aspirational** — today local mode = *external* Ollama the user installs, not a model shipped in the installer.

---

## D. Word-native editing + AI redline — REAL, and a CLEAN differentiator vs Jump

- In-house **OOXML (.docx) engine** (`src-tauri/src/commands/docx/`) + a React editor (`DocxEditor.tsx`).
- **AI redline with tracked changes** (`redline.ts`): turns a plain-English instruction ("tighten the indemnity clause," "shorten by 20%") into **tracked changes authored by "Keepance AI"** against the open Word document. Tracked changes survive the round trip.
- **Why it matters competitively:** Jump has *nothing* here. Jump moves data between systems; it does not help you **author/edit documents**. This is a capability Keepance owns outright.

---

## E. Email intelligence — REAL

- Connectors: **Outlook (Graph), Gmail (OAuth), generic IMAP** (`src-tauri/src/commands/mail/…`).
- Stored encrypted at rest (SQLCipher + FDE wrapper); chunks indexed into the same LanceDB semantic search as documents.
- Full email workspace UI with privilege tagging, matter assignment, full-text + semantic search.
- **Competitive note:** the validated pain signal ("Outlook search basically doesn't work") is exactly this. Keepance reads the email pile locally; Jump drafts/handles email via its inbox assistant but is cloud and meeting-centric.

---

## F. Connectors — REAL vs PLACEHOLDER (don't overstate)

**REAL / code-verified:** OneDrive (file sync), **Wealthbox** (CRM household sync), Redtail (CRM, less developed), Salesforce (CRM), DocuSign (envelope/signature import), Email (Gmail/Outlook/IMAP), Calendly.

**NOT in code (marketing fiction — the board flags this explicitly):** **Box, ShareFile, Jotform, Zocks, Addepar** have *zero* file evidence (at most one placeholder logo). Do **not** claim these.

> **Reconciliation vs the original brief:** the brief listed Box/ShareFile/Jotform/Zocks/Addepar as "staged on a separate branch." In `keepance-3.0` they are **not built** — only Addepar is even a placeholder. OneDrive + Wealthbox are the genuine connectors; Salesforce/Redtail/DocuSign exist in code but are gated/less-polished.

**Competitive contrast:** Jump claims **~39 live integrations** (CRMs, planning, portfolio, custodian, meeting, tax, estate). Keepance has **~2 polished** (OneDrive + Wealthbox). Integration breadth is a Jump strength and a Keepance gap — but it's also a different strategy: Keepance's pitch is "point at your **files**, no integration required," which sidesteps the breadth race for a stack-light solo.

---

## G. Pricing config reality

`src/config/pricing.ts` (live, reaches checkout): Solo, Professional, Firm tiers — but with **attorney/litigator** audience copy, and a **$99/yr "founding" figure floats on the advisor web page** vs `$468/$948/$1,548` per-seat-yr in config. A ~10x public inconsistency on a *trust* product. The strategic memo's #1 "fix first" item.

---

## H. What's notably unfinished / broken / honest gaps

- **Zero outside users.** Nothing advisor-polished has shipped as a downloadable installer; the last published build predates the advisor work. Pre-traction, post-pivot.
- **No SOC 2, no DPA, no formed legal entity.** Fatal for firm deals; manageable for solos (who are often their own CCO). Jump has **SOC 2 Type II** + a trust center — a real gap for any firm-level conversation.
- **PDF indexing is opt-in (default OFF)** — a Client Map on a folder of PDFs may be thin until the user enables it. Risk for the "wow on real messy files" demo.
- **5-year AI-work-product retention/audit-export** (a real RIA recordkeeping requirement, Rule 204-2) must be first-class for firms — local doesn't exempt it.
- **"Looks like a one-person app"** trust gap (design polish is strong; entity/case-study are not there).
- **The repo is honest about itself** — `board-data.json` and `PRODUCT-JOURNEY.md` are candid about what's real, aspirational, and broken. Good product hygiene; reflected here.

---

## I. The one-paragraph competitive read (for the report)

Keepance today is a **private, local-first desktop app that turns a pile of a client's own documents and email into a cited brief you can question** — plus Word-native AI editing — sold (post-pivot) to financial advisors but still wearing law clothes on several surfaces. Its **real, currently-uncontested seams vs Jump** are: (1) **local-first / BYOK / private-by-architecture** (Jump is cloud SOC 2), (2) **synthesis of an existing document + email pile** with citations (Jump's synthesis is meeting/CRM-derived; its document handling is intake/form-filling), (3) **Word-native drafting + tracked-change AI redline** (Jump has none), and (4) **works for a stack-light solo with no CRM and no meetings to record**. Its **structural disadvantages** are everything that decides this market: **distribution** (Jump rides LPL/Osaic/Cetera to 35,000 advisors; Keepance has none), **funding**, **integration breadth**, **brand/awards**, **meeting capture**, and **enterprise compliance posture**.
