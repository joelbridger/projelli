/** V2 HTTP/WebSocket relay proof.  Each case below ports a v1 relay proof to opaque handles. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Store } from "../src/lib/db.ts";
import { FanoutHub, MAX_UPDATE_BYTES } from "../src/lib/matters.ts";
import { buildServeOptions, subscribeSyncSocket, type SyncSocketData } from "../src/server.ts";
import { SyncTicketStore } from "../src/lib/syncTickets.ts";
import { rateLimit } from "../src/lib/http.ts";
import { authorizeSyncConnect, handleArchiveMatter, handleReleaseMatterStream } from "../src/routes/matters.ts";
import { handleDeprovisionUser, handleRevokeSeat, handleTransferSeat } from "../src/routes/admin.ts";

const store = new Store(":memory:"), hub = new FanoutHub();
const server = Bun.serve<SyncSocketData>(buildServeOptions(store, hub));
const base = () => `http://${server.hostname}:${server.port}`;
let admin = "", alice = "", bob = "", viewer = "", owner = "", carol = "", aliceSeat = "", bobSeat = "", viewerSeat = "", ownerSeat = "", carolSeat = "", aliceId = "", bobId = "", viewerId = "", ownerId = "", handle = "", root = "", otherHandle = "";
const provisioningNonce = () => `pn2_${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url")}`;
const post = async (path:string, body:unknown = {}, token?:string, extra:Record<string,string> = {}) => {
  const relayBody = path === "/v2/firm/matters" && JSON.stringify(body) === "{}" ? { provisioning_nonce: provisioningNonce() } : body;
  const r = await fetch(base()+path,{method:"POST",headers:{"content-type":"application/json",...token?{authorization:`Bearer ${token}`}:{},...extra},body:JSON.stringify(relayBody)});
  return {status:r.status,body:await r.json().catch(()=>({})) as Record<string,any>};
};
const get = async (path:string, token?:string, seat?:string) => { const r=await fetch(base()+path,{headers:{...token?{authorization:`Bearer ${token}`}:{},...seat?{"x-seat-token":seat}:{}}}); return {status:r.status,body:await r.json().catch(()=>({})) as Record<string,any>}; };
const blobId = (value:string) => `bh2_${Buffer.from(value).toString("base64url").padEnd(43,"A").slice(0,43)}`;
const envelope = (bytes: Uint8Array) => { const out = new Uint8Array(29 + bytes.length); out[0] = 2; out.set(bytes, 13); return out; };
const push = (mh:string,sh:string, token:string,seat:string, blob:string, bytes:Uint8Array, epoch=1) => post(`/v2/firm/matters/${mh}/streams/${sh}/updates`,{blob_id:blobId(blob),ciphertext_b64:Buffer.from(envelope(bytes)).toString("base64"),seat_token:seat,key_epoch:epoch},token);
const allocateLive = async () => { const stream=`sh2_${Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url")}`; const accepted=await push(handle,stream,alice,aliceSeat,`first-update-${crypto.randomUUID()}`,new Uint8Array([1])); expect(accepted.status).toBe(201); return stream; };
const pull = (_mh:string,sh:string,token:string,seat:string,since=0) => get(`/v2/firm/streams/${sh}/updates?since=${since}`,token,seat);
const ticket = (_mh:string,sh:string,token:string,seat:string,since=0) => post(`/v2/firm/streams/${sh}/sync-ticket`,{since},token,{"x-seat-token":seat});
const seatIdFor = (userId: string) => store.listSeats(store.getMatter(handle)!.org_id).find((seat) => seat.user_id === userId && seat.status === "active")!.seat_id;
const wsUrl = (t:string) => `ws://${server.hostname}:${server.port}/v2/firm/sync?ticket=${encodeURIComponent(t)}`;
const open = (url:string) => new Promise<WebSocket>((resolve,reject)=>{const ws=new WebSocket(url), timer=setTimeout(()=>reject(new Error("socket timeout")),3000);ws.onopen=()=>{clearTimeout(timer);resolve(ws)};ws.onerror=()=>{clearTimeout(timer);reject(new Error("socket error"))};});

beforeAll(async () => {
  const provision=await post("/admin/org",{name:"Relay test",plan:"practice",packs:["advisor"],seat_limit:8,admin_email:"admin@relay.test",admin_password:"password-123"});
  admin=(await post("/auth/login",{email:"admin@relay.test",password:"password-123"})).body.access_token;
  const make=async(label:string)=>{const email=`${label}@relay.test`;const user=await post("/org/users",{email,password:"password-123"},admin);const auth=(await post("/auth/login",{email,password:"password-123"})).body.access_token;const active=await post("/org/activate",{license_key:provision.body.license_key,machine_id:crypto.randomUUID()},auth);return {id:user.body.user.user_id,auth,seat:active.body.seat_token};};
  const a=await make("alice"), b=await make("bob"), v=await make("viewer"), o=await make("owner"); alice=a.auth;aliceSeat=a.seat;aliceId=a.id;bob=b.auth;bobSeat=b.seat;bobId=b.id;viewer=v.auth;viewerSeat=v.seat;viewerId=v.id;owner=o.auth;ownerSeat=o.seat;ownerId=o.id;
  const created=await post("/v2/firm/matters",{},admin);handle=created.body.matter_handle;root=created.body.root_stream_handle;await post(`/v2/firm/matters/${handle}/members/add`,{user_id:aliceId,role:"editor"},admin);await post(`/v2/firm/matters/${handle}/members/add`,{user_id:bobId,role:"editor"},admin);await post(`/v2/firm/matters/${handle}/members/add`,{user_id:viewerId,role:"viewer"},admin);await post(`/v2/firm/matters/${handle}/members/add`,{user_id:ownerId,role:"owner"},admin);await post(`/v2/firm/matters/${handle}/activate`,{},admin);
  const other=await post("/v2/firm/matters",{},admin);otherHandle=other.body.matter_handle;await post(`/v2/firm/matters/${otherHandle}/activate`,{},admin);
  const p2=await post("/admin/org",{name:"Other",plan:"practice",packs:["advisor"],seat_limit:2,admin_email:"admin@other.test",admin_password:"password-123"}); const otherAdmin=(await post("/auth/login",{email:"admin@other.test",password:"password-123"})).body.access_token;const cu=await post("/org/users",{email:"carol@other.test",password:"password-123"},otherAdmin);carol=(await post("/auth/login",{email:"carol@other.test",password:"password-123"})).body.access_token;carolSeat=(await post("/org/activate",{license_key:p2.body.license_key,machine_id:crypto.randomUUID()},carol)).body.seat_token; expect(cu.status).toBe(201);
});
afterAll(()=>server.stop(true));

describe("v2 encrypted relay: preserved HTTP, authorization, cursor, and socket proofs", () => {
  test("member PUSH then another member PULLS byte-identical ciphertext",async()=>{const bytes=new Uint8Array([0,255,128,1]);const r=await push(handle,root,alice,aliceSeat,"blob-roundtrip",bytes);expect(r.status).toBe(201);const out=await pull(handle,root,bob,bobSeat);expect(out.status).toBe(200);expect(Array.from(Buffer.from(out.body.updates.find((u:any)=>u.blob_id===blobId("blob-roundtrip")).ciphertext_b64,"base64"))).toEqual(Array.from(envelope(bytes)));});
  test("owners and editors can push, while viewers stay read-only but can pull and subscribe",async()=>{expect((await push(handle,root,owner,ownerSeat,"owner-write",new Uint8Array([1]))).status).toBe(201);expect((await push(handle,root,alice,aliceSeat,"editor-write",new Uint8Array([2]))).status).toBe(201);expect((await push(handle,root,viewer,viewerSeat,"viewer-write",new Uint8Array([3]))).status).toBe(403);expect((await pull(handle,root,viewer,viewerSeat)).status).toBe(200);const t=await ticket(handle,root,viewer,viewerSeat);expect(t.status).toBe(200);const ws=await open(wsUrl(t.body.ticket));ws.close();});
  test("duplicate blob is idempotent in its opaque stream",async()=>{const a=await push(handle,root,alice,aliceSeat,"blob-dup",new Uint8Array([1]));const b=await push(handle,root,alice,aliceSeat,"blob-dup",new Uint8Array([9]));expect([201,200]).toContain(a.status);expect(b).toMatchObject({status:200,body:{duplicate:true,cursor:a.body.cursor}});});
  test("cursor pull is strictly after since and ordered, and carries the matter key epoch",async()=>{const before=(await pull(handle,root,alice,aliceSeat)).body.latest_cursor;const ids:number[]=[];for(let i=0;i<3;i++)ids.push((await push(handle,root,alice,aliceSeat,`seq-${i}`,new Uint8Array([i]))).body.cursor);const response=await pull(handle,root,bob,bobSeat,before);expect(response.body.updates.map((u:any)=>u.cursor)).toEqual(ids);expect(response.body.key_epoch).toBe(store.getMatter(handle)!.key_epoch);});
  test("non-member push is forbidden while pull is an opaque denial and audited",async()=>{const o=store.createUser({org_id:store.getMatter(handle)!.org_id,email:"outside@relay.test",password_hash:"x",role:"member"});const tok=(await import("../src/lib/services.ts")).issueAuthTokens(store,o).access_token;const seat=store.activateSeat({org_id:o.org_id,user_id:o.user_id,machine_id:"o",machine_label:null,seat_limit:8});if(!seat.ok)throw new Error("seat activation failed");const st=(await import("../src/lib/services.ts")).mintSeatToken(store.getOrg(o.org_id)!,o,seat.seat).token;expect((await push(handle,root,tok,st,"out",new Uint8Array([1]))).status).toBe(403);expect((await pull(handle,root,tok,st)).status).toBe(404);expect(store.listAudit(o.org_id).some(e=>e.action==="matter.access.denied")).toBe(true);});
  test("live member socket receives a pushed v2 update",async()=>{const t=await ticket(handle,root,bob,bobSeat);const ws=await open(wsUrl(t.body.ticket));try{const frame=await new Promise<any>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error("no update")),3000);ws.onmessage=e=>{const f=JSON.parse(String(e.data));if(f.type==="update"&&f.blob_id===blobId("live")){clearTimeout(timer);resolve(f);}};push(handle,root,alice,aliceSeat,"live",new Uint8Array([7]));});expect(frame).toMatchObject({type:"update",blob_id:blobId("live")});expect(frame).not.toHaveProperty("stream_handle");}finally{ws.close();}});
  test("wall overrides membership for WebSocket upgrade",async()=>{await post(`/v2/firm/matters/${handle}/wall/set`,{user_id:bobId},admin);const t=await ticket(handle,root,bob,bobSeat);expect(t.status).toBe(404);await post(`/v2/firm/matters/${handle}/wall/clear`,{user_id:bobId},admin);});
  test("walled member is rejected on push, pull, and subscription",async()=>{await post(`/v2/firm/matters/${handle}/wall/set`,{user_id:aliceId},admin);expect((await push(handle,root,alice,aliceSeat,"wall",new Uint8Array([1]))).status).toBe(403);expect((await pull(handle,root,alice,aliceSeat)).status).toBe(404);expect((await ticket(handle,root,alice,aliceSeat)).status).toBe(404);await post(`/v2/firm/matters/${handle}/wall/clear`,{user_id:aliceId},admin);});
  test("cross-org relay access is a non-enumerating 404",async()=>{expect((await push(handle,root,carol,carolSeat,"cross",new Uint8Array([1]))).status).toBe(404);expect((await pull(handle,root,carol,carolSeat)).status).toBe(404);});
  test("relay requires a valid seat token",async()=>{expect((await post(`/v2/firm/matters/${handle}/streams/${root}/updates`,{blob_id:blobId("no-seat"),ciphertext_b64:"AQ=="},alice)).status).toBe(401);});
  test("relay rejects oversized ciphertext",async()=>{expect((await push(handle,root,alice,aliceSeat,"large",new Uint8Array(MAX_UPDATE_BYTES+1))).status).toBe(413);});
  test("relay rejects malformed v2 payload",async()=>{expect((await post(`/v2/firm/matters/${handle}/streams/${root}/updates`,{blob_id:"bad",ciphertext_b64:42,seat_token:aliceSeat},alice)).status).toBe(400);});
  test("relay rejects the removed client-asserted stream commit field",async()=>{expect((await post(`/v2/firm/matters/${handle}/streams/${root}/updates`,{blob_id:`no-client-commit-${crypto.randomUUID()}`,ciphertext_b64:"AQ==",seat_token:aliceSeat,key_epoch:1,commit_stream_handle:root},alice)).status).toBe(400);});
  test("relay requires authentication",async()=>{expect((await post(`/v2/firm/matters/${handle}/streams/${root}/updates`,{})).status).toBe(401);});
  test("sync ticket hides stream existence before access is proved",async()=>{expect((await post(`/v2/firm/streams/${root}/sync-ticket`,{})).status).toBe(404);});
  test("sync ticket hides stream existence when the seat is absent",async()=>{expect((await post(`/v2/firm/streams/${root}/sync-ticket`,{},alice)).status).toBe(404);});
  test("sync ticket rejects non-member",async()=>{expect((await ticket(handle,root,carol,carolSeat)).status).toBe(404);});
  test("ticket redeems exactly once",async()=>{const t=await ticket(handle,root,bob,bobSeat);const ws=await open(wsUrl(t.body.ticket));ws.close();await new Promise(r=>setTimeout(r,10));await expect(open(wsUrl(t.body.ticket))).rejects.toThrow();});
  test("socket URL carries ticket only",async()=>{const t=await ticket(handle,root,bob,bobSeat);const u=wsUrl(t.body.ticket);expect(u).toMatch(/\/v2\/firm\/sync\?ticket=/);expect(u).not.toContain(handle);expect(u).not.toContain(root);expect(u).not.toContain(bobSeat);expect(u).not.toContain(bob);});
  test("expired ticket is rejected",()=>{const tickets=new SyncTicketStore(-1);const t=tickets.mint({matterHandle:handle,streamHandle:root,orgId:store.getMatter(handle)!.org_id,userId:bobId,seatId:seatIdFor(bobId),role:"member",since:0});expect(tickets.redeem(t.ticket)).toBeNull();});
  test("ticket binding carries the requested opaque stream",()=>{const tickets=new SyncTicketStore();const t=tickets.mint({matterHandle:handle,streamHandle:root,orgId:store.getMatter(handle)!.org_id,userId:bobId,seatId:seatIdFor(bobId),role:"member",since:17});expect(tickets.redeem(t.ticket)).toMatchObject({matterHandle:handle,streamHandle:root,since:17});});
  test("real socket handoff replays from the HTTP cursor after a 501-update catch-up, with no skipped frame", async () => {
    const matter = store.createMatter({ org_id: store.getMatter(handle)!.org_id });
    store.activateProvisioningMatter(matter.matter_handle);
    store.addMatterMember({ matter_handle: matter.matter_handle, user_id: aliceId, org_id: matter.org_id, role: "editor" });
    store.addMatterMember({ matter_handle: matter.matter_handle, user_id: bobId, org_id: matter.org_id, role: "editor" });
    // Seed via the real relay store, then exercise catch-up and WebSocket
    // subscription through the actual Bun server. HTTP rate limits should not
    // turn a 501-item handoff proof into a timing test.
    for (let i = 0; i < 501; i += 1) {
      expect(store.appendMatterUpdate({ matter_handle: matter.matter_handle, org_id: matter.org_id, stream_handle: matter.root_stream_handle, blob_id: blobId(`handoff-before-${i}`), ciphertext: envelope(new Uint8Array([i % 255])), author_seat: seatIdFor(aliceId), key_epoch: 1 })).toMatchObject({ duplicate: false });
    }
    const first = await pull(matter.matter_handle, matter.root_stream_handle, bob, bobSeat, 0);
    expect(first.body.updates).toHaveLength(500);
    expect(first.body.has_more).toBe(true);
    const finalHttp = await pull(matter.matter_handle, matter.root_stream_handle, bob, bobSeat, first.body.cursor);
    expect(finalHttp.body.updates).toHaveLength(1);
    const handoffCursor = finalHttp.body.cursor as number;
    const between = await push(matter.matter_handle, matter.root_stream_handle, alice, aliceSeat, "handoff-between-pull-and-subscribe", new Uint8Array([1]));
    expect(between.status).toBe(201);
    const t = await ticket(matter.matter_handle, matter.root_stream_handle, bob, bobSeat, handoffCursor);
    expect(t.status).toBe(200);
    const seen: any[] = [];
    const ws = await new Promise<WebSocket>((resolve, reject) => {
      const socket = new WebSocket(wsUrl(t.body.ticket));
      const timer = setTimeout(() => reject(new Error("handoff socket timeout")), 3000);
      socket.onmessage = (event) => {
        const frame = JSON.parse(String(event.data)); seen.push(frame);
        if (frame.type === "ready") void push(matter.matter_handle, matter.root_stream_handle, alice, aliceSeat, "handoff-after-subscribe", new Uint8Array([2]));
        if (seen.filter((f) => f.type === "update").length >= 2) { clearTimeout(timer); resolve(socket); }
      };
      socket.onerror = () => { clearTimeout(timer); reject(new Error("handoff socket error")); };
    });
    try {
      const updates = seen.filter((frame) => frame.type === "update");
      expect(seen.find((frame) => frame.type === "ready")).toMatchObject({ replay_from_cursor: handoffCursor });
      expect(updates.map((frame) => frame.blob_id)).toEqual([blobId("handoff-between-pull-and-subscribe"), blobId("handoff-after-subscribe")]);
      expect(updates.map((frame) => frame.cursor)).toEqual([between.body.cursor, between.body.cursor + 1]);
    } finally { ws.close(); }
  }, 20_000);
  test("pull hides stream existence when the seat is absent",async()=>{expect((await get(`/v2/firm/streams/${root}/updates?since=0`,alice)).status).toBe(404);});
  test("normal rate-limit bucket permits a request",()=>expect(rateLimit(`relay-${crypto.randomUUID()}`,"proof",{max:2,windowSeconds:10}).ok).toBe(true));
  test("rate-limit exhaustion has 429 semantics",()=>{const ip=`relay-${crypto.randomUUID()}`;rateLimit(ip,"proof",{max:1,windowSeconds:10});expect(rateLimit(ip,"proof",{max:1,windowSeconds:10}).ok).toBe(false);});
  test("new matter root stream is its opaque notes stream equivalent",()=>expect(root).toMatch(/^sh2_[A-Za-z0-9_-]{43}$/));
  test("client-generated document stream is opaque and distinct",async()=>{const stream=await allocateLive();expect(stream).toMatch(/^sh2_[A-Za-z0-9_-]{43}$/);expect(stream).not.toBe(root);});
  test("streams isolate updates even with the same blob id",async()=>{const s=await allocateLive();await push(handle,root,alice,aliceSeat,"same",new Uint8Array([1]));await push(handle,s,alice,aliceSeat,"same",new Uint8Array([2]));expect((await pull(handle,s,bob,bobSeat)).body.updates.some((u:any)=>u.blob_id===blobId("same")&&u.ciphertext_b64===Buffer.from(envelope(new Uint8Array([2]))).toString("base64"))).toBe(true);});
  test("stream cursor is independent",async()=>{const s=await allocateLive();const before=(await pull(handle,s,bob,bobSeat)).body.latest_cursor;await push(handle,root,alice,aliceSeat,`root-after-${crypto.randomUUID()}`,new Uint8Array([1]));expect((await pull(handle,s,bob,bobSeat)).body.latest_cursor).toBe(before);});
  test("pull response omits legacy matter and document fields",async()=>{const body=JSON.stringify((await pull(handle,root,bob,bobSeat)).body);expect(body).not.toContain("matter_id");expect(body).not.toContain("doc_id");});
  test("push response omits route handles",async()=>{const body=JSON.stringify((await push(handle,root,alice,aliceSeat,`no-route-${crypto.randomUUID()}`,new Uint8Array([1]))).body);expect(body).not.toContain("matter_handle");expect(body).not.toContain("stream_handle");});
  test("fan-out frames omit legacy route identifiers",async()=>{const frames:any[]=[];hub.subscribe(handle,{id:"proof",user_id:bobId,seat_id:"s",send:f=>frames.push(f)},root);hub.broadcast(handle,{type:"update",cursor:1,blob_id:"x",key_epoch:1,author_seat:"s",created_at:"now",ciphertext_b64:"AQ=="},root);expect(JSON.stringify(frames)).not.toMatch(/matter_handle|stream_handle|matter_id|doc_id/);hub.unsubscribe(handle,"proof",root);});
  test("ready frame has subscriber count",async()=>{const t=await ticket(handle,root,bob,bobSeat);const ws=await open(wsUrl(t.body.ticket));try{const ready=await new Promise<any>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error("no ready")),3000);ws.onmessage=e=>{const f=JSON.parse(String(e.data));if(f.type==="ready"){clearTimeout(timer);resolve(f);}}});expect(ready.subscribers).toBeGreaterThan(0);}finally{ws.close();}});
  test("two sockets receive presence count two",async()=>{const a=await ticket(handle,root,alice,aliceSeat),b=await ticket(handle,root,bob,bobSeat);const one=await open(wsUrl(a.body.ticket)),two=await open(wsUrl(b.body.ticket));try{const p=await new Promise<any>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error("no presence")),3000);one.onmessage=e=>{const f=JSON.parse(String(e.data));if(f.type==="presence"&&f.count>=2){clearTimeout(timer);resolve(f)}}});expect(p.count).toBe(2);}finally{one.close();two.close();}});
  test("remaining socket sees presence one after peer closes",async()=>{const a=await ticket(handle,root,alice,aliceSeat),b=await ticket(handle,root,bob,bobSeat);const one=await open(wsUrl(a.body.ticket)),two=await open(wsUrl(b.body.ticket));try{const p=new Promise<any>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error("no presence")),3000);one.onmessage=e=>{const f=JSON.parse(String(e.data));if(f.type==="presence"&&f.count===1){clearTimeout(timer);resolve(f)}}});two.close();expect((await p).count).toBe(1);}finally{one.close();}});
  test("presence is stream-isolated",async()=>{const s=await allocateLive();const t=await ticket(handle,s,alice,aliceSeat);const ws=await open(wsUrl(t.body.ticket));try{const frames:any[]=[];ws.onmessage=e=>frames.push(JSON.parse(String(e.data)));await new Promise(r=>setTimeout(r,30));expect(frames.filter(f=>f.type==="presence").every(f=>f.count===1)).toBe(true);}finally{ws.close();}});
  test("v1 relay endpoints return deliberate upgrade response",async()=>expect((await post("/matter/matter-semantic-123/updates",{client_name:"x",doc_id:"d"},alice)).status).toBe(426));
  test("v2 rejects a legacy client_name payload",async()=>expect((await post("/v2/firm/matters",{client_name:"x"},admin)).status).toBe(400));
  test("v2 rejects legacy matter_id and doc_id payload",async()=>expect((await post(`/v2/firm/matters/${handle}/streams/${root}/updates`,{matter_id:"x",doc_id:"y",blob_id:"legacy-fields",ciphertext_b64:"AQ==",seat_token:aliceSeat,key_epoch:1},alice)).status).toBe(400));
  test("the removed allocation route is not accepted",async()=>expect((await post(`/v2/firm/matters/${handle}/streams`,{},alice,{"x-seat-token":aliceSeat})).status).toBe(404));

  test("an archive between ticket approval and subscription sends no websocket backlog", () => {
    const matter = store.createMatter({ org_id: store.getMatter(handle)!.org_id });
    store.activateProvisioningMatter(matter.matter_handle);
    store.addMatterMember({ matter_handle: matter.matter_handle, user_id: aliceId, org_id: store.getMatter(handle)!.org_id, role: "editor" });
    expect(store.appendMatterUpdate({ matter_handle: matter.matter_handle, org_id: store.getMatter(handle)!.org_id, stream_handle: matter.root_stream_handle, blob_id: "pre-subscribe-backlog", ciphertext: new Uint8Array([1]), author_seat: "seat", key_epoch: 1 })).toMatchObject({ duplicate: false });
    const tickets = new SyncTicketStore();
    const ticket = tickets.mint({ matterHandle: matter.matter_handle, streamHandle: matter.root_stream_handle, orgId: store.getMatter(handle)!.org_id, userId: aliceId, seatId: seatIdFor(aliceId), role: "member", since: 0 });
    const approved = authorizeSyncConnect(new Request(`http://relay.test/v2/firm/sync?ticket=${encodeURIComponent(ticket.ticket)}`), store, tickets);
    expect(approved.ok).toBe(true);
    if (!approved.ok) throw new Error("ticket should be approved before archive");
    store.archiveMatter(matter.matter_handle);
    const frames: string[] = [], closed: Array<[number | undefined, string | undefined]> = [], isolatedHub = new FanoutHub();
    subscribeSyncSocket(store, isolatedHub, { data: { subId: "between-ticket-and-subscribe", ...approved.data }, send: (frame: string) => { frames.push(frame); return 0; }, close: (code?: number, reason?: string) => { closed.push([code, reason]); } } as unknown as Bun.ServerWebSocket<SyncSocketData>);
    expect(frames).toEqual([]);
    expect(closed).toEqual([[1008, "access_denied"]]);
    expect(isolatedHub.subscriberCount(matter.matter_handle, matter.root_stream_handle)).toBe(0);
  });

  test("archiving an open websocket evicts that matter only", async () => {
    const matter = store.createMatter({ org_id: store.getMatter(handle)!.org_id });
    store.activateProvisioningMatter(matter.matter_handle);
    store.addMatterMember({ matter_handle: matter.matter_handle, user_id: aliceId, org_id: store.getMatter(handle)!.org_id, role: "editor" });
    const isolatedHub = new FanoutHub(), frames: string[] = [], closed: Array<[number | undefined, string | undefined]> = [];
    subscribeSyncSocket(store, isolatedHub, { data: { subId: "open-archive-socket", matterHandle: matter.matter_handle, streamHandle: matter.root_stream_handle, orgId: store.getMatter(handle)!.org_id, userId: aliceId, seatId: seatIdFor(aliceId), role: "member", since: 0 }, send: (frame: string) => { frames.push(frame); return 0; }, close: (code?: number, reason?: string) => { closed.push([code, reason]); } } as unknown as Bun.ServerWebSocket<SyncSocketData>);
    expect(frames.length).toBeGreaterThan(0);
    expect(isolatedHub.subscriberCount(matter.matter_handle, matter.root_stream_handle)).toBe(1);
    expect((await handleArchiveMatter(new Request("http://relay.test/v2/firm/route", { method: "POST", headers: { authorization: `Bearer ${admin}`, "content-type": "application/json" }, body: "{}" }), store, matter.matter_handle, isolatedHub)).status).toBe(200);
    expect(closed).toEqual([[1008, "matter_archived"]]);
    expect(isolatedHub.subscriberCount(matter.matter_handle, matter.root_stream_handle)).toBe(0);
  });

  test("releasing a stream closes its sockets and invalidates a pre-release ticket", async () => {
    const matter = store.createMatter({ org_id: store.getMatter(handle)!.org_id });
    store.activateProvisioningMatter(matter.matter_handle);
    const adminId = store.getUserByEmailNorm("admin@relay.test")!.user_id;
    store.addMatterMember({ matter_handle: matter.matter_handle, user_id: adminId, org_id: store.getMatter(handle)!.org_id, role: "owner" });
    store.addMatterMember({ matter_handle: matter.matter_handle, user_id: aliceId, org_id: store.getMatter(handle)!.org_id, role: "editor" });
    const released = `sh2_${"R".repeat(43)}`;
    expect(store.appendMatterUpdate({ matter_handle: matter.matter_handle, org_id: store.getMatter(handle)!.org_id, stream_handle: released, blob_id: "release-proof", ciphertext: new Uint8Array([2, ...new Array(28).fill(0)]), author_seat: "seat", key_epoch: 1 })).toMatchObject({ duplicate: false });
    const tickets = new SyncTicketStore();
    const preRelease = tickets.mint({ matterHandle: matter.matter_handle, streamHandle: released, orgId: store.getMatter(handle)!.org_id, userId: aliceId, seatId: seatIdFor(aliceId), role: "member", since: 0 });
    const isolatedHub = new FanoutHub(), closed: Array<[number | undefined, string | undefined]> = [];
    isolatedHub.subscribe(matter.matter_handle, { id: "released-socket", user_id: aliceId, seat_id: "seat", send: () => undefined, close: (code?: number, reason?: string) => { closed.push([code, reason]); } }, released);
    const response = await handleReleaseMatterStream(new Request("http://relay.test/v2/firm/route", { method: "POST", headers: { authorization: `Bearer ${admin}`, "content-type": "application/json" }, body: JSON.stringify({ stream_handle: released }) }), store, matter.matter_handle, isolatedHub);
    expect(response.status).toBe(200);
    expect(closed).toEqual([[undefined, undefined]]);
    expect(isolatedHub.subscriberCount(matter.matter_handle, released)).toBe(0);
    expect(authorizeSyncConnect(new Request(`http://relay.test/v2/firm/sync?ticket=${preRelease.ticket}`), store, tickets).ok).toBe(false);
  });

  test("the socket-open gate independently refuses a seat revoked after redemption (defense in depth)", () => {
    // Redemption already rechecks liveness, but a seat can be revoked in the
    // window between redemption and Bun calling `open`. That final gate had no
    // test of its own: disabling it left the suite green, which is exactly the
    // kind of untested guard that rots. Drive it directly.
    const isolatedHub = new FanoutHub();
    const orgId = store.getMatter(handle)!.org_id;
    // Own user + seat: revoking a seat another test relies on would poison it
    // (shared store state). This test must not make its neighbours fail.
    const solo = store.createUser({ org_id: orgId, email: "solo-open-gate@relay.test", password_hash: "x", role: "member" });
    const soloSeat = store.activateSeat({ org_id: orgId, user_id: solo.user_id, machine_id: "solo-open-gate", machine_label: null, seat_limit: 99 });
    if (!soloSeat.ok) throw new Error("seat activation failed");
    const seatId = soloSeat.seat.seat_id;
    // Make the user a real MEMBER first: otherwise the access check rejects the
    // socket and this test would pass even with the seat gate removed — proving
    // nothing. The revoked SEAT must be the only reason it is refused.
    store.addMatterMember({ matter_handle: handle, user_id: solo.user_id, org_id: orgId, role: "editor" });
    store.revokeSeat(seatId, "test_revoke_between_redeem_and_open");
    const frames: string[] = [];
    let closed: { code: number; reason: string } | null = null;
    subscribeSyncSocket(store, isolatedHub, {
      data: { subId: "post-redeem-revoke", matterHandle: handle, streamHandle: root, orgId, userId: solo.user_id, seatId, role: "member", since: 0 },
      send: (frame: string) => { frames.push(frame); },
      close: (code: number, reason: string) => { closed = { code, reason }; },
    } as never);
    expect(closed).not.toBeNull();
    expect(closed!.reason).toBe("access_denied");
    expect(frames).toHaveLength(0);
    // And the revoked seat receives nothing from a later broadcast.
    isolatedHub.broadcast(handle, { type: "update", cursor: 1, blob_id: "bh2_" + "A".repeat(43), key_epoch: 1, author_seat: "x", created_at: "now", ciphertext_b64: "AQ==" }, root);
    expect(frames).toHaveLength(0);
  });

  test("transferring a seat evicts its live socket", async () => {
    const orgId = store.getMatter(handle)!.org_id;
    const source = store.createUser({ org_id: orgId, email: "transfer-source@relay.test", password_hash: "x", role: "member" });
    const target = store.createUser({ org_id: orgId, email: "transfer-target@relay.test", password_hash: "x", role: "member" });
    const binding = store.activateSeat({ org_id: orgId, user_id: source.user_id, machine_id: "transfer-source-machine", machine_label: null, seat_limit: 99 });
    if (!binding.ok) throw new Error("seat activation failed");
    store.addMatterMember({ matter_handle: handle, user_id: source.user_id, org_id: orgId, role: "editor" });

    const isolatedHub = new FanoutHub();
    const frames: string[] = [], closed: string[] = [];
    subscribeSyncSocket(store, isolatedHub, {
      data: { subId: "transferred-live", matterHandle: handle, streamHandle: root, orgId, userId: source.user_id, seatId: binding.seat.seat_id, role: "member", since: store.latestMatterCursor(handle, root) },
      send: (frame: string) => { frames.push(frame); return 0; },
      close: (_code?: number, reason?: string) => { closed.push(reason ?? "closed"); },
    } as unknown as Bun.ServerWebSocket<SyncSocketData>);
    expect(frames.some((frame) => frame.includes('"type":"ready"'))).toBe(true);

    expect((await handleTransferSeat(new Request("http://relay.test/org/seats/transfer", { method: "POST", headers: { authorization: `Bearer ${admin}`, "content-type": "application/json" }, body: JSON.stringify({ from_seat_id: binding.seat.seat_id, to_user_id: target.user_id, to_machine_id: crypto.randomUUID() }) }), store, isolatedHub)).status).toBe(200);
    isolatedHub.broadcast(handle, { type: "update", cursor: 999, blob_id: "after-seat-transfer", key_epoch: 1, author_seat: "x", created_at: "now", ciphertext_b64: "AQ==" }, root);
    expect(closed).toHaveLength(1);
    expect(frames.some((frame) => frame.includes("after-seat-transfer"))).toBe(false);
  });

  test("revoked seats, deprovisioned users, and suspended orgs cannot redeem or retain live sockets", async () => {
    const orgId = store.getMatter(handle)!.org_id;
    const tickets = new SyncTicketStore();
    const preRevoke = tickets.mint({ matterHandle: handle, streamHandle: root, orgId, userId: bobId, seatId: seatIdFor(bobId), role: "member", since: 0 });
    store.revokeSeat(seatIdFor(bobId), "test_revoke_before_redeem");
    expect(authorizeSyncConnect(new Request(`http://relay.test/v2/firm/sync?ticket=${preRevoke.ticket}`), store, tickets).ok).toBe(false);

    const isolatedHub = new FanoutHub();
    const open = (subId: string, userId: string, seatId: string) => {
      const frames: string[] = [], closed: string[] = [];
      subscribeSyncSocket(store, isolatedHub, { data: { subId, matterHandle: handle, streamHandle: root, orgId, userId, seatId, role: "member", since: store.latestMatterCursor(handle, root) }, send: (frame: string) => { frames.push(frame); return 0; }, close: (_code?: number, reason?: string) => { closed.push(reason ?? "closed"); } } as unknown as Bun.ServerWebSocket<SyncSocketData>);
      return { frames, closed };
    };
    const seatSocket = open("revoked-live", aliceId, seatIdFor(aliceId));
    expect(seatSocket.frames.some((frame) => frame.includes('"type":"ready"'))).toBe(true);
    expect((await handleRevokeSeat(new Request("http://relay.test/org/seat/revoke", { method: "POST", headers: { authorization: `Bearer ${admin}`, "content-type": "application/json" }, body: JSON.stringify({ seat_id: seatIdFor(aliceId) }) }), store, isolatedHub)).status).toBe(200);
    isolatedHub.broadcast(handle, { type: "update", cursor: 999, blob_id: "after-seat-revoke", key_epoch: 1, author_seat: "x", created_at: "now", ciphertext_b64: "AQ==" }, root);
    expect(seatSocket.closed).toHaveLength(1);
    expect(seatSocket.frames.some((frame) => frame.includes("after-seat-revoke"))).toBe(false);

    const userSocket = open("deprovisioned-live", ownerId, seatIdFor(ownerId));
    expect((await handleDeprovisionUser(new Request("http://relay.test/org/user/deprovision", { method: "POST", headers: { authorization: `Bearer ${admin}`, "content-type": "application/json" }, body: JSON.stringify({ user_id: ownerId }) }), store, isolatedHub)).status).toBe(200);
    expect(userSocket.closed).toHaveLength(1);

    const orgSocket = open("suspended-live", viewerId, seatIdFor(viewerId));
    store.setOrgStatus(orgId, "suspended");
    expect(orgSocket.closed).toHaveLength(1);
  });

});
