# Runbook: custom checkout domain (checkout.keepance.com)

**Goal:** customers pay on `checkout.keepance.com`, not `projelli.lemonsqueezy.com` — kills the brand leak at the most trust-sensitive step.

**Status (2026-06-01): PREPPED, not executed.** Blocked on the LS side, not ours. See "Why it's blocked" below. This is Tier-3 polish with zero live traffic, so it's safe to defer until the blockers clear.

## Why it's blocked right now
- **No LS API for custom domains** — it's a dashboard-only setting.
- **The LS domains settings path redirects to /dashboard** (`app.lemonsqueezy.com/settings/domains` bounced). The custom-domain UI wasn't reachable there. Likely either a different path under the store settings, or gated behind store status. The account currently shows an **"application under review"** banner (the Guesslet store's activation), and another agent was actively on the shared LS dashboard at the time, so I did not drive it.
- **DNS token scope:** `~/.cloudflare-keepance-token` is Zone:Read only (it lists the zone but 401s on DNS records). The DNS step needs the **global CF key** (in `reference_cloudflare_api` memory: `X-Auth-Email: jamesondaines@outlook.com` + `X-Auth-Key: cfk_...`) or a new DNS-edit token for the keepance.com zone (id `b12c60acef16317a66994606f79792e2`).

## Do it in one clean pass when the LS dashboard is free + the store is approved

1. **LS dashboard (Jameson or a clear CDP window):** in the **Advisor Prep Hero/projelli** store (switch store first; do NOT do this while another agent is in the Guesslet context), find Settings → Domains (or Store settings → Custom domain). Add `checkout.keepance.com`. LS will show a CNAME target (e.g. `cname.lemonsqueezy.com` or a store-specific host) and possibly a TXT verification record.

2. **DNS (Cloudflare, keepance.com zone `b12c60acef16317a66994606f79792e2`):** add the CNAME LS gives you. **Set it DNS-only (grey cloud, `"proxied": false`)** so LS can provision its own SSL cert — a proxied (orange-cloud) record will break LS's cert issuance. Add any TXT record LS asks for. Example with the global key:
   ```bash
   curl -s -X POST "https://api.cloudflare.com/client/v4/zones/b12c60acef16317a66994606f79792e2/dns_records" \
     -H "X-Auth-Email: jamesondaines@outlook.com" \
     -H "X-Auth-Key: <global key from reference_cloudflare_api>" \
     -H "Content-Type: application/json" \
     -d '{"type":"CNAME","name":"checkout","content":"<LS cname target>","proxied":false}'
   ```

3. **Verify in LS:** wait for LS to verify DNS + provision SSL (minutes to a couple hours). Confirm the domain shows "active/verified" in the LS dashboard, and `https://checkout.keepance.com` loads a checkout.

4. **Update the site checkout links + deploy (ONLY after step 3 is green):** in `website-keepance/index.html`, swap the 4 checkout hrefs from `https://projelli.lemonsqueezy.com/checkout/buy/...` to `https://checkout.keepance.com/checkout/buy/...` (keep the variant UUIDs + the `?checkout[discount_code]=FOUNDING` query intact). The Plausible Buy-Click handler already matches `checkout.keepance.com`, so no JS change needed. Then `cp website-keepance/index.html website/index.html && bash infra/deploy.sh --skip-demo`. **Do not deploy the new links before the domain is verified, or checkout breaks.**

5. **Verify live:** each Buy button on keepance.com lands on a working `checkout.keepance.com` page at the right price.

## The 4 checkout URLs to swap (current)
- Personal: `.../checkout/buy/4df43939-9d7f-4acb-b289-1ab63a65532c`
- Professional: `.../checkout/buy/78ee592e-8f8a-4ce4-9ea4-68a84032d21a`
- Professional + FOUNDING discount: same as Professional + `?checkout%5Bdiscount_code%5D=FOUNDING`
- Practice: `.../checkout/buy/b4c6865f-a435-43c9-82b1-14d6b4f18059`

## Never
- Never change the LS store **slug** (`projelli`) — it's baked into every existing checkout URL.
- Never deploy the `checkout.keepance.com` site links before LS verifies the domain.
- Never set the checkout CNAME to proxied (orange cloud) — it breaks LS SSL.
