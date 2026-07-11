import { describe, expect, test } from "bun:test";
import { Store } from "../src/lib/db.ts";

describe("opaque discovery and wrapped keys", () => {
  test("discovery returns only opaque routing values", () => {
    const store = new Store(":memory:");
    const org = store.createOrg({ name: "Firm", plan: "practice", packs: ["advisor"], seat_limit: 2 });
    const user = store.createUser({ org_id: org.org_id, email: "member@test.dev", password_hash: "x", role: "member" });
    const matter = store.createMatter({ org_id: org.org_id });
    store.addMatterMember({ matter_handle: matter.matter_handle, user_id: user.user_id, org_id: org.org_id, role: "owner" });
    store.upsertWrappedMatterKey({ matter_handle: matter.matter_handle, epoch: 1, user_id: user.user_id, device_id: "device", wrapped_key_b64: "opaque-wrap", published_by: user.user_id });
    expect(store.listMatterMembershipsForUser(user.user_id, org.org_id)).toEqual([{ matter_handle: matter.matter_handle, root_stream_handle: matter.root_stream_handle, status: "provisioning", key_epoch: 1, role: "owner" }]);
    expect(store.getWrappedMatterKey(matter.matter_handle, 1, user.user_id, "device")?.wrapped_key_b64).toBe("opaque-wrap");
  });
});
