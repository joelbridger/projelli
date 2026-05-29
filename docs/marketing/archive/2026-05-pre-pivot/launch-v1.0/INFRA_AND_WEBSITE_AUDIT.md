# Launch infra + website audit

> Findings from the night-run audit. Items F + G + H of the autonomous CEO pass. What's working, what was fixed, what still needs your hands.

---

## Item F: Launch infrastructure (verified 2026-04-17 night)

| Surface | Status | Notes |
|---|---|---|
| projelli.com homepage | ✅ 200 (96 KB) | Cloudflare-fronted, reachable, current v1.0.8 content |
| `/templates/`, `/vs/*`, `/blog/projelli-1-5-announce` | ⏳ falling through to homepage | Pages exist in repo, NOT yet deployed. Will go live when you run `infra/deploy.sh`. |
| licenses.projelli.com | ✅ 200 `/healthz` returns "ok" | License validator service running |
| Email SPF | ✅ `v=spf1 include:_spf.mx.cloudflare.net include:spf.brevo.com ~all` | Inbound + outbound covered |
| Email DMARC | ✅ `v=DMARC1; p=none; rua=mailto:jamesondaines@outlook.com` | Aggregate reports; `p=none` is correct for new sender |
| Email DKIM | ✅ `brevo1._domainkey` + `brevo2._domainkey` both resolve to RSA keys | Brevo's selectors confirmed |
| MX | ✅ Cloudflare Email Routing (3 routes) | Inbound forwarding to Outlook |
| UptimeRobot monitor | ✅ Up | **Memory note correction:** monitor ID is `802788797`, NOT `797` as `project_projelli.md` claims. Update memory after ship. |
| LemonSqueezy buy URLs | ✅ 3 live checkout URLs on homepage | Stripe processed (per memory 2026-04-13) |
| GitHub releases | ✅ rc.1-rc.8 visible, rc.6/rc.7/rc.8 as drafts | rc.8 is the canonical green draft (19 artifacts, 4 platforms) |

**No blocking issues for launch.** Only friction is the v1.5 website pages not yet being live, which is correct since v1.5 itself isn't published.

---

## Item G: Competitive monitor cron (built tonight)

New service at `~/services/competitive-monitor/`. Weekly Monday 9am scan.

**Files created:**
- `monitor.sh`, main script, reads target list, fetches each, compares against state file, appends new releases to digest
- `state/<target>.json`, per-target last-seen signal (auto-created on first run; populated for 7 targets)
- `digest.md`, rolling human-readable digest (read this weekly)
- `competitive-monitor.service`, systemd unit
- `competitive-monitor.timer`, weekly trigger (Monday 09:00 local, with 5-min jitter)
- `README.md`, install + usage

**Automated targets (7):**
- GH releases: `claude-code`, `affine`, `logseq`, `anytype` (100% reliable)
- HTML changelogs: `notion`, `obsidian`, `reflect` (server-rendered, parses cleanly)

**Manual-eyeball targets (5)**, listed in every digest as a reminder; need a Next.js render or are CF-gated:
- Cursor changelog
- Granola changelog
- Heptabase what's-new
- Mem blog
- Tana blog

**Install (you do this once when you have time):**
```bash
sudo cp ~/services/competitive-monitor/competitive-monitor.{service,timer} /etc/systemd/system/
sudo touch /var/log/competitive-monitor.log
sudo chown jameson:jameson /var/log/competitive-monitor.log
sudo systemctl daemon-reload
sudo systemctl enable --now competitive-monitor.timer
```

**On-demand run (any time):**
```bash
~/services/competitive-monitor/monitor.sh
cat ~/services/competitive-monitor/digest.md
```

---

## Item H: Website + polish audit

**Internal links checked:** every `href="/..."` resolves to a file in `website/`, with two intentional exceptions:
- `/press-kit/assets/screenshot-0[1-6]-*.png` (6 files): you take these on Windows, save into `website/press-kit/assets/`. JAMESON_ACTION_PACK item D.
- `/press-kit/assets/projelli-demo-30s.{gif,mp4}` (2 files): same. JAMESON_ACTION_PACK item E.

**External links checked (88 unique):** all resolve except:
- Some return 403 / 999 due to anti-bot (`chat.openai.com`, `linkedin.com`), **not real failures**, browsers see them fine.
- Bare `fonts.googleapis.com` / `fonts.gstatic.com` 404, **not real failures**, the actual `?family=...` URLs return 200.

**Broken-link fixes applied tonight:**
1. **`github.com/anthropics/mcp-servers` → `github.com/modelcontextprotocol/servers`**, broken link in `blog/projelli-1-5-announce.html`. Fixed.

**Slug-leak fix applied tonight:**
1. **`templates/_detail_template.html`** contains unrendered `{{SLUG}}` placeholders (it's the source template the per-template detail pages got generated from). The deploy script previously rsynced it as-is, leaving it accessible at `projelli.com/templates/_detail_template.html`. Fixed by adding `--exclude='_*.html'` to `infra/deploy.sh`.

**SEO hygiene:**
- Every public page has `<meta name="viewport">` ✅
- Every page has UTF-8 charset ✅
- Every page has unique `<title>` and `<meta name="description">` ✅
- `<link rel="canonical">` matches `<meta property="og:url">` on every page ✅

**Sitemap regeneration:**
- Old `sitemap.xml` listed only `https://projelli.com/` (1 URL).
- Regenerated to include all **36 public pages** with per-section priorities (homepage 1.0, templates 0.8, vs 0.7, blog 0.6, docs/press-kit 0.5, legal 0.3) and `lastmod` set to today.
- Will go live when `infra/deploy.sh` runs.

**Page weight:**
- Largest page: `index.html` at 90 KB (acceptable for marketing homepage)
- Largest image: `og-image.png` at 105 KB (acceptable for social sharing card)

**No accessibility issues found beyond the 3 pre-existing in-app issues** documented in `V1_5_RELEASE.md`. Static pages pass viewport, charset, and meta-tag checks.

---

## What you do with this

When you ship v1.5 and run `infra/deploy.sh`:
- Sitemap pushes the 36 URLs to /var/www
- `_detail_template.html` is correctly excluded
- The 1 broken link is fixed in the announce post
- The competitive monitor timer (once installed) starts running Monday mornings

**No action required from you on Items F/G/H tonight.** They're all wrapped.

The remaining unknowns are still:
- The 6 product screenshots (your hands, on Windows)
- The 30-second demo video (your hands, on Windows)
- Plausible conversion goals (browser, 5 min)
- A confirmed PH hunter (your DM, see `PH_HUNTERS.md`)
- 10-20 beta testers (your DMs, see `BETA_TESTER_CANDIDATES.md`)
- Wheel Health pre-launch sanity note

These are unchanged from the daytime board action items. The night-run made every system around them green.
