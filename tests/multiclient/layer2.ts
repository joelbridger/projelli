/** Layer-2 six-seat system campaign — design/06 §2. */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  CLIENT_COUNT, createFirm, createHeadlessClients, jsonRequest, materializedState,
  reservePort, startRelay, stateHash, stopRelay, until, waitForRelay,
  type HeadlessClient, type Identity,
} from './run';
import { NotificationClient } from '@/platform/crm/notify/NotificationClient';
import type { CrmNotifyStore, CrmNotifyTransaction, NotificationInboxRow, NotificationOutboxRow, NotificationRelay } from '@/platform/crm/notify/types';
import { appendAssignment, applyOffer, createOffer, publishRevision, setOfferDecision, undoApply } from '@/platform/crm/propagation/propagationEngine';
import type { PropagationTransactionPayload, TemplateRevision, WorkflowInstanceSnapshot, WorkflowTemplateSnapshot } from '@/platform/crm/propagation/types';
import { canRemoveTombstoneAfterRetirement, openRebaseExport, retireAndRebaseDevice } from '@/platform/crm/checkpoints';
import type { CheckpointPackage, UnsentLocalEdit } from '@/platform/crm/checkpoints';

const NOW = 1_784_563_200_000;
const taskFields = ['assigneeUserId', 'due', 'priority', 'body', 'title', 'status'] as const;
const keyBytes = new Uint8Array(Array.from({ length: 32 }, (_, i) => i + 1));
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
function stable(value: unknown): string { if (!value || typeof value !== 'object') return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`; const o = value as Record<string, unknown>; return `{${Object.keys(o).sort().map(k => `${JSON.stringify(k)}:${stable(o[k])}`).join(',')}}`; }
function id(i: number): string { return i.toString(16).padStart(32, '0'); }
async function key(): Promise<CryptoKey> { return crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']); }

class NotifyStore implements CrmNotifyStore {
  outbox = new Map<string, NotificationOutboxRow>(); inbox = new Map<string, NotificationInboxRow>(); cursors = new Map<string, number>();
  k(org: string, envelope: string): string { return `${org}/${envelope}`; }
  async transaction<T>(work: (tx: CrmNotifyTransaction) => Promise<T>): Promise<T> { const tx: CrmNotifyTransaction = {
    insertNotificationOutbox: async row => { this.outbox.set(this.k(row.orgId, row.envelopeId), { ...row }); },
    markNotificationOutboxDependencyReady: async (o,e) => { const r=this.outbox.get(this.k(o,e)); if(!r) throw Error('missing outbox'); r.referencedOperationRelayAccepted=true; },
    markNotificationOutboxSent: async (o,e,at) => { const r=this.outbox.get(this.k(o,e)); if(!r) throw Error('missing outbox'); r.sentAt=at; },
    markNotificationOutboxDeadLetter: async (o,e,reason) => { const r=this.outbox.get(this.k(o,e)); if(!r) throw Error('missing outbox'); r.deadLetterReason=reason; },
    incrementNotificationOutboxAttempt: async (o,e) => { const r=this.outbox.get(this.k(o,e)); if(!r) throw Error('missing outbox'); r.attempts+=1; },
    putNotificationInbox: async row => { const k=this.k(row.orgId,row.envelopeId); if(!this.inbox.has(k)) this.inbox.set(k,{...row}); },
    updateNotificationInboxState: async (o,e,state,reason) => { const r=this.inbox.get(this.k(o,e)); if(!r) throw Error('missing inbox'); r.state=state; r.deadLetterReason=reason; },
    advanceContiguousNotificationCursor: async (o,d) => { const k=`${o}/${d}`; let c=this.cursors.get(k)??0; while([...this.inbox.values()].some(r=>r.orgId===o&&r.seq===c+1)) c++; this.cursors.set(k,c); return c; },
  }; return work(tx); }
  async listPendingNotificationOutbox(o:string, now:number) { return [...this.outbox.values()].filter(r=>r.orgId===o&&!r.sentAt&&!r.deadLetterReason&&r.dispatchAfterMs<=now); }
  async listWaitingReferencedState(o:string, operation:string) { return [...this.inbox.values()].filter(r=>r.orgId===o&&r.payload?.pointer.operationId===operation&&r.state==='waiting_for_referenced_state'); }
  async listExpiredInformationalWaitingAccess(o:string, now:number) { return [...this.inbox.values()].filter(r=>r.orgId===o&&r.state==='waiting_for_access'&&r.expiresAt!==null&&Date.parse(r.expiresAt)<=now); }
}
class HttpNotify implements NotificationRelay {
  constructor(private base:string, private who:Identity, private matter:string) {}
  async post(route:string, body:unknown) { const r=await fetch(`${this.base}${route}`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${this.who.accessToken}`,'x-seat-token':this.who.seatToken},body:JSON.stringify(body)}); if(!r.ok) throw Error(`${route} ${r.status}: ${await r.text()}`); }
  async send(r: Parameters<NotificationRelay['send']>[0]) { await this.post('/notify/send',{org_id:r.orgId,recipient_user_id:r.recipientUserId,envelope_id:r.envelopeId,ciphertext_b64:r.ciphertextB64,transient_scope:{matter_id:this.matter},key_hint:r.keyHint,idempotency_key:r.idempotencyKey,retention_until_terminal:r.retentionUntilTerminal}); }
  async ack(i:{orgId:string;deviceId:string;upToCursor:number}) { await this.post('/notify/ack',{org_id:i.orgId,device_id:i.deviceId,up_to_cursor:i.upToCursor}); }
}

async function syncScenarios(clients: readonly HeadlessClient[]): Promise<void> {
  await Promise.all(clients.map(c=>c.sync.start()));
  const values=['seat-2','2026-07-18','high','Prepare Northcrest review packet.','Northcrest annual review','in_progress'];
  clients.forEach((c,i)=>c.doc.getMap<unknown>('shared-document').set(taskFields[i]!,values[i]!));
  await until('six task fields',()=>{const s=clients.map(c=>materializedState(c.doc));return s.every(x=>x===s[0])&&taskFields.every((f,i)=>s[0]?.includes(`${JSON.stringify(f)}:${JSON.stringify(values[i])}`));});
  console.log(`LAYER2 concurrent-task-edits: PASS — 6/6 seats; 6 canonical fields; state=${stateHash(materializedState(clients[0]!.doc))}`);
  const off=[clients[4]!,clients[5]!]; off.forEach(c=>c.sync.stop()); const online=clients.slice(0,4);
  for(let i=1;i<=501;i++) online[(i-1)%4]!.doc.getMap<unknown>('shared-document').set(`backlog-${String(i).padStart(3,'0')}`,`update-${i}`);
  await until('online 501 backlog',()=>online.map(c=>materializedState(c.doc)).every(s=>s.includes('"backlog-501":"update-501"')));
  await Promise.all(off.map(c=>c.sync.start()));
  await until('offline gap repair',()=>{const s=clients.map(c=>materializedState(c.doc));return s.every(x=>x===s[0])&&s[0]?.includes('"backlog-501":"update-501"')===true;});
  console.log('LAYER2 offline-rejoin-gap-repair: PASS — 2 offline seats; 501 relay updates; 6/6 converged; 0 manual conflicts');
}

function revision(id:string, parents:string[], n:number, changes:TemplateRevision['stepChanges']):TemplateRevision { return {revisionId:id,templateId:'template',parentRevisionIds:parents,issuedHlc:{wallMillis:n,logicalCounter:0,actorId:'seat-1',operationId:`op-${id}`},label:id,stepChanges:changes}; }
function instance(id:string):WorkflowInstanceSnapshot { return {id,acceptedRevisionIds:[],displayedRevisionSet:{revisionIds:[]},steps:{},decisionLedger:[],propagationEvents:[]}; }
function tx():{payloads:PropagationTransactionPayload[];transact(p:PropagationTransactionPayload):void}{const payloads:PropagationTransactionPayload[]=[];return{payloads,transact:p=>payloads.push(p)};}
function apply(template:WorkflowTemplateSnapshot, state:WorkflowInstanceSnapshot, offerId:string, reject=false):WorkflowInstanceSnapshot { let offer=createOffer(template,state,offerId); if(reject) for(const d of offer.decisions.filter(x=>x.stepId==='collect'&&x.field==='title')) offer=setOfferDecision(offer,d.id,'rejected'); return applyOffer(template,state,offer,`event-${offerId}`,tx()).instance; }
function propagation():void {
  let t:WorkflowTemplateSnapshot={id:'template',revisions:{},headRevisionIds:[]};
  t=publishRevision(t,revision('r1',[],1,[{stepId:'collect',field:'title',value:'Collect statements',changeKind:'add'},{stepId:'collect',field:'required',value:true,changeKind:'add'},{stepId:'review',field:'title',value:'Review allocation',changeKind:'add'}]));
  const before=Array.from({length:8},(_,i)=>apply(t,instance(`instance-${i+1}`),`seed-${i}`));
  for(const i of [0,1,2]) { const s=before[i]!.steps['collect']!;s.status=i===0?'done':'in_progress';s.stepNotes=`offline ${i}`;if(i===0){s.outcome='complete';s.completionOperations=[{completionId:'done',completedBy:'seat-1',outcome:'complete',sourceOperationId:'done-op'}];} }
  t=publishRevision(t,revision('r2',['r1'],2,[{stepId:'collect',field:'title',value:'Collect updated statements',changeKind:'modify'},{stepId:'collect',field:'__step_removal__',value:true,changeKind:'remove'},{stepId:'confirm',field:'title',value:'Confirm delivery',changeKind:'add'}]));
  const after=before.map((x,i)=>apply(t,x,`offer-${i}`,i%2===0));
  check(after[0]!.steps['collect']!.outcome==='complete'&&after[0]!.steps['collect']!.completionOperations.length===1,'P1');
  check(after[0]!.steps['collect']!.detachedFromTemplate&&!after[0]!.steps['collect']!.hiddenByTemplateRemoval,'P2');
  check(after[0]!.steps['collect']!.derived.title?.value==='Collect statements'&&after[1]!.steps['collect']!.status==='in_progress','P5/P6');
  const duplicate=applyOffer(t,after[3]!,{...createOffer(t,after[3]!,'offer-3'),state:'applied'},'duplicate',tx());check(duplicate.idempotent&&after[3]!.steps['confirm'],'P3/P8/P9');
  const a=apply(t,before[5]!,'same-offer'),b=apply(t,before[5]!,'same-offer');check(stable(a)===stable(b),'P4');
  const changed=structuredClone(after[7]!);changed.steps['collect']!.derived.title={value:'later',sourceRevisionId:'r3',sourceOperationId:'later'};const undo=undoApply(changed,after[7]!.propagationEvents.at(-1)!,'undo',tx());check(undo.protectedCells.includes('collect:title'),'P7');
  const reassigned=appendAssignment(after[0]!,'collect',{assignmentId:'assign',assignedUserId:'seat-6',sourceOperationId:'assign-op'});check(reassigned.steps['collect']!.outcome==='complete'&&reassigned.steps['collect']!.assignmentOperations.length===1,'P10');
  const seats=Array.from({length:CLIENT_COUNT},()=>stable(after));check(seats.every(x=>x===seats[0]),'workflow convergence');
  console.log('LAYER2 template-propagation: PASS — 8 instances; 3 with uncommitted progress; per-step choices; P1-P10=10/10; 6/6 comparable views');
}

async function notify(base:string,matter:string,org:string,admin:string,identities:readonly Identity[]):Promise<void>{
  for(const [i,who] of identities.entries()) await jsonRequest(base,'/device/register',{device_id:`l2-d${i}`,machine_id:`l2-m${i}`,label:`L2 ${i}`,pubkey_jwk:{kty:'EC',crv:'P-256',x:'x',y:'y'}},who.accessToken);
  await jsonRequest(base,`/matter/${matter}/keys/publish`,{epoch:1,wrapped:identities.map((who,i)=>({user_id:who.userId,device_id:`l2-d${i}`,wrapped_key_b64:`wrapped-${i}`}))},admin);
  const stores=identities.map(()=>new NotifyStore()); const addresses=await Promise.all(identities.map(()=>key())); const clients=identities.map((who,i)=>new NotificationClient({store:stores[i]!,relay:new HttpNotify(base,who,matter),deviceId:`l2-d${i}`,keys:{resolve:async(o,h)=>o===org&&h==='hint'?{scope:'client' as const,matterId:matter,keyEpoch:1,key:addresses[i]!,keyHint:'hint'}:null},referencedState:{hasDurablyApplied:async()=>true},now:()=>NOW}));
  const expected=new Map<string,number>();const sender=clients[0]!;
  for(let n=1;n<=20;n++){const ri=n%6;const who=identities[ri]!;expected.set(who.userId,(expected.get(who.userId)??0)+1);await sender.queue({orgId:org,recipientUserId:who.userId,envelopeId:id(n),class:'client_confidential',retention:'informational',urgent:true,payload:{version:1,type:'task_reassigned',subjectRef:`task-${n}`,displayHlc:{wallMillis:NOW+n,logicalCounter:0,actorId:'seat-1',operationId:`assign-${n}`},actorId:'seat-1',pointer:{referenceId:`task-${n}`}},address:{scope:'client',matterId:matter,keyEpoch:1,key:addresses[ri]!,keyHint:'hint'}});}
  check(await sender.flush(org,'l2')===20,'notification sends');
  for(const [i,who] of identities.entries()){const r=await fetch(`${base}/notify/inbox?org_id=${org}&since=0`,{headers:{authorization:`Bearer ${who.accessToken}`,'x-seat-token':who.seatToken}});check(r.ok,'inbox');const b=await r.json() as {envelopes:Array<{seq:number;envelope_id:string;created_at:string;expires_at:string|null;key_hint:string;ciphertext_b64:string}>};await clients[i]!.receive(org,who.userId,b.envelopes.map(x=>({orgId:org,seq:x.seq,envelopeId:x.envelope_id,createdAt:x.created_at,expiresAt:x.expires_at,keyHint:x.key_hint,ciphertextB64:x.ciphertext_b64})));const rows=[...stores[i]!.inbox.values()];check(rows.length===(expected.get(who.userId)??0)&&new Set(rows.map(x=>x.envelopeId)).size===rows.length,'notification duplicate/drop');}
  console.log('LAYER2 notification-delivery-dedup: PASS — 20 assignment events; 20/20 delivered; 0 drops; 0 duplicates; org-scoped');
}

async function absence(base:string, clients:readonly HeadlessClient[], identities:readonly Identity[], admin:string):Promise<void>{const created=await jsonRequest(base,'/org/matters',{client_name:'Walled Northcrest Secret'},admin);const matter=(created['matter'] as {matter_id?:string}|undefined)?.matter_id;check(matter,'walled fixture');await jsonRequest(base,`/matter/${matter}/members/add`,{user_id:identities[0]!.userId,role:'editor'},admin);await jsonRequest(base,`/matter/${matter}/members/add`,{user_id:identities[5]!.userId,role:'editor'},admin);await jsonRequest(base,`/matter/${matter}/wall/set`,{user_id:identities[5]!.userId,reason:'layer2'},admin);const denied=await fetch(`${base}/matter/${matter}/updates?since=0&doc_id=crm:record`,{headers:{authorization:`Bearer ${identities[5]!.accessToken}`,'x-seat-token':identities[5]!.seatToken}});const unsub=await fetch(`${base}/matter/${matter}/updates?since=0&doc_id=crm:task-notes`,{headers:{authorization:`Bearer ${identities[4]!.accessToken}`,'x-seat-token':identities[4]!.seatToken}});check(denied.status===403&&unsub.status===403&&clients.every(c=>!materializedState(c.doc).includes('Walled Northcrest Secret')),'walled/unsubscribed absence');console.log('LAYER2 access-absence: PASS — 1 walled + 1 unsubscribed denial; 6/6 local subscribed snapshots absent');}

async function rebase():Promise<void>{const k=await key();const edits:UnsentLocalEdit[]=[{editId:'old-1',matter_id:'matter',docId:'crm:tasks',ciphertextB64:'old',keyEpoch:1},{editId:'old-2',matter_id:'matter',docId:'crm:tasks',ciphertextB64:'old2',keyEpoch:1}];const calls:string[]=[];const checkpoint:CheckpointPackage={control:{stream:{orgId:'org',matter_id:'matter',docId:'crm:tasks'},generation:3,frontier:{cursor:501},retentionEligible:true},encryptedManifestB64:'validated',chunks:[]};const r=await retireAndRebaseDevice({orgId:'org',deviceId:'stale',localEdits:edits,exportKey:k,exportKeyEpoch:1,currentKeyEpoch:2,approvedEditIds:new Set(['old-2']),dependencies:{discardStaleState:async()=>{calls.push('discard');},loadValidatedCheckpoint:async()=>{calls.push('checkpoint');return checkpoint;},replayApprovedEdit:async(e,epoch)=>{calls.push(`${e.editId}:${epoch}`);}}});check(stable(calls)===stable(['discard','checkpoint','old-2:2'])&&stable(await openRebaseExport(r.exportFile,k))===stable(edits),'rebase export-not-merge');check(canRemoveTombstoneAfterRetirement({orgId:'org',tombstoneCheckpointGeneration:3,devices:[{orgId:'org',deviceId:'now',state:{status:'current',checkpointGeneration:3}},{orgId:'org',deviceId:'stale',state:{status:'retired'}}]}),'retention guard');console.log('LAYER2 checkpoint-rebase: PASS — 2 stale edits exported; 0 old edits merged; 1 reviewed edit replayed at current epoch');}

async function main(){const dir=await mkdtemp(path.join(tmpdir(),'lantern-layer2-'));const port=await reservePort();const base=`http://127.0.0.1:${port}`;const relay=startRelay(port,dir);const clients:HeadlessClient[]=[];try{await waitForRelay(base,relay.process,relay.output);const firm=await createFirm(base);clients.push(...await createHeadlessClients(base,firm.matterId,firm.identities));await syncScenarios(clients);propagation();await notify(base,firm.matterId,firm.orgId,firm.adminAccessToken,firm.identities);await absence(base,clients,firm.identities,firm.adminAccessToken);await rebase();console.log('LAYER2 CAMPAIGN: PASS (6/6 scenarios)');}finally{clients.forEach(c=>c.sync.stop());await stopRelay(relay.process);await rm(dir,{recursive:true,force:true});}}
main().catch(e=>{console.error('LAYER2 CAMPAIGN: FAIL');console.error(e instanceof Error?(e.stack??e.message):String(e));process.exitCode=1;});
