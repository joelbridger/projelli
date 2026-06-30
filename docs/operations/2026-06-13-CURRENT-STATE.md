# Advisor Prep Hero — Current State of Everything (2026-06-13)

> **READ THIS FIRST.** This is the single source of truth for the exact state of Advisor Prep Hero as of 2026-06-13. It **supersedes** the prior `docs/operations/2026-06-*-NEXT-SESSION-*.md` handoffs (kept for history only). Branch `keepance-3.0` is the production branch; `HEAD == origin/keepance-3.0 == 0b5d691`, working tree clean.

---

## 1. TL;DR

- **The entire vision is built and SHIPPED.** Waves 1–4 of the vision-gap plan are done, verified, and **deployed as v3.2.0** (desktop + firm backend + website, 2026-06-12). The only remaining wave (VG-9 connectors) is **externally gated on vendor sandbox access**, not on us.
- **Live as of now:** desktop app **v3.2.0** (auto-updater serving it on all platforms), firm backend at `api.keepance.com`, website `keepance.com`.
- **In your court (Jameson):** a few real-hardware spot-checks, the vendor-access relationships (Clio + iManage in motion), and the proof moat (entity/DPA/SOC2/attorneys). None block code.

## 2. Release / deploy state (LIVE)

| Surface | State |
|---|---|
| Desktop app | **v3.2.0 PUBLISHED** (signed Win/Mac-Intel/Mac-ARM/Linux; auto-updater `latest.json` serves 3.2.0 on every platform). Existing users get the update offer. |
| Firm backend | **Redeployed** to `api.keepance.com` (systemd `keepance-backend` on this box, repo `backend/`, port 5194, env `/etc/keepance-firm-backend.env`). SSO endpoints live, relay `doc_id`-partitioned. Live DB backed up pre-migration (`…/data/keepance-firm.sqlite.bak-pre-v3.2.0-*`, near-empty so migration was zero-risk). |
| Website | **Deployed + CF-purged.** Download links → v3.2.0 assets (all 200), honest "Admin console with SSO" claim live. |
| Version | `3.2.0` in package.json, tauri.conf.json, src-tauri/Cargo.toml, Cargo.lock (all aligned). CHANGELOG `[3.2.0]` written. |

**Deploy procedure** (for the next release): bump the 4 version spots → `git tag vX.Y.Z && git push origin vX.Y.Z` (triggers `.github/workflows/release.yml`, ~80 min, signed **draft**) → restart backend (`sudo systemctl restart keepance-backend`, passwordless sudo available) → cross-check website download filenames vs the real assets, set notes from CHANGELOG, `gh release edit vX.Y.Z --draft=false` → `bash infra/deploy.sh`. Backend RUNBOOK: `backend/deploy/RUNBOOK.md`.

> **⚠️ RELEASE GOTCHA (fixed, do not regress):** npm `prebuild`/`predev` asset-copy must stay **cross-platform**. The first v3.2.0 Windows build failed on a Unix-only `mkdir -p` in `copy-ocr-assets`; now consolidated into `scripts/copy-build-assets.mjs` (Node `fs`). The Linux dev rig CANNOT catch Windows-shell breakage — only a real Windows CI build does. Never use bare `cp`/`mkdir -p`/`mv` in build scripts.

## 3. What shipped this cycle (Waves 1–4, all in v3.2.0)

- **Wave 1–2** (earlier this program): wedge proof harness, OCR for scanned PDFs, Office-doc + transcript indexing, letterhead, Issue Spotter, PDF detect-and-explain, Assured-mode live exercise, vector-store hardening, trust polish.
- **Wave 3a — SSO (VG-6c):** OIDC (Entra → Google → generic, **authenticate-only**, SAML out). Backend confidential RP + Rust loopback dance. **Live-verified against a real IdP (Dex), 21/21 checkpoints.** Spec `docs/superpowers/specs/2026-06-11-wave3a-sso-oidc.md` (plan), `docs/quality/2026-06-11-wave3a-sso/`.
- **Wave 3b — encrypted vault (VG-6d-v2):** optional per-workspace AES-256-GCM, crash-safe atomic writes, BIP39 recovery + ceremony, firm-admin escrow, decrypt-everything escape hatch. New `src-tauri/crates/keepance-vault` (destructive-failure tests first). Design `docs/superpowers/specs/2026-06-11-encrypted-workspace-vault-design.md`.
- **Wave 4 — live .docx co-editing (VG-8):** OOXML tree as a **yjs** CRDT, E2EE over the relay (new `doc_id` stream), per-run text-diff binding, comments + unique `w:id` preserved on save, real cross-machine presence. `src/modules/coedit/`. Design `docs/superpowers/specs/2026-06-12-live-coediting-design.md`.

Plan of record + per-wave STATUS: **`docs/strategy/2026-06-10-vision-gap-closure-plan.md`** (every VG item has a STATUS line). Each wave: design → plan (`docs/superpowers/plans/`) → subagent-driven build, Opus reviewing every diff. Reviews caught real bugs at nearly every step (vault `.keepance/`-encrypt data-loss bug; co-edit comment-drop + corrupt `w:id`; SSO auth-hardening gaps).

## 4. Test / quality gates (all green at wrap-up)

`client (vitest) 3058 · backend (bun) 199 · keepance-vault crate 31 · keepance-docx 98 · Rust workspace 434 · tsc clean · eslint(coedit/vault/sso) clean`. SSO additionally live-verified vs Dex. Co-editing convergence (the spike's 5 cases) re-proved on the production model with **zero converter fixes**, plus chaos + offline + fidelity gates.

## 5. The ONLY remaining wave: VG-9 connectors (externally gated)

Clio → Office add-ins → NetDocuments → iManage. **Blocked on vendor sandbox access** (their developer programs need Jameson's identity/signature + the vendors' humans). Build order flexes around which access lands first. Track: `docs/operations/2026-06-10-vendor-access-track.md`. When access lands, it's a normal wave (own plan, OAuth2 sandbox round-trip, data-map honesty, claim-only-when-shipped).

## 6. Vendor / business threads (live, as of 2026-06-13)

- **Email send-as is now solved.** `keepance.com` is a Brevo-authenticated sending domain (SPF + DKIM). Use **`keepance-send`** (on PATH, see `[[reference_keepance_send]]` memory) to reply to vendors AS `jameson@keepance.com` / `developers@keepance.com` — NOT from the personal `jamesondaines@outlook.com`, which broke a vendor's lead/cadence matching. Default sender is now `jameson@keepance.com`; it BCCs `jamesondaines@outlook.com` for an inbox record (Brevo sends don't appear in Outlook "Sent"). Config: `~/.config/keepance-mail.env`. Audit: `~/.local/share/jameworld/keepance-mail-audit.jsonl`.
- **Clio (Adam Waldron, SDR):** thread RESOLVED. Diagnosed why his cadence kept firing (Jameson's 6/10 reply came from `jamesondaines@outlook.com`, not the on-file `developers@keepance.com`, so Clio's automation never matched it). Re-replied from `developers@keepance.com` (matched + stopped the cadence); Adam responded ("must have missed that last email… your best bet is the Clio Developer Hub… the developer partnership team will reach out once you sign up"); thanked him. **NEXT:** wait for Clio's developer-partnership team (already triggered by Jameson's lead) for proper API/dev access. **NOT done:** a Clio Developer account — see below.
- **iManage (Sarah Searles, Channel PM):** **Jameson completed the Microsoft Form** (the 12-question partner intake) himself. A personalized cover email was sent to Sarah from `developers@keepance.com` (acknowledging the form + a who-we-are summary + offering the discovery call). **NEXT:** await iManage's discovery-call scheduling.

## 7. Clio Developer account — deliberately NOT created (decision)

Asked to "create the account," I stopped short, on purpose. Findings: the Clio Developer Portal (`developers.clio.com`) is **sign-in only** (no self-serve dev signup); the only way to a Clio login is the **"Try Clio for free" 7-day LAW-FIRM product trial** (`app.clio.com/signup`). Creating a usable account there would require **representing Advisor Prep Hero as a law firm** (the honest "Not a Law Firm" option only captures a lead — which Jameson already did, and which started the Adam thread), plus a **phone number** (not on file) and a **reCAPTCHA + ToS agreement** on a real account in Jameson's name. I declined to fabricate a law-firm signup. **The right path is the relationship** (Clio's developer-partnership team, already in motion via Adam). If Jameson later wants a trial account anyway, he supplies the firm-size choice + phone and clears the reCAPTCHA; an AI can then take over the dev-portal app registration.

## 8. Open items — Jameson-owned (none block code)

1. **Real-hardware spot-checks** now that v3.2.0 is live (the dev rig is Linux, so these need real Windows/Mac): one **vault** enable + recover cycle; open a **co-edited `.docx` in real Microsoft Word** (the open-without-repair fidelity check); the ~5-min Windows smoke (icons, type in a new doc, Open-on-Desktop, firm sign-in, a matter-scoped citation).
2. **Vendor relationships:** Clio dev-partnership team + iManage discovery call (above); NetDocuments + Microsoft Partner Center per the vendor-access track.
3. **Proof moat (VG-7):** formed entity → executed DPA → SOC 2 → named-attorney references → one real-card purchase. The research says this is what actually gates the firm sale; it can't be coded.
4. **In-app `/admin` guard (WAVE2-FU-02 in `BACKLOG.md`):** belt-and-suspenders over the Caddy `/admin/*`→403 edge rule. Not blocking.

## 9. Operational notes / artifacts

- **DB backups:** `…/keepance-firm-backend/data/keepance-firm.sqlite.bak-pre-v3.2.0-*` (pre-deploy snapshots). Safe to keep or prune; the live DB is tiny.
- **Memory (persistent, for the next AI):** `project_keepance_3_0` (v3.2.0 live), `project_email_architecture` (send-as works via Brevo), `reference_keepance_send` (the vendor-reply CLI), `feedback_keepance_autonomous_vision` (drive the vision autonomously). All under `~/.claude/projects/-home-jameson/memory/`.
- **Build/run:** `npm run dev` / `npm run tauri dev`; backend `cd backend && bun run src/server.ts`; tests in §4.
