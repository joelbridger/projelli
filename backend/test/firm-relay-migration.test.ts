import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { rmSync } from "node:fs";
import { Store } from "../src/lib/db.ts";
import { buildServeOptions } from "../src/server.ts";
import { FanoutHub } from "../src/lib/matters.ts";
import { issueAuthTokens, mintSeatToken } from "../src/lib/services.ts";

const paths:string[]=[]; afterEach(()=>paths.splice(0).forEach(path=>rmSync(path,{force:true})));
const decryptForClient=(ciphertext:Uint8Array)=>new Uint8Array(ciphertext.map(byte=>byte^0xa5));

describe("file-backed v1 firm relay migration",()=>{
  test("rebuilds every relation, preserves bytes, removes legacy schema, and serves v2 pull",async()=>{
    const path=`/tmp/firm-relay-v1-${crypto.randomUUID()}.sqlite`;paths.push(path);const db=new Database(path);
    db.exec(`CREATE TABLE matters (matter_id TEXT PRIMARY KEY,org_id TEXT,client_name TEXT,status TEXT,key_epoch INTEGER,created_at TEXT);
      CREATE TABLE matter_members (matter_id TEXT,user_id TEXT,org_id TEXT,role TEXT,created_at TEXT);
      CREATE TABLE ethical_walls (matter_id TEXT,user_id TEXT,org_id TEXT,reason TEXT,created_by TEXT,created_at TEXT);
      CREATE TABLE matter_updates (id INTEGER PRIMARY KEY,matter_id TEXT,org_id TEXT,doc_id TEXT,blob_id TEXT,ciphertext BLOB,author_seat TEXT,key_epoch INTEGER,created_at TEXT);
      CREATE TABLE wrapped_matter_keys (matter_id TEXT,epoch INTEGER,user_id TEXT,device_id TEXT,wrapped_key_b64 TEXT,published_by TEXT,created_at TEXT);
      CREATE TABLE audit_events (id INTEGER PRIMARY KEY,org_id TEXT,actor_user_id TEXT,action TEXT,target TEXT,detail TEXT,ts TEXT);
      CREATE INDEX idx_legacy_matter_doc ON matter_updates(matter_id,doc_id);`);
    const rows=[
      ["matter-semantic-123","CLIENT_SECRET_NIMBUS","doc-advisory-plan.docx",new Uint8Array([0xa4,0xa7,0xa6])],
      ["matter-semantic-456","CLIENT_SECRET_CIRRUS","doc-forecast.docx",new Uint8Array([0xb4,0xb7,0xb6])],
    ] as const;
    for(const [index,[matter,name,doc,cipher]] of rows.entries()){db.query("INSERT INTO matters VALUES (?,?,?,?,?,?)").run(matter,"org",name,"active",1,"now");db.query("INSERT INTO matter_members VALUES (?,?,?,?,?)").run(matter,"user","org","owner","now");db.query("INSERT INTO ethical_walls VALUES (?,?,?,?,?,?)").run(matter,"wall-user","org","legacy reason","user","now");db.query("INSERT INTO matter_updates VALUES (?,?,?,?,?,?,?,?,?)").run(index+1,matter,"org",doc,`blob-${matter}`,cipher,"seat",1,"now");db.query("INSERT INTO wrapped_matter_keys VALUES (?,?,?,?,?,?,?)").run(matter,1,"user",`device-${matter}`,`wrapped-${matter}`,"user","now");db.query("INSERT INTO audit_events VALUES (?,?,?,?,?,?,?)").run(index+1,"org","user","matter.create",matter,JSON.stringify({client_name:name}),"now");}
    db.close();
    const store=new Store(path);
    const migrated=store.listMatters("org");expect(migrated).toHaveLength(2);expect(store.db.query("SELECT * FROM matter_updates").all()).toHaveLength(2);expect(store.db.query("SELECT * FROM wrapped_matter_keys").all()).toHaveLength(2);expect(store.db.query("SELECT * FROM matter_members").all()).toHaveLength(2);expect(store.db.query("SELECT * FROM ethical_walls").all()).toHaveLength(2);
    const manifest=store.consumeLegacyManifestForUser("user","org");expect(manifest).toHaveLength(2);
    for(const [legacyMatter,_name,legacyDoc,cipher] of rows){const updated=store.db.query("SELECT matter_handle,stream_handle,ciphertext FROM matter_updates WHERE blob_id = ?").get(`blob-${legacyMatter}`) as {matter_handle:string;stream_handle:string;ciphertext:Uint8Array};const mapped=manifest.find(entry=>entry.matter_handle===updated.matter_handle);expect(mapped).toBeDefined();expect(Object.values(mapped!.streams)).toContain(updated.stream_handle);expect(updated.stream_handle).toMatch(/^sh2_/);expect(Array.from(updated.ciphertext)).toEqual(Array.from(cipher));expect(Array.from(decryptForClient(updated.ciphertext))).toEqual(Array.from(decryptForClient(cipher)));expect(legacyDoc).toContain("doc-");expect(store.getWrappedMatterKey(updated.matter_handle,1,"user",`device-${legacyMatter}`)?.wrapped_key_b64).toBe(`wrapped-${legacyMatter}`);}
    const tables=store.db.query("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{name:string}>;const indexes=store.db.query("SELECT name FROM sqlite_master WHERE type='index'").all() as Array<{name:string}>;expect([...tables,...indexes].map(x=>x.name).join(" ")).not.toMatch(/_v2|legacy|matter_id|doc_id/);for(const {name} of tables){const columns=store.db.query(`PRAGMA table_info(${name})`).all() as Array<{name:string}>;expect(columns.map(x=>x.name)).not.toEqual(expect.arrayContaining(["client_name","matter_id","doc_id","reason"]));}
    const textTables=tables.filter(({name})=>!name.startsWith("sqlite_"));for(const sentinel of ["CLIENT_SECRET_NIMBUS","matter-semantic-123","doc-advisory-plan.docx"]){for(const {name} of textTables){const textCols=(store.db.query(`PRAGMA table_info(${name})`).all() as Array<{name:string;type:string}>).filter(c=>/TEXT/i.test(c.type));for(const col of textCols)expect(store.db.query(`SELECT 1 FROM ${name} WHERE ${col.name}=?`).all(sentinel)).toEqual([]);}}
    const org=store.createOrg({name:"temporary",plan:"practice",packs:["advisor"],seat_limit:2});store.db.query("UPDATE orgs SET org_id='org' WHERE org_id=?").run(org.org_id);const user=store.createUser({org_id:"org",email:"migrated@firm.test",password_hash:"x",role:"member"});const first=migrated[0]!;store.addMatterMember({matter_handle:first.matter_handle,user_id:user.user_id,org_id:"org",role:"owner"});const seat=store.activateSeat({org_id:"org",user_id:user.user_id,machine_id:"migration",machine_label:null,seat_limit:2});if(!seat.ok)throw new Error("seat activation failed");const token=issueAuthTokens(store,user).access_token,seatToken=mintSeatToken(store.getOrg("org")!,user,seat.seat).token;const stream=(store.db.query("SELECT stream_handle FROM matter_updates WHERE matter_handle=? ORDER BY id LIMIT 1").get(first.matter_handle) as {stream_handle:string}).stream_handle;const srv=Bun.serve(buildServeOptions(store,new FanoutHub()));try{const r=await fetch(`http://${srv.hostname}:${srv.port}/v2/firm/matters/${first.matter_handle}/streams/${stream}/updates?since=0`,{headers:{authorization:`Bearer ${token}`,"x-seat-token":seatToken}});const raw=await r.text();expect({status:r.status,raw}).toEqual({status:200,raw:expect.any(String)});const payload=JSON.parse(raw) as {updates:Array<{ciphertext_b64:string}>};expect(Array.from(decryptForClient(new Uint8Array(Buffer.from(payload.updates[0]!.ciphertext_b64,"base64"))))).toEqual(Array.from(decryptForClient(rows[0]![3])));}finally{srv.stop(true);store.close();}
  });
});
