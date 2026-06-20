# Keepance Board Dashboard

A private, board-level view of where Keepance is and where it's going — the place
for strategy, research, insights, and decisions that span more than one work session.
Jameson reads it as the **Board of Directors**; Claude reports into it as **CEO**.

- **Live (private):** https://board.jameworld.com — behind the normal Jameworld login
  (one login covers it; the page itself is gated, not just its data).
- **Source of truth:** [`board-data.json`](./board-data.json) — all nine areas live here.
- **Design:** [`index.html`](./index.html) — renders the JSON into the polished page.

## The nine areas
Strategy & Vision · Marketing · Sales · Growth & Traction · Competitive & Market ·
Engineering · UX · UI · Finance & Metrics.

Each area has: **Where we are now** (the current position), **Recent key decisions**,
and **Insights & open ideas**.

## When a Claude session should update it (HIGH BAR)
Do **not** update this on routine work. Only add to it for one of these:
- a **major decision** (strategy, pricing, positioning, a real go/no-go),
- a **validated insight** or important research finding,
- a **strategy shift**, or
- a **real milestone** (a launch, first customer, a key partnership).

Everyday coding, small fixes, and normal progress never touch this file. Jameson
maintains it freely between sessions; agents only contribute on the big stuff.

## How to update it
1. Edit [`board-data.json`](./board-data.json) — add a bullet to a section's
   `decisions` or `insights`, or refresh its `now`. Bump `meta.lastUpdated`.
2. Keep entries plain and board-readable (no code, paths, or jargon). Be accurate;
   never invent metrics.
3. Publish: `bash docs/board/deploy.sh`

## How it's hosted (for engineers)
The content lives in this repo. A tiny Bun + Hono service at `~/board/` serves the
copied files at `board.jameworld.com`, gating every route on the shared Jameworld
`auth_token` JWT (same pattern as Career Coach, but the HTML itself is protected).
`deploy.sh` copies `board-data.json` + `index.html` into `~/board/public/`.
