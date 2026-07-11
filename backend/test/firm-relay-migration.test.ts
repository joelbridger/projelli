import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { rmSync } from "node:fs";
import { Store } from "../src/lib/db.ts";

const paths: string[]=[]; afterEach(() => paths.splice(0).forEach((p) => rmSync(p,{force:true})));
describe("file-backed v1 firm relay migration", () => {
  test("rebuilds the relational graph without changing ciphertext or wrapped bytes", () => {
    const path=`/tmp/firm-relay-v1-${crypto.randomUUID()}.sqlite`; paths.push(path); const db=new Database(path);
    db.exec(`CREATE TABLE matters (matter_id TEXT PRIMARY KEY,org_id TEXT,client_name TEXT,status TEXT,key_epoch INTEGER,created_at TEXT);
      CREATE TABLE matter_members (matter_id TEXT,user_id TEXT,org_id TEXT,role TEXT,created_at TEXT);
      CREATE TABLE ethical_walls (matter_id TEXT,user_id TEXT,org_id TEXT,reason TEXT,created_by TEXT,created_at TEXT);
      CREATE TABLE matter_updates (id INTEGER PRIMARY KEY,matter_id TEXT,org_id TEXT,doc_id TEXT,blob_id TEXT,ciphertext BLOB,author_seat TEXT,key_epoch INTEGER,created_at TEXT);
      CREATE TABLE wrapped_matter_keys (matter_id TEXT,epoch INTEGER,user_id TEXT,device_id TEXT,wrapped_key_b64 TEXT,published_by TEXT,created_at TEXT);
      CREATE TABLE audit_events (id INTEGER PRIMARY KEY,org_id TEXT,actor_user_id TEXT,action TEXT,target TEXT,detail TEXT,ts TEXT);`);
    db.query("INSERT INTO matters VALUES (?,?,?,?,?,?)").run("matter-semantic-123","org","CLIENT_SECRET_NIMBUS","active",1,"now");
    db.query("INSERT INTO matter_members VALUES (?,?,?,?,?)").run("matter-semantic-123","user","org","owner","now");
    db.query("INSERT INTO matter_updates VALUES (?,?,?,?,?,?,?,?,?)").run(7,"matter-semantic-123","org","doc-advisory-plan.docx","blob",new Uint8Array([0,255,3]),"seat",1,"now");
    db.query("INSERT INTO wrapped_matter_keys VALUES (?,?,?,?,?,?,?)").run("matter-semantic-123",1,"user","device","wrapped-bytes","user","now");
    db.query("INSERT INTO audit_events VALUES (?,?,?,?,?,?,?)").run(1,"org","user","matter.create","matter-semantic-123",JSON.stringify({client_name:"CLIENT_SECRET_NIMBUS"}),"now"); db.close();
    const store=new Store(path); const m=store.listMatters("org")[0]!;
    expect(m.matter_handle).toMatch(/^mh2_/); expect(m.root_stream_handle).toMatch(/^sh2_/);
    const stream=(store.db.query("SELECT stream_handle FROM matter_updates WHERE matter_handle = ?").get(m.matter_handle) as {stream_handle:string}).stream_handle;
    expect(Array.from(store.getMatterUpdatesSince(m.matter_handle,stream,0)[0]!.ciphertext)).toEqual([0,255,3]);
    expect(store.getWrappedMatterKey(m.matter_handle,1,"user","device")?.wrapped_key_b64).toBe("wrapped-bytes");
    const names=store.db.query("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{name:string}>;
    expect(names.map((x)=>x.name)).not.toContain("matters_v2");
    for(const table of ["matters","matter_members","ethical_walls","matter_updates","wrapped_matter_keys"]){const cols=store.db.query(`PRAGMA table_info(${table})`).all() as Array<{name:string}>;expect(cols.map((x)=>x.name)).not.toEqual(expect.arrayContaining(["client_name","matter_id","doc_id","reason"]));}
    expect(JSON.stringify(store.listAudit("org"))).not.toContain("CLIENT_SECRET_NIMBUS");
  });
});
