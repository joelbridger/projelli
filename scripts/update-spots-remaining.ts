#!/usr/bin/env bun
/**
 * update-spots-remaining.ts
 *
 * Polls LemonSqueezy Orders API and updates the spots-remaining.json file
 * that drives the homepage Founder's Launch counter.
 *
 * Architecture: poll-based (not webhook). Runs every 5 minutes via cron.
 * Webhook approach considered but adds license-validator + systemd
 * complexity for marginal benefit (the spots counter is a marketing
 * scoreboard; 5-min lag is fine).
 *
 * What it does:
 *   1. Reads LS API key from /etc/license-validator.env
 *   2. Fetches all orders for the Keepance store, paginated
 *   3. Counts orders that:
 *      - first_order_item.variant_id == FOUNDER_LAUNCH_VARIANT_ID (1506887)
 *      - status == "paid"
 *      - refunded == false
 *      - test_mode == false
 *   4. Computes remaining = max(0, FOUNDER_TIER_CAP - sold)
 *   5. Writes updated JSON to BOTH the source path (deploy origin) and
 *      the live path (what Caddy serves)
 *
 * Usage (manual): bun ~/keepance/scripts/update-spots-remaining.ts
 * Usage (cron):   crontab entry every 5 min
 *
 * Limitation: counts only first_order_item per order. If a single buyer
 * orders 2+ Founder's Launch licenses in one transaction, only 1 counts.
 * Acceptable trade-off for $29 single-user lifetime tier.
 */

import { readFile, writeFile } from "node:fs/promises";

const FOUNDER_LAUNCH_VARIANT_ID = 1506887;
const FOUNDER_TIER_CAP = 100;
const STORE_ID = "340394";
const SOURCE_PATH = "/home/jameson/lantern/website/spots-remaining.json";
const LIVE_PATH = "/var/www/keepance.com/spots-remaining.json";
const ENV_FILE = "/etc/license-validator.env";

async function loadApiKey(): Promise<string> {
  const env = await readFile(ENV_FILE, "utf8");
  const match = env.match(/^LEMONSQUEEZY_API_KEY=(.+)$/m);
  if (!match) throw new Error("LEMONSQUEEZY_API_KEY not found in " + ENV_FILE);
  return match[1].trim().replace(/^["']|["']$/g, "");
}

interface LSOrder {
  id: string;
  attributes: {
    status: string;
    refunded: boolean;
    test_mode: boolean;
    first_order_item: {
      variant_id: number;
      product_id: number;
    };
    total: number;
    created_at: string;
    user_email: string;
  };
}

interface LSPagedResponse {
  data: LSOrder[];
  meta: { page: { currentPage: number; lastPage: number; total: number } };
  links?: { next?: string };
}

async function fetchAllOrders(apiKey: string): Promise<LSOrder[]> {
  const all: LSOrder[] = [];
  let page = 1;
  while (true) {
    const url = new URL("https://api.lemonsqueezy.com/v1/orders");
    url.searchParams.set("filter[store_id]", STORE_ID);
    url.searchParams.set("page[size]", "100");
    url.searchParams.set("page[number]", String(page));
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/vnd.api+json",
      },
    });
    if (!res.ok) throw new Error(`LS API ${res.status}: ${await res.text().catch(() => "")}`);
    const json = (await res.json()) as LSPagedResponse;
    all.push(...json.data);
    if (page >= json.meta.page.lastPage) break;
    page += 1;
  }
  return all;
}

function countFounderSales(orders: LSOrder[]): number {
  return orders.filter((o) => {
    const a = o.attributes;
    return (
      a.first_order_item?.variant_id === FOUNDER_LAUNCH_VARIANT_ID &&
      a.status === "paid" &&
      a.refunded === false &&
      a.test_mode === false
    );
  }).length;
}

async function writeSpots(remaining: number): Promise<{ updated: boolean; previous: number | null }> {
  const payload = {
    remaining,
    total: FOUNDER_TIER_CAP,
    tier: "founders-launch",
    updated_at: new Date().toISOString().slice(0, 10),
    _note: "Auto-updated by ~/keepance/scripts/update-spots-remaining.ts every 5 min via cron. Counts paid, non-refunded, non-test orders for variant " + FOUNDER_LAUNCH_VARIANT_ID + ".",
  };
  const json = JSON.stringify(payload, null, 2) + "\n";
  // Read current to detect change
  let previous: number | null = null;
  try {
    const current = JSON.parse(await readFile(SOURCE_PATH, "utf8"));
    previous = current.remaining ?? null;
  } catch {
    // file may not exist yet
  }
  await writeFile(SOURCE_PATH, json);
  // Live path may need www-data group write — try, log if fails
  try {
    await writeFile(LIVE_PATH, json);
  } catch (err) {
    console.error("[warn] could not write live path " + LIVE_PATH + ":", err instanceof Error ? err.message : String(err));
    console.error("[warn] source file updated; deploy.sh will sync on next run");
  }
  return { updated: previous !== remaining, previous };
}

async function main(): Promise<void> {
  const apiKey = await loadApiKey();
  const orders = await fetchAllOrders(apiKey);
  const sold = countFounderSales(orders);
  const remaining = Math.max(0, FOUNDER_TIER_CAP - sold);
  const { updated, previous } = await writeSpots(remaining);

  const ts = new Date().toISOString();
  if (updated) {
    console.log(`[${ts}] sold=${sold} remaining=${remaining} (was ${previous}) — UPDATED`);
  } else {
    console.log(`[${ts}] sold=${sold} remaining=${remaining} — no change`);
  }
}

await main();
