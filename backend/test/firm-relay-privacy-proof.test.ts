import { describe, expect, test } from "bun:test";
import { Store } from "../src/lib/db.ts";
import { FanoutHub, toUpdateFrame } from "../src/lib/matters.ts";

const sentinels = ["CLIENT_SECRET_NIMBUS", "matter-semantic-123", "doc-advisory-plan.docx"];
const textColumns = (store: Store) => {
  const tables = store.db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as Array<{name:string}>;
  return tables.flatMap(({name}) => (store.db.query(`PRAGMA table_info(${name})`).all() as Array<{name:string;type:string}>).filter((c) => /TEXT/i.test(c.type)).map((c) => `${name}.${c.name}`));
};

describe("firm relay privacy proof", () => {
  test("sentinel client metadata cannot enter relay DB, audit targets, or v2 frames", () => {
    const store = new Store(":memory:");
    const org = store.createOrg({ name:"Firm", plan:"practice", packs:["advisor"], seat_limit:2 });
    const user = store.createUser({ org_id:org.org_id, email:"member@test.dev", password_hash:"x", role:"member" });
    const matter = store.createMatter({ org_id:org.org_id });
    store.addMatterMember({ matter_handle:matter.matter_handle, user_id:user.user_id, org_id:org.org_id, role:"owner" });
    const update = store.appendMatterUpdate({ matter_handle:matter.matter_handle, stream_handle:matter.root_stream_handle, org_id:org.org_id, blob_id:"opaque-blob", ciphertext:new Uint8Array([1,2,3]), author_seat:"seat", key_epoch:1 }).update;
    const hub = new FanoutHub(); const frames: unknown[]=[];
    hub.subscribe(matter.matter_handle,{id:"sub",user_id:user.user_id,seat_id:"seat",send:(f)=>frames.push(f)},matter.root_stream_handle);
    hub.broadcast(matter.matter_handle,toUpdateFrame(update),matter.root_stream_handle);
    const traffic = JSON.stringify({ path:`/v2/firm/matters/${matter.matter_handle}/streams/${matter.root_stream_handle}/updates`, frame:frames, audit:store.listAudit(org.org_id) });
    for (const sentinel of sentinels) {
      expect(traffic).not.toContain(sentinel);
      for (const column of textColumns(store)) {
        const [table, field] = column.split(".");
        const rows=store.db.query(`SELECT ${field} AS value FROM ${table} WHERE ${field} = ?`).all(sentinel);
        expect(rows).toHaveLength(0);
      }
    }
    expect(textColumns(store).join(" ")).not.toMatch(/client_name|matter_id|doc_id/);
    expect(JSON.stringify(frames)).not.toContain("matter_handle");
    expect(JSON.stringify(frames)).not.toContain("stream_handle");
  });
});
