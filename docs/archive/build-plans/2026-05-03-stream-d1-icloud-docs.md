# Projelli v2.0 Stream D1: iCloud Drive + Mobile Access Documentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the v2.0 mobile-access story for users who want their Projelli workspace on phones today, before the dedicated mobile reader (D2-build) lands. Document the cloud-sync workaround for iCloud Drive, Dropbox, Syncthing, and Google Drive. Add an in-app `Settings → Mobile` page that mirrors the web docs and deep-links to the providers' iOS apps. Update README + FAQ. Capture screenshots of the workaround in action.

**Branch:** `feature/stream-d1-icloud-docs`. Branches off `master`. Fully independent of all other v2.0 streams; can land any time.

**Why D1 stands alone:** the iCloud Drive workaround is real today (point Projelli at a folder inside `~/Library/Mobile Documents/...` and your workspace syncs to all your Apple devices via iCloud). Documenting it well is a quick win that addresses the v2.0 mobile expectation without waiting on the dedicated mobile reader. This is the v2.0 mobile story; the dedicated reader (D2-build) is the v2.0 *plus*.

**Architecture:** No code changes beyond the in-app Settings page. Pure docs + screenshots + a small React component that renders markdown content shipped as a static asset.

**Tech Stack:** HTML/CSS for the website docs, React + shadcn for the in-app page, Tailwind for styling, no new dependencies.

**Spec reference:** `docs/superpowers/specs/2026-04-28-v2.0-mega-release-design.md` section 7.2.

---

## File Structure

### Files to create

| Path | Purpose |
|---|---|
| `website/docs/mobile-access/index.html` | Public docs hub linked from projelli.com nav |
| `website/docs/mobile-access/icloud.html` | Step-by-step iCloud Drive setup |
| `website/docs/mobile-access/dropbox.html` | Step-by-step Dropbox setup |
| `website/docs/mobile-access/syncthing.html` | Step-by-step Syncthing setup |
| `website/docs/mobile-access/google-drive.html` | Step-by-step Google Drive setup |
| `website/docs/mobile-access/screenshots/` | iOS Files screenshots showing a Projelli workspace |
| `src/components/settings/MobileSettingsPage.tsx` | In-app `Settings → Mobile` page; mirrors web content |
| `src/components/settings/MobileSettingsPage.module.css` | Optional styles if Tailwind isn't enough |
| `tests/unit/components/settings/MobileSettingsPage.test.tsx` | Renders, deep links work |

### Files to modify

| Path | Change |
|---|---|
| `src/components/settings/SettingsModal.tsx` | Add a "Mobile" item to the nav (between Marketplace and About). Mount `<MobileSettingsPage />` |
| `~/projelli/website/index.html` (nav) | Add "Mobile access" link in docs/help section |
| `~/projelli/website/docs/faq.html` | Add 2 FAQ items: "Can I use Projelli on my phone?" + "Will there be a Projelli mobile app?" |
| `README.md` | Add a "Mobile access" section pointing to the docs |

### Files to NOT modify

- App runtime code beyond the new Settings page
- WorkspaceService or filesystem layer (the workaround uses existing path-pointing behavior)
- Other streams' files

---

## Task Decomposition

There are 4 task groups.

- Group I: Web docs (5 HTML pages + screenshots)
- Group II: In-app Settings → Mobile page
- Group III: README + FAQ updates
- Group IV: Lint + commit + final PR

---

## Group I: Web docs (5 HTML pages + screenshots)

- [ ] **Task 1.1** — `website/docs/mobile-access/index.html`. Hub: short intro framing ("the v2.0 mobile story; dedicated mobile reader in beta"), grid of 4 provider cards each linking to its setup page, FAQ-style "which one should I pick" decision matrix at the bottom.
- [ ] **Task 1.2** — `website/docs/mobile-access/icloud.html`. Steps:
  1. Open Files on iPhone, enable iCloud Drive.
  2. On Mac, in Projelli, set workspace to `~/Library/Mobile Documents/com~apple~CloudDocs/Projelli/`.
  3. Wait for sync.
  4. On iPhone Files, navigate to iCloud Drive → Projelli, see your files.
  5. Limitations: read-only realistically, manual conflict resolution if both devices edit.
  Include 2 screenshots (Mac Projelli pointing at iCloud folder, iPhone Files showing the synced workspace).
- [ ] **Task 1.3** — `website/docs/mobile-access/dropbox.html`. Same shape, Dropbox-specific paths and links to the iOS Dropbox app.
- [ ] **Task 1.4** — `website/docs/mobile-access/syncthing.html`. Same shape, Syncthing-specific (more advanced; for users who want LAN sync without third-party cloud).
- [ ] **Task 1.5** — `website/docs/mobile-access/google-drive.html`. Same shape, Google Drive-specific (with the Google Drive desktop app caveat).
- [ ] **Task 1.6** — Screenshots: take real screenshots OR use the existing `website/docs/getting-started.html`-style placeholder pattern (boxed image with caption); for v2.0 launch the placeholder is fine if real screenshots aren't available, with a TODO note for Jameson to swap in real ones.
- [ ] **Task 1.7** — All HTML pages pass website-content-lint: no em dashes, no banned marketing words, contains canonical link tag.

## Group II: In-app Settings → Mobile page

- [ ] **Task 2.1** — `src/components/settings/MobileSettingsPage.tsx`. Renders the same content structure as the web docs, in-app. Use shadcn Tabs for the four providers. Each tab renders the steps list + key tips.
- [ ] **Task 2.2** — Deep links: the iCloud tab has a "Open in Files" button that links to `shareddocuments://`; the Dropbox tab links to `dbapi-2://1/connect`; etc. Where the deep link is unclear, omit (better than broken).
- [ ] **Task 2.3** — Mount in `SettingsModal.tsx` between Marketplace and About in the nav.
- [ ] **Task 2.4** — Tests `MobileSettingsPage.test.tsx`. Each tab renders. Deep-link button has correct href.

## Group III: README + FAQ updates

- [ ] **Task 3.1** — Modify `README.md` (root): add "Mobile access" section linking to `https://projelli.com/docs/mobile-access/`.
- [ ] **Task 3.2** — Modify `website/docs/faq.html`: add 2 FAQ items:
  - "Can I use Projelli on my phone?" → Short answer + link to `/docs/mobile-access/`.
  - "Will there be a Projelli mobile app?" → Short answer about the dedicated reader (in development for v2.0; TestFlight beta info if available; otherwise "in beta soon").
- [ ] **Task 3.3** — Modify `website/index.html` nav (or template) to add a "Mobile access" link in the docs/help section.

## Group IV: Lint + commit + final PR

- [ ] **Task 4.1** — Run `tests/unit/website-content-lint.test.ts` against the new files. All pass.
- [ ] **Task 4.2** — `npm run typecheck`, `npm run test`, `npm run lint` clean.
- [ ] **Task 4.3** — Update `~/projelli-worktrees/stream-d1-icloud-docs/CHANGELOG.md` under `[Unreleased]`.
- [ ] **Task 4.4** — Open the D1 PR via `gh`:
  ```
  gh pr create --repo projelli/projelli \
    --base master \
    --head feature/stream-d1-icloud-docs \
    --title "feat(stream-d): iCloud Drive + mobile access docs (v2.0)"
  ```
  PR body: spec reference §7.2, plan reference, smoke test instructions (visit `/docs/mobile-access/`, navigate the four provider pages; in-app, open Settings → Mobile, switch tabs).

---

## Acceptance criteria

- A user wondering "can I use Projelli on my phone today?" finds the answer in two clicks (homepage → Mobile access).
- The four provider setup pages each have clear, actionable steps + screenshots (or placeholder boxes).
- The in-app Settings → Mobile page mirrors the web content.
- README + FAQ link out to the docs.
- All HTML lint clean.

---

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Real screenshots unavailable at PR time | Placeholder boxes with TODO note; Jameson can swap in real screenshots later. |
| Deep-link schemes change between iOS versions | Document only the most stable ones; omit unclear ones. |
| Users misinterpret as "mobile app shipping" | Hub page explicitly frames as "v2.0 mobile story; dedicated reader in beta". FAQ also frames clearly. |
| Sync conflicts in iCloud lose user data | Documentation explicitly warns: edit on one device at a time; mobile is read-mostly initially. |

---

## Out of scope

- Dedicated mobile reader (D2-build)
- Tauri 2 mobile spike (D-spike)
- Web demo sandbox (D-web)
- Real-time sync engineering

---

## Definition of done

- All 4 task groups completed.
- One PR opened.
- CHANGELOG entry under `[Unreleased]`.

---

## Dispatch hints

- Worktree: `cd ~/projelli && git worktree add ~/projelli-worktrees/stream-d1-icloud-docs -b feature/stream-d1-icloud-docs master`. Then `npm install`.
- Pass plan path: `/home/jameson/projelli/docs/superpowers/plans/2026-05-03-stream-d1-icloud-docs.md`.
- Smallest plan in v2.0. One implementer dispatch can probably finish all 4 groups in ~15-20 minutes.
