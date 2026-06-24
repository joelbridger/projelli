# Keepance — Current State: Advisor Re-aim (Website + Board + App)
**Date:** 2026-06-24 · **Author:** Claude (Opus 4.8) session · **Audience:** the next human or AI picking this up

> Read this first. It's the honest snapshot of what's live, where everything lives, and what's left.
> For the older app-side advisor re-aim detail, see the project memory `project_keepance_advisor_reaim`.

---

## 1. TL;DR (what's true right now)

Keepance is re-aimed from **law firms → financial advisors**. As of today three things are **live**:

1. **keepance.com** — fully advisor-focused homepage (no attorney/tax/consultant funnel).
2. **board.jameworld.com** — the private board dashboard now has a **Demo** tab (the advisor demo walkthrough).
3. **The desktop app (keepance-3.0)** — advisor-default, with 4 robustness fixes merged + gate-green.

Everything is committed and pushed. Git trees are clean.

---

## 2. The website (keepance.com) — LIVE

**⭐ Canonical source = branch `marketing/website-repositioning`, worktree `~/keepance-wt-website`.**
This is Jameson's hand-built version (hero: *"Secure client intelligence for high-trust work"*, with a live animated Client Map and the star-less logo). **Build off THIS branch, not `keepance-3.0`'s `website/` and not the abandoned `feat/website-advisor-rewrite` draft.**

**What it looks like now (top to bottom):**
- Nav (every page): **Security · Pricing · Blog · Start free trial**. No Attorneys/Advisors/Tax/Consultants.
- Hero: *"Secure client intelligence for high-trust work"*; hero image shows a **Client Map** (see §5 open item).
- Feature rows incl. **"Meet with confidence"** (walk into meetings knowing the client; cited pre-meeting recall demo).
- A live **Client Map animation** (scroll-loaded iframe, `#client-map`) — see §4.
- 3 **compliance columns** (data out of a vendor's hands / Reg S-P verify with counsel / work product yours to keep).
- **"How Keepance fits"** (the comparison table vs Jump / eMoney AI / ChatGPT) — was "How Keepance compares".
- **Advisor Practice Pack** (7 templates, streamlined) — now sits *below* "How Keepance fits".
- Pricing, footer.

**Standalone profession pages:** `/legal/`, `/tax/`, `/consulting/` page files are **kept on disk but unlinked** from the advisor funnel (so the **live lawyer-outreach campaign** links to `/legal/` still work). `/financial-advisors/` was **deleted** (its 3 best sections were folded into the homepage); it now serves a clean "page not found".

**Nav is driven two ways** (important for "stale nav" bugs):
- `website/scripts/keepance-nav.vN.js` builds the nav on all secondary pages (currently **v5**).
- `index.html` has its **own inline** nav.
- If you change nav items, bump the script filename (v5 → v6) and update refs, or browsers serve the cached old nav. (That was the 2026-06-24 "nav still old on other pages" bug — fixed by the v4→v5 bump.)

**Deploy the website:**
```bash
bash ~/keepance-wt-website/infra/deploy.sh --skip-demo   # rsync website/ -> /var/www/keepance.com + Cloudflare purge
```
`--skip-demo` avoids rebuilding the /try/ web-demo. Deploy reads from the worktree the script lives in (so run the one in `~/keepance-wt-website`). Live in ~30s after CF purge.

**Backups / rollback:**
- Live site before this work: `~/backups/livesite-keepance.com-pre-advisor-deploy-2026-06-24.tgz`
- His website branch snapshot: `~/backups/website-repositioning-2026-06-24.tgz` + git tag `backup/website-repositioning-2026-06-24`
- Old legal hero image is in git history (commit `32f42003`).

---

## 3. The board dashboard (board.jameworld.com) — LIVE, now with a Demo tab

**Source:** `~/keepance/docs/board/` (`board-data.json` = content, `index.html` = renderer). Served by a Bun+Hono app at `~/board/` behind the Jameworld login.

**New this session:** a **"Demo" tab** (2nd tab, after Overview). It lays out the advisor demo in **4 beats**, each as **Do / Say / Proves**:
1. Onboard as an advisor → 2. Import a client's files → 3. The Client Map builds itself → 4. Ask the file anything (cited answers). Plus run-it tips. (This is the flow Jameson asked for: onboarding → import → client map(s) → AI search.)

**Edit the Demo:** change the `demo` section in `board-data.json` (it has `now`, `intro`, `steps[]` with `n/title/do/say/proves`, `tips[]`). The renderer is `renderDemo()` in `index.html` (type `"demo"`).

**Deploy the board:**
```bash
bash ~/keepance/docs/board/deploy.sh   # copies board-data.json + index.html to ~/board/public/
```

---

## 4. The Client Map animation (homepage `#client-map`)

**Lives at `~/keepance-wt-website/website/client-map-animation/`** — self-contained: `index.html` (the animation), `gsap.min.js` (local), `build.py` (regenerator), `README.md` (full explainer + design decisions). Approved by Jameson 2026-06-24 ("final version for now").

It's embedded on the homepage as a **scroll-loaded iframe** (loads + plays when the section enters view). To edit the animation, edit `build.py` then `python3 build.py` (regenerates index.html in place).

> Note: `build.py` + `README.md` currently deploy publicly too (harmless, obscure URL, animation is `noindex`). If you want them off the live site, exclude them in `infra/deploy.sh` or move them out of `website/`.

---

## 5. ⚠️ Open item: the hero image

The hero currently uses a **frame of the approved Client Map animation** (the "Smith household" dossier). **The app DOES have a real Client Map view** (`src/features/matters/ClientMapView.tsx`; open a client → "Open Client Map"). Jameson may prefer the hero to be the **live app** Client Map screen.

When ready to swap: on the Legion (`james@100.127.67.22`), open the Hendricks client → Open Client Map, let it finish building, capture cleanly (`scripts/legion-drive.sh screenshot ...`), convert to `website/images/hero-app.png`, redeploy. (This session's live capture was blocked because the app's map was mid-rebuild + SSH was flaky.)

---

## 6. The desktop app (keepance-3.0) — advisor-default, gate-green

Branch `keepance-3.0`, HEAD `223465d8` (the board commit; last **app-code** change was `a3102dc4`, which passed `npm run gate`). Advisor re-aim merged earlier this session:
- Index externally-added files on folder-assign (live disk scan).
- Valid-key-aware AI provider/model resolution (Ask / at-a-glance / Client Map / workflow).
- Feature the active profession's workflow pack first.
- (Plus the earlier advisor facade, sample Hendricks household, prompts, etc. — see `project_keepance_advisor_reaim`.)

Gate: `cd ~/keepance && npm run gate` (~10-15 min; "✅ GATE GREEN"). The website + board changes do **not** touch the app gate.

---

## 7. Worktree map (what each is)

| Worktree | Branch | What |
|---|---|---|
| `~/keepance` | `keepance-3.0` | Main app + docs/board source. Canonical. |
| `~/keepance-wt-website` | `marketing/website-repositioning` | **Canonical website** (live on keepance.com). |
| `~/keepance-wt-onboarding` | `feat/onboarding-journey` | Un-merged onboarding work (PR #33). |
| `~/kp-wt-wealthbox` | `feat/advisor-wealthbox` | Paused Wealthbox connector WIP. |
| `~/keepance-bug099` | `fix/bug099-robust` | Older bug worktree. |
| `.claude/worktrees/agent-*` | — | Harness-managed agent worktrees (auto-clean). |

Pruned this session: `kp-wt-website2` (abandoned `feat/website-advisor-rewrite` draft — branch kept in git; its notes file `docs/strategy/2026-06-24-website-advisor-rewrite-notes.md` has 7 regulatory claims flagged for compliance review, recoverable from that branch).

---

## 8. Landmines / gotchas

- ⛔ **Never rename `matter`/`matter_id`/`SAMPLE_MATTER_ID`/`keepance:matters`** in app code — it's the RAG security isolation key. The advisor experience is a label facade only.
- 🧭 **Nav cache:** changing nav items needs a script-version bump (see §2), or browsers show stale nav.
- 📋 **Regulatory copy** (Reg S-P / Reg BI) on the site should get a **securities-compliance review** before any big push. The homepage hedges ("verify with your compliance counsel"); the 7 specific claims are in the pruned advisor-rewrite branch's notes file.
- 🪟 **Windows testing is the AI's job** (Legion `james@100.127.67.22`); the demo bench is workspace `C:\keepance-demo-hendricks`, Hendricks matter `matter_06f31a58-39a8-4045-bcd3-1cbac26209bb`. SSH can be flaky — retry.
- 🚫 No em dashes in public-facing copy. Light theme only.

---

## 9. Suggested next steps

1. Decide the **hero**: keep the animation dossier, or swap to the live app Client Map view (§5).
2. **Securities-compliance review** of the site's Reg S-P / Reg BI wording before any marketing push.
3. Resume the **Wealthbox connector** (Tier-1 integration) cleanly from `~/kp-wt-wealthbox`.
4. Optional: keep the app's Client Map view front-and-center (it's now the headline feature).
