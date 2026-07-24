import { afterEach, describe, expect, test } from "bun:test";
import { config } from "../src/lib/config.ts";
import { Store } from "../src/lib/db.ts";
import { authenticate } from "../src/lib/http.ts";
import { issueAuthTokens, mintSeatToken } from "../src/lib/services.ts";
import { handleTestFirmProvision, handleTestFirmRetirement } from "../src/routes/privileged.ts";

const originalSecret = config.testFirmProvisioningSecret;
const mutableConfig = config as { testFirmProvisioningSecret: string };

afterEach(() => {
  mutableConfig.testFirmProvisioningSecret = originalSecret;
});

function request(secret?: string, body?: string): Request {
  return new Request("http://test/admin/test-firm", {
    method: "POST",
    headers: secret === undefined ? {} : { "x-test-firm-provisioning-secret": secret, "content-type": "application/json" },
    body,
  });
}

describe("fixed TEST firm inner provisioning boundary", () => {
  test("uses one indistinguishable pre-body-read refusal for absent or bad credentials", async () => {
    mutableConfig.testFirmProvisioningSecret = "provisioning-secret";
    for (const secret of [undefined, "", "wrong", " "]) {
      let read = false;
      const trap = {
        headers: new Headers(secret === undefined ? {} : { "x-test-firm-provisioning-secret": secret }),
        text: async () => { read = true; throw new Error("must not read"); },
      } as unknown as Request;
      const response = await handleTestFirmProvision(trap, new Store(":memory:"));
      expect(response.status).toBe(401);
      expect(await response.text()).toBe('{"error":"unauthorized"}');
      expect(read).toBe(false);
    }
  });

  test("creates exactly one redacted no-charge firm and retirement revokes its live authority", async () => {
    const store = new Store(":memory:");
    const secret = "provisioning-secret";
    const password = "a safe Lantern test password";
    const license = "ABCD-EFGH-IJKL-MNOP-QRST-UVWX-YZ12-3456";
    mutableConfig.testFirmProvisioningSecret = secret;

    const created = await handleTestFirmProvision(request(secret, JSON.stringify({ password, license_key: license })), store);
    expect(created.status).toBe(201);
    const createdBody = await created.text();
    expect(createdBody).not.toContain(password);
    expect(createdBody).not.toContain(license);
    expect(createdBody).not.toContain("sarah.morgan.cfp@outlook.com");
    const row = JSON.parse(createdBody) as { org_id: string; user_id: string };
    expect(store.db.query("SELECT billing_customer_id, test_marker FROM orgs WHERE org_id=?").get(row.org_id)).toEqual({ billing_customer_id: null, test_marker: "sarah_morgan_demo" });
    expect(store.db.query("SELECT password_hash FROM users WHERE user_id=?").get(row.user_id)).not.toEqual({ password_hash: password });
    expect(store.db.query("SELECT key_hash FROM license_keys WHERE org_id=?").get(row.org_id)).not.toEqual({ key_hash: license });

    const user = store.getUser(row.user_id)!;
    const org = store.getOrg(row.org_id)!;
    const tokens = issueAuthTokens(store, user);
    const seat = store.activateSeat({ org_id: org.org_id, user_id: user.user_id, machine_id: "test-machine", machine_label: "Test", seat_limit: 1 });
    expect(seat.ok).toBe(true);
    const seatToken = seat.ok ? mintSeatToken(org, user, seat.seat).token : "";
    expect(authenticate(new Request("http://test", { headers: { authorization: `Bearer ${tokens.access_token}` } }), store).ok).toBe(true);

    const retry = await handleTestFirmProvision(request(secret, JSON.stringify({ password, license_key: license })), store);
    expect(retry.status).toBe(200);
    expect(store.db.query("SELECT count(*) AS n FROM orgs WHERE test_marker='sarah_morgan_demo'").get()).toEqual({ n: 1 });

    const retired = handleTestFirmRetirement(request(secret), store);
    expect(retired.status).toBe(200);
    expect(store.getOrg(org.org_id)!.status).toBe("suspended");
    expect(store.getUser(user.user_id)!.status).toBe("deprovisioned");
    expect(store.getSeat(seat.ok ? seat.seat.seat_id : "")!.status).toBe("revoked");
    expect(authenticate(new Request("http://test", { headers: { authorization: `Bearer ${tokens.access_token}` } }), store).ok).toBe(false);
    expect(store.db.query("SELECT count(*) AS n FROM revocations WHERE seat_id=(SELECT seat_id FROM seats WHERE org_id=?)").get(org.org_id)).toEqual({ n: 1 });
    expect(store.db.query("SELECT count(*) AS n FROM audit_events WHERE action='test_firm.retire'").get()).toEqual({ n: 1 });
    expect(handleTestFirmRetirement(request(secret), store).status).toBe(200);
    expect(store.db.query("SELECT count(*) AS n FROM audit_events WHERE action='test_firm.retire'").get()).toEqual({ n: 1 });
    expect(seatToken).not.toBe("");
  });
});
