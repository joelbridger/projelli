import { describe, expect, test } from "bun:test";
import { Store } from "../src/lib/db.ts";
import { resolveAccess, toUpdateFrame } from "../src/lib/matters.ts";

describe("opaque firm relay store", () => {
  test("routes ciphertext through opaque handles and preserves wall enforcement", () => {
    const store = new Store(":memory:");
    const org = store.createOrg({ name: "Firm", plan: "practice", packs: ["advisor"], seat_limit: 2 });
    const admin = store.createUser({ org_id: org.org_id, email: "a@test.dev", password_hash: "x", role: "admin" });
    const member = store.createUser({ org_id: org.org_id, email: "m@test.dev", password_hash: "x", role: "member" });
    const matter = store.createMatter({ org_id: org.org_id });
    expect(matter.matter_handle).toMatch(/^mh2_[A-Za-z0-9_-]{43}$/);
    expect(matter.root_stream_handle).toMatch(/^sh2_[A-Za-z0-9_-]{43}$/);
    store.addMatterMember({ matter_handle: matter.matter_handle, user_id: member.user_id, org_id: org.org_id, role: "editor" });
    expect(resolveAccess(store, { orgId: org.org_id, userId: member.user_id, role: "member" }, matter.matter_handle).allowed).toBe(true);
    const update = store.appendMatterUpdate({ matter_handle: matter.matter_handle, stream_handle: matter.root_stream_handle, org_id: org.org_id, blob_id: "random-blob", ciphertext: new Uint8Array([0, 255, 4]), author_seat: "seat", key_epoch: 1 }).update;
    expect(toUpdateFrame(update)).toEqual(expect.objectContaining({ type: "update", cursor: 1, blob_id: "random-blob" }));
    expect(toUpdateFrame(update)).not.toHaveProperty("matter_id");
    expect(toUpdateFrame(update)).not.toHaveProperty("doc_id");
    store.setEthicalWall({ matter_handle: matter.matter_handle, user_id: member.user_id, org_id: org.org_id, created_by: admin.user_id });
    expect(resolveAccess(store, { orgId: org.org_id, userId: member.user_id, role: "member" }, matter.matter_handle).allowed).toBe(false);
  });
});
