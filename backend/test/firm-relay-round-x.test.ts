import { afterEach, describe, expect, test } from "bun:test";
import { config } from "../src/lib/config.ts";
import { Store } from "../src/lib/db.ts";
import { issueAuthTokens } from "../src/lib/services.ts";
import { MAX_WRAPPED_KEYS_PER_PUBLISH, decodeWrappedKeyEnvelope } from "../src/lib/wrappedKeyEnvelope.ts";
import { handlePublishIntakeKeys } from "../src/routes/intakeKeys.ts";
import { handlePublishMatterKeys } from "../src/routes/matterKeys.ts";
import { handleRemoveMatterMember, handleSetWall } from "../src/routes/matters.ts";

const wrappedEnvelope = decodeWrappedKeyEnvelope(Buffer.from([0x4c, 0x57, 0x4b, 1, 4, ...new Array(140).fill(0)]).toString("base64"))!;
const wrappedKeyB64 = Buffer.from(wrappedEnvelope).toString("base64");
const originalIntakeCap = config.firmMatterIntakeHandleCap;
const originalIntakeRateMax = config.firmMatterIntakePublishRateLimitMax;

afterEach(() => {
  (config as { firmMatterIntakeHandleCap: number }).firmMatterIntakeHandleCap = originalIntakeCap;
  (config as { firmMatterIntakePublishRateLimitMax: number }).firmMatterIntakePublishRateLimitMax = originalIntakeRateMax;
});

function intakeHandle(char: string) { return `ih2_${char.repeat(43)}`; }

function fixture() {
  const store = new Store(":memory:");
  const org = store.createOrg({ name: "Round X relay guards", plan: "practice", packs: [], seat_limit: 8 });
  const admin = store.createUser({ org_id: org.org_id, email: `admin-${crypto.randomUUID()}@round-x.test`, password_hash: "x", role: "admin" });
  const target = store.createUser({ org_id: org.org_id, email: `target-${crypto.randomUUID()}@round-x.test`, password_hash: "x", role: "member" });
  const keeper = store.createUser({ org_id: org.org_id, email: `keeper-${crypto.randomUUID()}@round-x.test`, password_hash: "x", role: "member" });
  for (const user of [target, keeper]) {
    store.upsertDevice({ device_id: `${user.user_id}-device`, user_id: user.user_id, org_id: org.org_id, machine_id: `${user.user_id}-machine`, label: "", pubkey_jwk: "{}" });
  }
  const matter = store.createMatter({ org_id: org.org_id });
  store.activateProvisioningMatter(matter.matter_handle);
  for (const user of [target, keeper]) {
    store.addMatterMember({ matter_handle: matter.matter_handle, user_id: user.user_id, org_id: org.org_id, role: "editor" });
  }
  return { store, org, admin, target, keeper, matter, adminToken: issueAuthTokens(store, admin).access_token };
}

function request(token: string, body: unknown) {
  return new Request("http://relay.test/v2/firm/route", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function recipient(user: { user_id: string }) {
  return { user_id: user.user_id, device_id: `${user.user_id}-device`, wrapped_key_b64: wrappedKeyB64 };
}

async function publishIntake(f: ReturnType<typeof fixture>, handle: string, wrapped = [recipient(f.keeper)]) {
  return handlePublishIntakeKeys(request(f.adminToken, { matter_handle: f.matter.matter_handle, epoch: 1, wrapped }), f.store, handle);
}

function storeCurrentKeys(f: ReturnType<typeof fixture>) {
  f.store.upsertWrappedMatterKey({ matter_handle: f.matter.matter_handle, epoch: 1, user_id: f.keeper.user_id, device_id: `${f.keeper.user_id}-device`, wrapped_key: wrappedEnvelope, published_by: f.admin.user_id });
  expect(f.store.publishWrappedIntakeKeys({
    intake_handle: intakeHandle("K"), matter_handle: f.matter.matter_handle, org_id: f.org.org_id, epoch: 1, published_by: f.admin.user_id,
    wrapped: [{ user_id: f.keeper.user_id, device_id: `${f.keeper.user_id}-device`, wrapped_key: wrappedEnvelope }],
  })).toMatchObject({ stored: 1 });
}

function intakeKeyCount(f: ReturnType<typeof fixture>, userId?: string) {
  const rows = userId
    ? f.store.inspectReadOnly().all("SELECT intake_handle FROM wrapped_intake_keys WHERE matter_handle = ? AND user_id = ?", f.matter.matter_handle, userId)
    : f.store.inspectReadOnly().all("SELECT intake_handle FROM wrapped_intake_keys WHERE matter_handle = ?", f.matter.matter_handle);
  return rows.length;
}

function matterKeyCount(f: ReturnType<typeof fixture>) {
  return f.store.inspectReadOnly().all("SELECT user_id FROM wrapped_matter_keys WHERE matter_handle = ?", f.matter.matter_handle).length;
}

function createActiveMatter(f: ReturnType<typeof fixture>) {
  const matter = f.store.createMatter({ org_id: f.org.org_id });
  f.store.activateProvisioningMatter(matter.matter_handle);
  f.store.addMatterMember({ matter_handle: matter.matter_handle, user_id: f.keeper.user_id, org_id: f.org.org_id, role: "editor" });
  return matter;
}

describe("round X firm relay availability guards", () => {
  test("refuses a new intake binding above the configured matter cap without writing it", async () => {
    (config as { firmMatterIntakeHandleCap: number }).firmMatterIntakeHandleCap = 1;
    const f = fixture();
    expect((await publishIntake(f, intakeHandle("A"))).status).toBe(200);
    const rejected = await publishIntake(f, intakeHandle("B"));
    expect(rejected.status).toBe(409);
    expect(await rejected.json()).toEqual({ error: "intake_limit_reached" });
    const rows = f.store.inspectReadOnly().all("SELECT intake_handle FROM wrapped_intake_keys WHERE matter_handle = ? ORDER BY intake_handle", f.matter.matter_handle) as Array<{ intake_handle: string }>;
    expect(rows).toEqual([{ intake_handle: intakeHandle("A") }]);
    f.store.close();
  });

  test("rate-limits repeated intake publishes for one firm", async () => {
    (config as { firmMatterIntakePublishRateLimitMax: number }).firmMatterIntakePublishRateLimitMax = 1;
    const f = fixture();
    expect((await publishIntake(f, intakeHandle("C"))).status).toBe(200);
    const rejected = await publishIntake(f, intakeHandle("C"));
    expect(rejected.status).toBe(429);
    expect(await rejected.json()).toEqual({ error: "rate_limited" });
    f.store.close();
  });

  test("rejects oversized wrapped arrays before either key table is written", async () => {
    const f = fixture();
    const oversized = Array.from({ length: MAX_WRAPPED_KEYS_PER_PUBLISH + 1 }, () => recipient(f.keeper));
    const intake = await publishIntake(f, intakeHandle("D"), oversized);
    expect(intake.status).toBe(400);
    expect(await intake.json()).toEqual({ error: "invalid_v2_payload" });
    expect(intakeKeyCount(f)).toBe(0);

    const matter = await handlePublishMatterKeys(request(f.adminToken, { epoch: 1, wrapped: oversized }), f.store, f.matter.matter_handle);
    expect(matter.status).toBe(400);
    expect(await matter.json()).toEqual({ error: "invalid_v2_payload" });
    expect(matterKeyCount(f)).toBe(0);
    f.store.close();
  });

  test("a duplicate wall leaves the epoch and other members' current keys alone", async () => {
    const f = fixture();
    storeCurrentKeys(f);
    f.store.setEthicalWall({ matter_handle: f.matter.matter_handle, user_id: f.target.user_id, org_id: f.org.org_id, created_by: f.admin.user_id });

    const response = await handleSetWall(request(f.adminToken, { user_id: f.target.user_id }), f.store, f.matter.matter_handle);
    expect(await response.json()).toEqual({ ok: true, walled: true, key_epoch: 1 });
    expect(f.store.getMatter(f.matter.matter_handle)?.key_epoch).toBe(1);
    expect(f.store.getWrappedMatterKey(f.matter.matter_handle, 1, f.keeper.user_id, `${f.keeper.user_id}-device`)).not.toBeNull();
    expect(intakeKeyCount(f, f.keeper.user_id)).toBe(1);
    expect(JSON.parse(f.store.listAudit(f.org.org_id)[0]?.detail ?? "null")).toMatchObject({ op: "wall_set", count: 0, epoch: 1 });
    f.store.close();
  });

  test("removing a non-member leaves the epoch unchanged", async () => {
    const f = fixture();
    expect(f.store.removeMatterMember(f.matter.matter_handle, f.target.user_id)).toBe(true);
    const response = await handleRemoveMatterMember(request(f.adminToken, { user_id: f.target.user_id }), f.store, f.matter.matter_handle);
    expect(await response.json()).toEqual({ ok: true, removed: false, key_epoch: 1 });
    expect(f.store.getMatter(f.matter.matter_handle)?.key_epoch).toBe(1);
    f.store.close();
  });

  test("a first wall still rotates the epoch and clears the prior key sets", async () => {
    const f = fixture();
    storeCurrentKeys(f);
    const response = await handleSetWall(request(f.adminToken, { user_id: f.target.user_id }), f.store, f.matter.matter_handle);
    expect(await response.json()).toEqual({ ok: true, walled: true, key_epoch: 2 });
    expect(f.store.getWrappedMatterKey(f.matter.matter_handle, 1, f.keeper.user_id, `${f.keeper.user_id}-device`)).toBeNull();
    expect(intakeKeyCount(f)).toBe(0);
    f.store.close();
  });

  test("a first member removal still rotates the epoch and clears the prior key sets", async () => {
    const f = fixture();
    storeCurrentKeys(f);
    const response = await handleRemoveMatterMember(request(f.adminToken, { user_id: f.target.user_id }), f.store, f.matter.matter_handle);
    expect(await response.json()).toEqual({ ok: true, removed: true, key_epoch: 2 });
    expect(f.store.getWrappedMatterKey(f.matter.matter_handle, 1, f.keeper.user_id, `${f.keeper.user_id}-device`)).toBeNull();
    expect(intakeKeyCount(f)).toBe(0);
    f.store.close();
  });

  test("keeps an intake handle bound through rotation and permits its new-epoch key fetch", async () => {
    const f = fixture();
    const otherMatter = createActiveMatter(f);
    const handle = intakeHandle("L");
    expect((await publishIntake(f, handle)).status).toBe(200);

    expect((await handleSetWall(request(f.adminToken, { user_id: f.target.user_id }), f.store, f.matter.matter_handle)).status).toBe(200);
    expect(intakeKeyCount(f)).toBe(0);

    const rebound = await handlePublishIntakeKeys(
      request(f.adminToken, { matter_handle: otherMatter.matter_handle, epoch: 1, wrapped: [recipient(f.keeper)] }),
      f.store,
      handle,
    );
    expect(rebound.status).toBe(409);
    expect(await rebound.json()).toEqual({ error: "intake_matter_mismatch" });

    const republished = await handlePublishIntakeKeys(
      request(f.adminToken, { matter_handle: f.matter.matter_handle, epoch: 2, wrapped: [recipient(f.keeper)] }),
      f.store,
      handle,
    );
    expect(republished.status).toBe(200);
    expect(f.store.fetchWrappedIntakeKeyForAccess({
      intake_handle: handle,
      org_id: f.org.org_id,
      user_id: f.keeper.user_id,
      role: "member",
      device_id: `${f.keeper.user_id}-device`,
    })).toMatchObject({ ok: true, epoch: 2, key: { wrapped_key: wrappedEnvelope } });
    f.store.close();
  });

  test("does not free permanent intake-handle capacity when rotation purges wrapped keys", async () => {
    (config as { firmMatterIntakeHandleCap: number }).firmMatterIntakeHandleCap = 1;
    const f = fixture();
    expect((await publishIntake(f, intakeHandle("M"))).status).toBe(200);

    expect((await handleRemoveMatterMember(request(f.adminToken, { user_id: f.target.user_id }), f.store, f.matter.matter_handle)).status).toBe(200);
    expect(intakeKeyCount(f)).toBe(0);
    expect(f.store.countDistinctIntakeHandles(f.matter.matter_handle)).toBe(1);

    const rejected = await handlePublishIntakeKeys(
      request(f.adminToken, { matter_handle: f.matter.matter_handle, epoch: 2, wrapped: [recipient(f.keeper)] }),
      f.store,
      intakeHandle("N"),
    );
    expect(rejected.status).toBe(409);
    expect(await rejected.json()).toEqual({ error: "intake_limit_reached" });
    f.store.close();
  });
});
