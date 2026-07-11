import { describe, expect, test } from "bun:test";
import { Store } from "../src/lib/db.ts";
import { FanoutHub, toUpdateFrame } from "../src/lib/matters.ts";
import { buildServeOptions, type SyncSocketData } from "../src/server.ts";

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

  test("real Bun HTTP and WebSocket traffic expose only opaque route values", async () => {
    const store=new Store(":memory:"), hub=new FanoutHub(), server=Bun.serve<SyncSocketData>(buildServeOptions(store,hub));
    const base=`http://${server.hostname}:${server.port}`; const http:string[]=[]; const frames:string[]=[];
    const post=async(path:string,body:unknown,headers:Record<string,string>={})=>{const req={method:"POST",headers:{"content-type":"application/json",...headers},body:JSON.stringify(body)};http.push(`${path} ${req.body}`);const r=await fetch(`${base}${path}`,req);const text=await r.text();http.push(text);return {status:r.status,json:JSON.parse(text)};};
    try {
      const org=await post("/admin/org",{name:"Firm",plan:"practice",packs:["advisor"],seat_limit:2,admin_email:"admin@privacy.test",admin_password:"privacy-password-123"});
      const login=await post("/auth/login",{email:"admin@privacy.test",password:"privacy-password-123"}); const bearer=`Bearer ${login.json.access_token}`;
      const seat=await post("/org/activate",{license_key:org.json.license_key,machine_id:"privacy-machine"},{authorization:bearer});
      const legacy=await post("/matter/matter-semantic-123/updates",{client_name:"CLIENT_SECRET_NIMBUS",doc_id:"doc-advisory-plan.docx"},{authorization:bearer});
      expect(legacy.status).toBe(426); expect(JSON.stringify(legacy.json)).not.toContain("CLIENT_SECRET_NIMBUS");
      // This deliberately rejected v1 probe is not v2 relay traffic.
      http.splice(-2);
      const created=await post("/v2/firm/matters",{}, {authorization:bearer}); const mh=created.json.matter_handle as string, sh=created.json.root_stream_handle as string;
      await post(`/v2/firm/matters/${mh}/activate`,{}, {authorization:bearer});
      await post(`/v2/firm/matters/${mh}/keys/publish`,{epoch:1,wrapped:[{user_id:org.json.admin.user_id,device_id:"device",wrapped_key_b64:"opaque"}]},{authorization:bearer});
      await post(`/v2/firm/matters/${mh}/streams/${sh}/updates`,{blob_id:"opaque-blob",ciphertext_b64:"AQID",seat_token:seat.json.seat_token,key_epoch:1},{authorization:bearer});
      const ticket=await post(`/v2/firm/matters/${mh}/streams/${sh}/sync-ticket`,{}, {authorization:bearer,"x-seat-token":seat.json.seat_token});
      const wsUrl=`ws://${server.hostname}:${server.port}/v2/firm/sync?ticket=${encodeURIComponent(ticket.json.ticket)}`; http.push(wsUrl);
      await new Promise<void>((resolve,reject)=>{const ws=new WebSocket(wsUrl);const t=setTimeout(()=>reject(new Error("socket timeout")),3000);ws.onmessage=(event)=>{frames.push(String(event.data));if(frames.length>=2){clearTimeout(t);ws.close();resolve();}};ws.onerror=()=>{clearTimeout(t);reject(new Error("socket error"));};});
      const captured=`${http.join("\n")}\n${frames.join("\n")}`;
      for(const sentinel of sentinels)expect(captured).not.toContain(sentinel);
      expect(wsUrl).toMatch(/^ws:\/\/[^/]+\/v2\/firm\/sync\?ticket=/);
      expect(wsUrl).not.toContain(mh); expect(wsUrl).not.toContain(sh);
      for(const frame of frames){expect(frame).not.toContain("matter_handle");expect(frame).not.toContain("stream_handle");expect(frame).not.toContain("matter_id");expect(frame).not.toContain("doc_id");}
    } finally { server.stop(true); }
  });
});
