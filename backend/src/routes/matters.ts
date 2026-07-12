/** Opaque-handle firm relay. This file deliberately has no semantic matter/doc input. */
import { json, error, isNonEmptyString, authenticate, rateLimit } from "../lib/http.ts";
import { readStrictV2Payload } from "../lib/v2Payload.ts";
import { v2BodyKeys } from "../lib/v2RouteInventory.ts";
import { config } from "../lib/config.ts";
import { hmacHash } from "../lib/crypto.ts";
import { gateMatterAccess, resolveAccess, verifyActiveSeat, verifyTicketSeatBinding, toUpdateFrame, fanout, MAX_UPDATE_BYTES, type FanoutHub } from "../lib/matters.ts";
import { syncTickets, type SyncTicketStore } from "../lib/syncTickets.ts";
import type { Store } from "../lib/db.ts";
import type { AccessTokenClaims, MatterRole } from "../lib/types.ts";

const HANDLE = /^(?:mh2_|sh2_)[A-Za-z0-9_-]{43}$/;
// Relay update ids are 256-bit random handles. They are metadata visible to
// the relay and other subscribers, so accepting a descriptive string here
// would create a plaintext channel around the encrypted descriptor boundary.
const BLOB_ID = /^bh2_[A-Za-z0-9_-]{43}$/;
const PROVISIONING_NONCE = /^pn2_[A-Za-z0-9_-]{43}$/;
const CIPHERTEXT_V2_BYTES_MIN = 1 + 12 + 16;
// This is a transport-shape guard, not a claim that the relay can prove
// encryption. An authorized client which already has plaintext and its key can
// deliberately put readable bytes in its own payload; only the recipient can
// authenticate/decrypt it. The relay's enforceable boundary is routing and ACL
// metadata, plus preventing one client from causing another client's leak.
const matterHandle = (value: string) => value.startsWith("mh2_") && HANDLE.test(value);
const streamHandle = (value: string) => value.startsWith("sh2_") && HANDLE.test(value);
const roles = new Set<MatterRole>(["owner", "editor", "viewer"]);

function admin(req: Request): { ok: true; claims: AccessTokenClaims } | { ok: false; resp: Response } {
  const auth = authenticate(req);
  if (!auth.ok) return { ok: false, resp: error("unauthorized", 401, auth.reason) };
  return auth.claims.role === "admin" ? { ok: true, claims: auth.claims } : { ok: false, resp: error("forbidden", 403, "admin_required") };
}
function sameOrgUser(store: Store, orgId: string, userId: string) {
  const u = store.getUser(userId);
  return !!u && u.org_id === orgId;
}
function sameOrgMatter(store: Store, orgId: string, handle: string) {
  if (!matterHandle(handle)) return null;
  const m = store.getMatter(handle);
  return m && m.org_id === orgId ? m : null;
}

export async function handleCreateMatter(req: Request, store: Store): Promise<Response> {
  const a = admin(req); if (!a.ok) return a.resp;
  const body = await readStrictV2Payload(req, v2BodyKeys("createMatter"));
  if (body === null || typeof body.provisioning_nonce !== "string" || !PROVISIONING_NONCE.test(body.provisioning_nonce)) return error("invalid_v2_payload", 400);
  const result = store.createMatterIdempotent({
    org_id: a.claims.org_id,
    user_id: a.claims.sub,
    // The relay keeps only a one-way, domain-separated retry key. It never
    // stores the raw client nonce or any readable client identity.
    nonce_hash: hmacHash(`firm-provision-v1:${a.claims.org_id}:${a.claims.sub}:${body.provisioning_nonce}`),
  });
  const matter = result.matter;
  return json({ matter_handle: matter.matter_handle, root_stream_handle: matter.root_stream_handle, key_epoch: 1, status: "provisioning" }, 201);
}
export async function handleListMatters(req: Request, store: Store): Promise<Response> {
  const a = admin(req); if (!a.ok) return a.resp;
  if (await readStrictV2Payload(req, v2BodyKeys("listMatters")) === null) return error("invalid_v2_payload", 400);
  return json({ matters: store.listMatters(a.claims.org_id).map((m) => ({ matter_handle: m.matter_handle, root_stream_handle: m.root_stream_handle, status: m.status, key_epoch: m.key_epoch })) });
}
export async function handleActivateMatter(req: Request, store: Store, handle: string): Promise<Response> {
  const a = admin(req); if (!a.ok) return a.resp;
  if (await readStrictV2Payload(req, v2BodyKeys("activateMatter")) === null) return error("invalid_v2_payload", 400);
  const m = sameOrgMatter(store, a.claims.org_id, handle); if (!m) return error("matter_not_found", 404);
  // Provisioning is the only forward transition. Archived is terminal and is
  // deliberately surfaced as the same opaque denial as an unknown matter.
  if (m.status !== "provisioning") return error("matter_not_found", 404);
  if (!store.activateProvisioningMatter(handle)) return error("matter_not_found", 404);
  store.audit({ org_id: a.claims.org_id, actor_user_id: a.claims.sub, action: "matter.activate", target: handle, detail: { op: "activate", epoch: m.key_epoch } });
  return json({ ok: true, matter_handle: handle, status: "active", key_epoch: m.key_epoch });
}
export async function handleArchiveMatter(req: Request, store: Store, handle: string, hub: FanoutHub = fanout): Promise<Response> {
  const a = admin(req); if (!a.ok) return a.resp;
  if (await readStrictV2Payload(req, v2BodyKeys("archiveMatter")) === null) return error("invalid_v2_payload", 400);
  const m = sameOrgMatter(store, a.claims.org_id, handle); if (!m) return error("matter_not_found", 404);
  if (!store.archiveMatter(handle)) return error("matter_not_found", 404);
  // Archive is terminal: active relay sockets must not keep receiving ciphertext.
  // Do not extend this to wall/member changes; that separate pre-existing issue
  // is intentionally outside this archive-only change.
  hub.evictMatter(handle);
  store.audit({ org_id:a.claims.org_id, actor_user_id:a.claims.sub, action:"matter.archive", target:handle, detail:{op:"archive"} });
  return json({ ok:true, status:"archived" });
}
/**
 * Owner-only reclamation after the owner has tombstoned the document mapping
 * inside the encrypted root index and published that root update. The relay
 * cannot inspect that proof without breaking E2EE, so it only performs this
 * explicit, audited destructive action for the recorded matter owner.
 */
export async function handleReleaseMatterStream(req: Request, store: Store, handle: string, hub: FanoutHub = fanout): Promise<Response> {
  const auth = authenticate(req); if (!auth.ok) return error("unauthorized", 401, auth.reason);
  const b = await readStrictV2Payload(req, v2BodyKeys("releaseMatterStream"));
  if (!b || !isNonEmptyString(b.stream_handle, 64) || !streamHandle(b.stream_handle)) return error("invalid_v2_payload", 400);
  const m = sameOrgMatter(store, auth.claims.org_id, handle); if (!m || m.status !== "active") return error("matter_not_found", 404);
  // Reclamation belongs to the recorded matter owner. It intentionally does
  // not require the separate organization-admin role.
  if (store.getMatterMember(handle, auth.claims.sub)?.role !== "owner") return error("forbidden", 403);
  if (!store.releaseMatterStream(handle, b.stream_handle)) return error("stream_not_found", 404);
  // Delete the subscription set after the durable release succeeds. Existing
  // sockets can no longer retain a released stream's resource slot.
  hub.evictStream(handle, b.stream_handle);
  store.audit({ org_id: auth.claims.org_id, actor_user_id: auth.claims.sub, action: "matter.stream.release", target: handle, detail: { op: "stream_release" } });
  return json({ ok: true });
}
/**
 * Owner-only recovery for handles that a malicious or broken editor bound but
 * never placed in the encrypted private index. The relay returns handles only;
 * it cannot and must not try to infer which encrypted document owns one.
 */
export async function handleListMatterStreams(req: Request, store: Store, handle: string): Promise<Response> {
  const auth = authenticate(req); if (!auth.ok) return error("unauthorized", 401, auth.reason);
  if (await readStrictV2Payload(req, v2BodyKeys("listMatterStreams")) === null) return error("invalid_v2_payload", 400);
  const m = sameOrgMatter(store, auth.claims.org_id, handle); if (!m || m.status !== "active") return error("matter_not_found", 404);
  if (store.getMatterMember(handle, auth.claims.sub)?.role !== "owner") return error("forbidden", 403);
  return json({ stream_handles: store.listLiveMatterStreamHandles(handle) });
}
export async function handleAddMatterMember(req: Request, store: Store, handle: string): Promise<Response> {
  const a=admin(req); if(!a.ok) return a.resp;
  const b=await readStrictV2Payload(req,v2BodyKeys("addMatterMember")); if(!b||!isNonEmptyString(b.user_id,64)||!sameOrgUser(store,a.claims.org_id,b.user_id)) return error("invalid_v2_payload",400);
  const m=sameOrgMatter(store,a.claims.org_id,handle); if(!m) return error("matter_not_found",404);
  if (!roles.has(b.role as MatterRole)) return error("invalid_v2_payload",400);
  const role=b.role as MatterRole; store.addMatterMember({matter_handle:handle,user_id:b.user_id,org_id:a.claims.org_id,role});
  // Match the original key-release decision: a wall always overrides membership.
  const key_release = store.isWalled(handle, b.user_id) ? "blocked_walled" : "release_to_member";
  store.audit({org_id:a.claims.org_id,actor_user_id:a.claims.sub,action:"matter.member.add",target:handle,detail:{op:"member_add",role}}); return json({ok:true,role,key_epoch:m.key_epoch,key_release});
}
export async function handleRemoveMatterMember(req: Request, store: Store, handle: string): Promise<Response> {
  const a=admin(req); if(!a.ok)return a.resp;
  const b=await readStrictV2Payload(req,v2BodyKeys("removeMatterMember"));if(!b||!isNonEmptyString(b.user_id,64)||!sameOrgUser(store,a.claims.org_id,b.user_id))return error("invalid_v2_payload",400);
  const m=sameOrgMatter(store,a.claims.org_id,handle);if(!m)return error("matter_not_found",404); const removed=store.removeMatterMember(handle,b.user_id);const epoch=store.bumpMatterKeyEpoch(handle);store.deleteWrappedKeysForUser(handle,b.user_id);store.deleteWrappedKeysForEpoch(handle,m.key_epoch);store.deleteWrappedIntakeKeysForUser(handle,b.user_id);store.deleteWrappedIntakeKeysForEpoch(handle,m.key_epoch);
  store.audit({org_id:a.claims.org_id,actor_user_id:a.claims.sub,action:"matter.member.remove",target:handle,detail:{op:"member_remove",count:removed?1:0,epoch}});return json({ok:true,removed,key_epoch:epoch});
}
export async function handleListMatterMembers(req: Request, store: Store, handle: string): Promise<Response> { const a=admin(req);if(!a.ok)return a.resp;if(await readStrictV2Payload(req,v2BodyKeys("listMatterMembers"))===null)return error("invalid_v2_payload",400);const m=sameOrgMatter(store,a.claims.org_id,handle);if(!m)return error("matter_not_found",404);return json({key_epoch:m.key_epoch,members:store.listMatterMembersWithEmail(handle),walls:store.listEthicalWalls(handle)}); }
export async function handleSetWall(req: Request, store: Store, handle: string): Promise<Response> { const a=admin(req);if(!a.ok)return a.resp;const b=await readStrictV2Payload(req,v2BodyKeys("setWall"));if(!b||!isNonEmptyString(b.user_id,64)||!sameOrgUser(store,a.claims.org_id,b.user_id))return error("invalid_v2_payload",400);const m=sameOrgMatter(store,a.claims.org_id,handle);if(!m)return error("matter_not_found",404);store.setEthicalWall({matter_handle:handle,user_id:b.user_id,org_id:a.claims.org_id,created_by:a.claims.sub});const epoch=store.bumpMatterKeyEpoch(handle);store.deleteWrappedKeysForUser(handle,b.user_id);store.deleteWrappedKeysForEpoch(handle,m.key_epoch);store.deleteWrappedIntakeKeysForUser(handle,b.user_id);store.deleteWrappedIntakeKeysForEpoch(handle,m.key_epoch);store.audit({org_id:a.claims.org_id,actor_user_id:a.claims.sub,action:"matter.wall.set",target:handle,detail:{op:"wall_set",epoch}});return json({ok:true,walled:true,key_epoch:epoch}); }
export async function handleClearWall(req: Request, store: Store, handle: string):Promise<Response> { const a=admin(req);if(!a.ok)return a.resp;const b=await readStrictV2Payload(req,v2BodyKeys("clearWall"));if(!b||!isNonEmptyString(b.user_id,64)||!sameOrgUser(store,a.claims.org_id,b.user_id))return error("invalid_v2_payload",400);const m=sameOrgMatter(store,a.claims.org_id,handle);if(!m)return error("matter_not_found",404);const cleared=store.clearEthicalWall(handle,b.user_id);store.audit({org_id:a.claims.org_id,actor_user_id:a.claims.sub,action:"matter.wall.clear",target:handle,detail:{op:"wall_clear",count:cleared?1:0}});return json({ok:true,cleared}); }

function relayGate(req:Request,store:Store,handle:string,seatToken:string|null,action:string) { const auth=authenticate(req);if(!auth.ok)return {ok:false as const,resp:error("unauthorized",401,auth.reason)};if(!matterHandle(handle)||!seatToken)return {ok:false as const,resp:error("seat_required",401)};const seat=verifyActiveSeat(store,seatToken,{user_id:auth.claims.sub,org_id:auth.claims.org_id});if(!seat.ok)return {ok:false as const,resp:error("seat_invalid",401,seat.reason)};const gate=gateMatterAccess(store,{org_id:auth.claims.org_id,user_id:auth.claims.sub,role:auth.claims.role},handle,action);return gate.ok?{ok:true as const,claims:auth.claims,seatId:seat.claims.seat_id,matter:gate.matter}:{ok:false as const,resp:error(gate.error,gate.http,gate.reason==="inactive"?undefined:gate.reason)}; }
/** Never reveal whether a flat stream exists before its parent access is proved. */
function opaqueStreamGate(req: Request, store: Store, handle: string, seatToken: string | null, action: string) {
  const gate = relayGate(req, store, handle, seatToken, action);
  return gate.ok ? gate : { ok: false as const, resp: error("stream_access_denied", 404) };
}
export async function handlePushUpdate(req:Request,store:Store,handle:string,stream:string,ip:string,hub:FanoutHub=fanout):Promise<Response> { if(!streamHandle(stream)){return error("stream_not_found",404)}const earlyAuth=authenticate(req);if(!earlyAuth.ok)return error("unauthorized",401,earlyAuth.reason);const rl=rateLimit(ip,"relay_push",{max:config.relayRateLimitMax,windowSeconds:config.relayRateLimitWindowSeconds});if(!rl.ok)return error("rate_limited",429);const b=await readStrictV2Payload(req,v2BodyKeys("pushUpdate"));if(!b||typeof b.blob_id!=="string"||!BLOB_ID.test(b.blob_id)||typeof b.ciphertext_b64!=="string")return error("invalid_v2_payload",400);const gate=relayGate(req,store,handle,typeof b.seat_token==="string"?b.seat_token:null,"push");if(!gate.ok)return gate.resp;const member=store.getMatterMember(handle,gate.claims.sub);if(member?.role!=="owner"&&member?.role!=="editor")return error("forbidden",403);const seatRate=rateLimit(gate.seatId,"firm_stream_write",{max:config.firmMatterStreamWriteRateLimitMax,windowSeconds:config.firmMatterStreamWriteRateLimitWindowSeconds});if(!seatRate.ok)return error("rate_limited",429);if(!Number.isInteger(b.key_epoch)||typeof b.key_epoch!=="number"||b.key_epoch<1)return error("invalid_v2_payload",400);if(!/^[A-Za-z0-9+/]+={0,2}$/.test(b.ciphertext_b64)||b.ciphertext_b64.length%4!==0)return error("invalid_v2_payload",400);let bytes:Uint8Array;try{bytes=new Uint8Array(Buffer.from(b.ciphertext_b64,"base64"));}catch{return error("invalid_v2_payload",400)}if(Buffer.from(bytes).toString("base64")!==b.ciphertext_b64)return error("invalid_v2_payload",400);if(bytes.byteLength>MAX_UPDATE_BYTES)return error("payload_too_large",413);if(bytes.byteLength<CIPHERTEXT_V2_BYTES_MIN||bytes[0]!==2)return error("invalid_v2_payload",400);const r=store.appendMatterUpdate({matter_handle:handle,org_id:gate.claims.org_id,stream_handle:stream,blob_id:b.blob_id,ciphertext:bytes,author_seat:gate.seatId,key_epoch:b.key_epoch});if("matterArchived" in r)return error("matter_not_found",404);if("streamReleased" in r)return error("stream_not_found",404);if("streamLimitReached" in r)return error("stream_limit_reached",409);if("streamSeatQuotaReached" in r)return error("stream_seat_quota_reached",409);if("streamMatterMismatch" in r)return error("forbidden",403);if(!r.duplicate)hub.broadcast(handle,toUpdateFrame(r.update),stream);return json({ok:true,cursor:r.update.id,blob_id:r.update.blob_id,key_epoch:r.update.key_epoch,duplicate:r.duplicate},r.duplicate?200:201); }
export async function handlePullUpdates(req:Request,store:Store,handle:string,stream:string,ip:string):Promise<Response> { const gate=opaqueStreamGate(req,store,handle,req.headers.get("x-seat-token"),"pull");if(!gate.ok)return gate.resp;if(!streamHandle(stream)||!store.streamBelongsToMatter(stream,handle))return error("stream_access_denied",404);if(await readStrictV2Payload(req,v2BodyKeys("pullUpdates"))===null)return error("invalid_v2_payload",400);const rl=rateLimit(ip,"relay_pull",{max:config.relayRateLimitMax,windowSeconds:config.relayRateLimitWindowSeconds});if(!rl.ok)return error("rate_limited",429);const since=Number(new URL(req.url).searchParams.get("since")??"0");if(!Number.isInteger(since)||since<0)return error("invalid_cursor",400);const updates=store.getMatterUpdatesSince(handle,stream,since);const latest=store.latestMatterCursor(handle,stream);const cursor=updates.at(-1)?.id??since;return json({key_epoch:gate.matter.key_epoch,since,cursor,latest_cursor:latest,has_more:cursor<latest,updates:updates.map(toUpdateFrame)}); }
export async function handleSyncTicket(req:Request,store:Store,handle:string,stream:string,ip:string,tickets:SyncTicketStore=syncTickets):Promise<Response> { const gate=opaqueStreamGate(req,store,handle,req.headers.get("x-seat-token"),"ticket");if(!gate.ok)return gate.resp;if(!streamHandle(stream)||!store.streamBelongsToMatter(stream,handle))return error("stream_access_denied",404);const b=await readStrictV2Payload(req,v2BodyKeys("syncTicket"));const since=b?.since;if(typeof since!=="number"||!Number.isSafeInteger(since)||since<0)return error("invalid_v2_payload",400);const rl=rateLimit(ip,"relay_ticket",{max:config.relayRateLimitMax,windowSeconds:config.relayRateLimitWindowSeconds});if(!rl.ok)return error("rate_limited",429);const r=tickets.mint({matterHandle:handle,streamHandle:stream,orgId:gate.claims.org_id,userId:gate.claims.sub,seatId:gate.seatId,role:gate.claims.role,since});return json({ticket:r.ticket,expires_in_ms:r.expiresInMs}); }
export function authorizeSyncConnect(req:Request,store:Store,tickets:SyncTicketStore=syncTickets):{ok:true;data:{matterHandle:string;streamHandle:string;orgId:string;userId:string;seatId:string;role:AccessTokenClaims["role"];since:number}}|{ok:false;resp:Response} { const ticket=new URL(req.url).searchParams.get("ticket");if(!ticket)return {ok:false,resp:error("unauthorized",401,"missing_ticket")};const b=tickets.redeem(ticket);if(!b)return {ok:false,resp:error("unauthorized",401,"invalid_ticket")};const seat=verifyTicketSeatBinding(store,{seat_id:b.seatId,user_id:b.userId,org_id:b.orgId});if(!seat.ok)return {ok:false,resp:error("seat_invalid",401,seat.reason)};const access=resolveAccess(store,{orgId:b.orgId,userId:b.userId,role:b.role},b.matterHandle);if(!access.allowed||!store.streamBelongsToMatter(b.streamHandle,b.matterHandle))return {ok:false,resp:error("forbidden",403)};return {ok:true,data:{matterHandle:b.matterHandle,streamHandle:b.streamHandle,orgId:b.orgId,userId:b.userId,seatId:b.seatId,role:b.role,since:b.since}}; }
export { resolveAccess };
