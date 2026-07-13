/* eslint-disable lantern-i18n/no-hardcoded-string -- Frozen CRM screen copy needs its translation catalog in a separate product change. */
import { useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, GripVertical, Landmark, Plus, Settings2 } from 'lucide-react';
import { SurfaceHeader } from '@/ui/SurfaceHeader';
import { Button } from '@/ui/kp';
import { useLiveCrmRecords } from '@/platform/crm/useLiveCrmRecords';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import type { Opportunity, PipelineDef, StageDef, StageTriggerRule } from '@/platform/crm/types';
import { OpportunityContactActions, OpportunityContactActionsEditor, type OpportunityContactActionStep } from './OpportunityContactActions';
import type { CrmHouseholdAddRequest } from '@/features/crm-home/routes';

type PipelineRoute = 'pipeline' | 'pipeline-settings';
type PipelineData = Pick<ReturnType<typeof useLiveCrmRecords>, 'records' | 'save' | 'error' | 'freshness'>;
type StoredPipeline = LiveCrmRecord & PipelineDef;
type StoredStage = LiveCrmRecord & StageDef;
type StoredOpportunity = LiveCrmRecord & Opportunity & { fee?: { value: number; currency: string }; notes?: string; contactActionSteps?: OpportunityContactActionStep[] };

const card = { border: '1px solid var(--kp-border)', borderRadius: 'var(--radius-lg)', background: 'var(--kp-surface)', padding: 'var(--kp-space-md)' } as const;
const muted = { color: 'var(--kp-text-faint)', fontSize: 'var(--kp-font-sm)' } as const;
const fieldStyle = { display: 'grid', gap: 4, fontSize: 'var(--kp-font-sm)' } as const;
const localActor = { userId: 'local-user', display: 'You', kind: 'user' as const };
const localSource = { origin: 'user' as const, sources: [] };

function id(prefix: string) { return `${prefix}:${crypto.randomUUID()}`; }
function now() { return new Date().toISOString(); }
function label(record: LiveCrmRecord) { return typeof record['name'] === 'string' && record['name'].trim() ? record['name'] : 'Untitled household'; }
function money(value: unknown) {
  const number = typeof value === 'object' && value && typeof (value as { value?: unknown }).value === 'number' ? (value as { value: number }).value : undefined;
  return number === undefined ? 'Not set' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(number);
}
function base(kind: string, recordId: string, matterId = 'firm_home'): LiveCrmRecord {
  const time = now();
  return { id: recordId, kind, matterId, createdAt: time, createdBy: localActor, updatedAt: time, updatedBy: localActor, source: localSource, deleted: false, externalRefs: [], schemaVersion: 1 };
}
function saved(previous: LiveCrmRecord | undefined, update: LiveCrmRecord): LiveCrmRecord { return { ...previous, ...update, updatedAt: now(), updatedBy: localActor }; }
function active<T extends LiveCrmRecord>(records: readonly T[]): T[] { return records.filter((record) => record['archived'] !== true && record['deleted'] !== true); }

function PipelineHome({ data, onNavigate, addRequest, onAddRequestConsumed }: { data: PipelineData; onNavigate: (route: PipelineRoute) => void; addRequest?: CrmHouseholdAddRequest; onAddRequestConsumed?: () => void }) {
  const [creating, setCreating] = useState(addRequest?.kind === 'opportunity');
  const [creatingHouseholdId, setCreatingHouseholdId] = useState<string | undefined>(
    addRequest?.kind === 'opportunity' ? addRequest.householdId : undefined
  );
  const [editing, setEditing] = useState<StoredOpportunity | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const pipelines = useMemo(() => active(data.records.filter((record): record is StoredPipeline => record.kind === 'pipelineDef')), [data.records]);
  const stages = useMemo(() => active(data.records.filter((record): record is StoredStage => record.kind === 'stageDef')), [data.records]);
  const opportunities = useMemo(() => active(data.records.filter((record): record is StoredOpportunity => record.kind === 'opportunity')), [data.records]);
  const households = useMemo(() => active(data.records.filter((record) => record.kind === 'household')), [data.records]);
  const selectedPipeline = pipelines[0];
  const pipelineStages = selectedPipeline ? selectedPipeline.stageOrder.map((stageId) => stages.find((stage) => stage.id === stageId)).filter((stage): stage is StoredStage => Boolean(stage)) : [];
  const openOpportunityCount = selectedPipeline ? opportunities.filter((opportunity) => opportunity.pipelineId === selectedPipeline.id && opportunity.status === 'open').length : 0;
  const templateName = (templateId: string | undefined) => { const value = data.records.find((record) => record.id === templateId && record.kind === 'workflowTemplate')?.['name']; return typeof value === 'string' ? value : undefined; };
  const save = async (record: LiveCrmRecord) => { await data.save(record); };

  const updateAction = async (opportunity: StoredOpportunity, action: OpportunityContactActionStep, state: OpportunityContactActionStep['state'], proposalId?: string) => {
    const contactActionSteps = (opportunity.contactActionSteps ?? []).map((item) => item.id === action.id ? { ...item, state, ...(proposalId ? { proposalId } : {}) } : item);
    const updated = saved(opportunity, { ...opportunity, contactActionSteps }) as StoredOpportunity;
    await save(updated);
    return updated;
  };
  const prepareContactAction = async (opportunity: StoredOpportunity, action: OpportunityContactActionStep) => {
    if (action.state !== 'ready') return;
    const proposalId = id('contact-action-proposal');
    await updateAction(opportunity, action, 'pending_approval', proposalId);
    await save({ ...base('crm_opportunity_contact_action_proposal', proposalId, opportunity.householdId), opportunityId: opportunity.id, householdId: opportunity.householdId, workflowStepId: action.id, workflowStepTitle: action.title, action, state: 'pending', proposedBy: { userId: 'lantern-ai', display: 'Lantern', kind: 'ai' }, rationale: `Lantern proposes: ${action.title}. This change is waiting for your approval.`, createdAt: now(), updatedAt: now() });
    setMessage('Contact action is ready for your approval. Nothing has changed yet.');
  };
  const approveContactAction = async (opportunity: StoredOpportunity, action: OpportunityContactActionStep) => {
    if (action.state !== 'pending_approval' || !action.proposalId) return;
    const proposal = data.records.find((record) => record.id === action.proposalId && record.kind === 'crm_opportunity_contact_action_proposal');
    if (!proposal || proposal['state'] !== 'pending') { setMessage('This approval is no longer available.'); return; }
    const household = households.find((record) => record.id === opportunity.householdId);
    if (!household) { setMessage('This opportunity no longer has a contact to update.'); return; }
    if (action.kind === 'field_update') {
      const customFields = household['customFields'] && typeof household['customFields'] === 'object' ? household['customFields'] as Record<string, unknown> : {};
      await save(saved(household, { ...household, customFields: { ...customFields, [action.fieldName ?? 'Contact field']: action.value ?? '' } }));
    } else if (action.kind === 'tag_add') {
      const tagName = action.tagName?.trim() || 'New tag';
      const existingTag = data.records.find((record) => record.kind === 'tag' && record['name'] === tagName);
      const tagId = existingTag?.id ?? id('tag');
      if (!existingTag) await save({ ...base('tag', tagId), name: tagName, color: 'blue', archived: false });
      const tagIds = Array.isArray(household['tagIds']) ? household['tagIds'].filter((value): value is string => typeof value === 'string') : [];
      await save(saved(household, { ...household, tagIds: [...new Set([...tagIds, tagId])] }));
    } else {
      await save({ ...base('task', id('task'), opportunity.householdId), householdRef: { kind: 'household', id: opportunity.householdId, matterId: opportunity.householdId }, title: action.taskTitle?.trim() || action.title, body: '', assigneeUserId: null, status: 'open', priority: 'normal', contextRefs: [{ kind: 'opportunity', id: opportunity.id, matterId: 'firm_home' }], customFields: {} });
    }
    await updateAction(opportunity, action, 'complete');
    await save(saved(proposal, { ...proposal, state: 'approved', decidedAt: now(), decidedBy: localActor }));
    await save({ ...base('activityEvent', id('activity')), at: now(), summary: `Approved contact action: ${action.title}`, actor: localActor, verb: 'opportunity.contact_action_approved', targetRef: { kind: 'opportunity', id: opportunity.id, matterId: 'firm_home' } });
    setMessage('Approved and applied to the contact.');
  };
  const dismissContactAction = async (opportunity: StoredOpportunity, action: OpportunityContactActionStep) => {
    if (action.state !== 'pending_approval' || !action.proposalId) return;
    const proposal = data.records.find((record) => record.id === action.proposalId && record.kind === 'crm_opportunity_contact_action_proposal');
    await updateAction(opportunity, action, 'dismissed');
    if (proposal) await save(saved(proposal, { ...proposal, state: 'dismissed', decidedAt: now(), decidedBy: localActor }));
    setMessage('Contact action dismissed. Nothing changed.');
  };

  const move = async (opportunity: StoredOpportunity, stage: StoredStage) => {
    if (opportunity.stageId === stage.id) return;
    const status = stage.statusEffect === 'won' ? 'won' : stage.statusEffect === 'lost' ? 'lost' : 'open';
    const moved = saved(opportunity, { ...opportunity, stageId: stage.id, status, ...(status !== 'open' ? { closedAt: now() } : { closedAt: undefined }) });
    await save(moved);
    const triggers = stage.triggerRules.filter((rule) => rule.event === 'entered' && rule.enabled && Boolean(rule.workflowTemplateId));
    for (const rule of triggers) {
      const proposalId = id('proposal');
      await save({ ...base('proposalRecord', proposalId), householdRef: { kind: 'household', id: opportunity.householdId, matterId: opportunity.householdId }, proposalKind: 'workflow_launch', proposedMutation: { kind: 'workflow_launch', workflowTemplateId: rule.workflowTemplateId }, proposedBy: { userId: 'lantern-ai', display: 'Lantern', kind: 'ai' }, rationale: `Moving “${opportunity.name}” into ${stage.name} suggests “${templateName(rule.workflowTemplateId) ?? 'the linked workflow'}”. It is waiting for your approval.`, contextRefs: [{ kind: 'opportunity', id: opportunity.id, matterId: 'firm_home' }], state: 'pending' });
    }
    setMessage(triggers.length ? `Moved to ${stage.name}. The linked workflow is ready for your approval, and has not started.` : `Moved to ${stage.name}.`);
  };

  return <main data-testid="crm-pipeline-surface" style={{ flex: 1, overflow: 'auto', padding: 'var(--kp-space-lg)', display: 'grid', alignContent: 'start', gap: 'var(--kp-space-md)' }}>
    <SurfaceHeader Icon={Landmark} title="Pipeline" description="Potential client work, kept in one clear place." actions={<span style={{ display: 'flex', gap: 8 }}><Button data-testid="crm-pipeline-settings" variant="secondary" iconLeft={Settings2} onClick={() => { onNavigate('pipeline-settings'); }}>Settings</Button><Button data-testid="crm-pipeline-new" iconLeft={Plus} disabled={!selectedPipeline || !pipelineStages.length || !households.length} onClick={() => { setCreatingHouseholdId(undefined); setCreating(true); }}>New opportunity</Button></span>} />
    {data.error ? <section role="alert" style={card}>Could not load saved pipeline records: {data.error}</section> : null}
    {!households.length ? <section data-testid="crm-pipeline-first-use-households" style={card}><strong>Start with a household</strong><p style={muted}>Create a household in Clients first. An opportunity always belongs to a real household.</p></section> : !pipelines.length ? <section data-testid="crm-pipeline-first-use-pipeline" style={card}><strong>Set up your first pipeline</strong><p style={muted}>Add the stages your firm uses. Nothing has been pre-filled for you.</p><Button data-testid="crm-pipeline-create-first" onClick={() => { onNavigate('pipeline-settings'); }}>Set up pipeline</Button></section> : !pipelineStages.length ? <section data-testid="crm-pipeline-first-use-stages" style={card}><strong>Add a stage</strong><p style={muted}>This pipeline has no active stages yet.</p><Button data-testid="crm-pipeline-add-stage-first" onClick={() => { onNavigate('pipeline-settings'); }}>Manage stages</Button></section> : <>
      <section style={{ ...card, padding: 'var(--kp-space-sm)' }}><strong>{selectedPipeline!.name}</strong><span style={muted}> · {openOpportunityCount} open {openOpportunityCount === 1 ? 'opportunity' : 'opportunities'}</span></section>
      <div data-testid="crm-pipeline-board" style={{ display: 'grid', gridTemplateColumns: `repeat(${String(Math.max(pipelineStages.length, 1))}, minmax(220px, 1fr))`, gap: 10, overflowX: 'auto' }}>{pipelineStages.map((stage) => <StageColumn key={stage.id} stage={stage} opportunities={opportunities.filter((opportunity) => opportunity.pipelineId === selectedPipeline!.id && opportunity.stageId === stage.id)} householdName={(householdId) => label(households.find((household) => household.id === householdId) ?? ({ id: householdId, kind: 'household' } as LiveCrmRecord))} onDrop={(opportunity) => { void move(opportunity, stage); }} onEdit={setEditing} onPrepareAction={(opportunity, action) => { void prepareContactAction(opportunity, action); }} onApproveAction={(opportunity, action) => { void approveContactAction(opportunity, action); }} onDismissAction={(opportunity, action) => { void dismissContactAction(opportunity, action); }} />)}</div>
    </>}
    {message ? <p data-testid="crm-pipeline-result" role="status">{message}</p> : null}
    {(creating || editing) && selectedPipeline && <OpportunityEditor opportunity={editing} pipeline={selectedPipeline} stages={pipelineStages} households={households} {...(creatingHouseholdId ? { initialHouseholdId: creatingHouseholdId } : {})} onCancel={() => { setCreating(false); setCreatingHouseholdId(undefined); setEditing(null); onAddRequestConsumed?.(); }} onSave={async (draft) => { const target = pipelineStages.find((stage) => stage.id === draft['stageId'])!; if (!editing || editing.stageId !== draft['stageId']) { await move({ ...draft, stageId: editing?.stageId ?? '__new__' } as StoredOpportunity, target); } else { await save(saved(editing, draft)); setMessage('Opportunity saved.'); } setCreating(false); setCreatingHouseholdId(undefined); setEditing(null); onAddRequestConsumed?.(); }} />}
  </main>;
}

function StageColumn({ stage, opportunities, householdName, onDrop, onEdit, onPrepareAction, onApproveAction, onDismissAction }: { stage: StoredStage; opportunities: readonly StoredOpportunity[]; householdName: (householdId: string) => string; onDrop: (opportunity: StoredOpportunity) => void; onEdit: (opportunity: StoredOpportunity) => void; onPrepareAction: (opportunity: StoredOpportunity, action: OpportunityContactActionStep) => void; onApproveAction: (opportunity: StoredOpportunity, action: OpportunityContactActionStep) => void; onDismissAction: (opportunity: StoredOpportunity, action: OpportunityContactActionStep) => void }) {
  const [over, setOver] = useState(false);
  return <section data-testid={`crm-pipeline-stage-${stage.id}`} onDragOver={(event) => { event.preventDefault(); setOver(true); }} onDragLeave={() => { setOver(false); }} onDrop={(event) => { event.preventDefault(); const encoded = event.dataTransfer.getData('application/json'); if (encoded) onDrop(JSON.parse(encoded) as StoredOpportunity); setOver(false); }} style={{ ...card, minHeight: 180, borderColor: over ? 'var(--kp-assured)' : 'var(--kp-border)', padding: 'var(--kp-space-sm)' }}><strong>{stage.name}</strong><span style={muted}> · {opportunities.length}</span><div style={{ display: 'grid', gap: 8, marginTop: 10 }}>{opportunities.map((opportunity) => <article key={opportunity.id} data-testid={`crm-opportunity-${opportunity.id}`} draggable onDragStart={(event) => { event.dataTransfer.setData('application/json', JSON.stringify(opportunity)); }} style={{ border: '1px solid var(--kp-border)', borderRadius: 8, padding: 9, background: 'white', cursor: 'grab' }}><div style={{ display: 'flex', gap: 5, alignItems: 'start' }}><GripVertical size={15} aria-hidden="true" style={{ color: 'var(--kp-text-faint)', flex: 'none' }} /><div style={{ flex: 1 }}><strong>{opportunity.name}</strong><div style={muted}>{householdName(opportunity.householdId)} · AUM {money(opportunity.amount)} · Fee {money(opportunity.fee)}</div>{opportunity.expectedCloseDate ? <div style={muted}>Expected close: {opportunity.expectedCloseDate}</div> : null}</div></div><Button size="sm" variant="secondary" data-testid={`crm-opportunity-edit-${opportunity.id}`} style={{ marginTop: 8 }} onClick={() => { onEdit(opportunity); }}>Edit</Button><OpportunityContactActions opportunityId={opportunity.id} actions={opportunity.contactActionSteps ?? []} onPrepare={(action) => { onPrepareAction(opportunity, action); }} onApprove={(action) => { onApproveAction(opportunity, action); }} onDismiss={(action) => { onDismissAction(opportunity, action); }} /></article>)}</div></section>;
}

function OpportunityEditor({ opportunity, pipeline, stages, households, initialHouseholdId, onCancel, onSave }: { opportunity: StoredOpportunity | null; pipeline: StoredPipeline; stages: readonly StoredStage[]; households: readonly LiveCrmRecord[]; initialHouseholdId?: string; onCancel: () => void; onSave: (record: LiveCrmRecord) => Promise<void> }) {
  const existingFee = opportunity?.fee;
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- opportunity is null when creating a new record.
  const [name, setName] = useState(opportunity?.name ?? ''); const [householdId, setHouseholdId] = useState(opportunity?.householdId ?? initialHouseholdId ?? households[0]?.id ?? ''); const [stageId, setStageId] = useState(opportunity?.stageId ?? stages[0]?.id ?? ''); const [amount, setAmount] = useState(opportunity?.amount?.value?.toString() ?? ''); const [fee, setFee] = useState(existingFee?.value.toString() ?? ''); const [closeDate, setCloseDate] = useState(opportunity?.expectedCloseDate ?? ''); const [notes, setNotes] = useState(opportunity?.notes ?? ''); const [contactActionSteps, setContactActionSteps] = useState<OpportunityContactActionStep[]>(opportunity?.contactActionSteps ?? []);
  const submit = (event: React.FormEvent) => { event.preventDefault(); if (!name.trim() || !householdId || !stageId) return; const targetStage = stages.find((stage) => stage.id === stageId); const record = { ...(opportunity ?? base('opportunity', id('opportunity'))), name: name.trim(), householdId, pipelineId: pipeline.id, stageId, ...(amount.trim() ? { amount: { value: Number(amount), currency: 'USD' } } : { amount: undefined }), ...(fee.trim() ? { fee: { value: Number(fee), currency: 'USD' } } : { fee: undefined }), expectedCloseDate: closeDate || undefined, notes, status: targetStage?.statusEffect === 'won' ? 'won' : targetStage?.statusEffect === 'lost' ? 'lost' : opportunity?.status ?? 'open', contextRefs: opportunity?.contextRefs ?? [], tagIds: opportunity?.tagIds ?? [], customFields: opportunity?.customFields ?? {}, contactActionSteps }; void onSave(record); };
  return <section data-testid="crm-opportunity-editor" style={{ ...card, borderColor: 'var(--kp-assured)' }}><h2 style={{ marginTop: 0 }}>{opportunity ? 'Edit opportunity' : 'New opportunity'}</h2><form onSubmit={submit} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}><label style={fieldStyle}>Opportunity name<input data-testid="crm-opportunity-name" value={name} onChange={(event) => { setName(event.target.value); }} autoFocus /></label><label style={fieldStyle}>Household<select data-testid="crm-opportunity-household" value={householdId} onChange={(event) => { setHouseholdId(event.target.value); }}>{households.map((household) => <option key={household.id} value={household.id}>{label(household)}</option>)}</select></label><label style={fieldStyle}>Stage<select data-testid="crm-opportunity-stage" value={stageId} onChange={(event) => { setStageId(event.target.value); }}>{stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}</select></label><label style={fieldStyle}>Estimated AUM<input data-testid="crm-opportunity-amount" inputMode="decimal" value={amount} onChange={(event) => { setAmount(event.target.value); }} placeholder="0" /></label><label style={fieldStyle}>Annual fee<input data-testid="crm-opportunity-fee" inputMode="decimal" value={fee} onChange={(event) => { setFee(event.target.value); }} placeholder="0" /></label><label style={fieldStyle}>Expected close date<input data-testid="crm-opportunity-close-date" type="date" value={closeDate} onChange={(event) => { setCloseDate(event.target.value); }} /></label><label style={{ ...fieldStyle, gridColumn: '1 / -1' }}>Notes<textarea data-testid="crm-opportunity-notes" value={notes} onChange={(event) => { setNotes(event.target.value); }} /></label><OpportunityContactActionsEditor actions={contactActionSteps} onChange={setContactActionSteps} /><div style={{ display: 'flex', gap: 8, gridColumn: '1 / -1' }}><Button data-testid="crm-opportunity-save" type="submit">Save opportunity</Button><Button variant="secondary" data-testid="crm-opportunity-cancel" onClick={onCancel}>Cancel</Button></div></form></section>;
}

function PipelineSettings({ data, onNavigate }: { data: PipelineData; onNavigate: (route: PipelineRoute) => void }) {
  const [newPipeline, setNewPipeline] = useState(''); const [newStages, setNewStages] = useState<Record<string, string>>({}); const [message, setMessage] = useState<string | null>(null);
  const pipelines = active(data.records.filter((record): record is StoredPipeline => record.kind === 'pipelineDef')); const stages = active(data.records.filter((record): record is StoredStage => record.kind === 'stageDef')); const templates = active(data.records.filter((record) => record.kind === 'workflowTemplate'));
  const save = async (record: LiveCrmRecord) => { await data.save(record); };
  const createPipeline = async () => { if (!newPipeline.trim()) return; const pipelineId = id('pipeline'); await save({ ...base('pipelineDef', pipelineId), name: newPipeline.trim(), description: '', stageIds: [], stageOrder: [], archived: false }); setNewPipeline(''); setMessage('Pipeline created. Add its first stage below.'); };
  const reorderPipeline = async (pipeline: StoredPipeline, direction: -1 | 1) => { const index = pipelines.findIndex((item) => item.id === pipeline.id); const other = pipelines[index + direction]; if (!other) return; await save(saved(pipeline, { ...pipeline, order: other['order'] ?? index + direction })); await save(saved(other, { ...other, order: pipeline['order'] ?? index })); };
  const createStage = async (pipeline: StoredPipeline) => { const name = newStages[pipeline.id]?.trim(); if (!name) return; const stageId = id('stage'); await save({ ...base('stageDef', stageId), pipelineId: pipeline.id, name, statusEffect: 'open', triggerRules: [], archived: false }); await save(saved(pipeline, { ...pipeline, stageIds: [...pipeline.stageIds, stageId], stageOrder: [...pipeline.stageOrder, stageId] })); setNewStages((current) => ({ ...current, [pipeline.id]: '' })); };
  const reorderStage = async (pipeline: StoredPipeline, stageId: string, direction: -1 | 1) => { const index = pipeline.stageOrder.indexOf(stageId); const swap = index + direction; if (swap < 0 || swap >= pipeline.stageOrder.length) return; const stageOrder = [...pipeline.stageOrder]; [stageOrder[index], stageOrder[swap]] = [stageOrder[swap]!, stageOrder[index]!]; await save(saved(pipeline, { ...pipeline, stageOrder })); };
  const updateStage = async (stage: StoredStage, change: Partial<StageDef>) => { await save(saved(stage, { ...stage, ...change })); };
  return <main data-testid="crm-pipeline-settings-surface" style={{ flex: 1, overflow: 'auto', padding: 'var(--kp-space-lg)', display: 'grid', alignContent: 'start', gap: 'var(--kp-space-md)' }}><SurfaceHeader Icon={Settings2} title="Pipeline settings" description="Choose the steps your firm uses, and what each step should suggest." actions={<Button variant="secondary" data-testid="crm-pipeline-back" onClick={() => { onNavigate('pipeline'); }}>Back to pipeline</Button>} />
    <section style={card}><strong>Add a pipeline</strong><div style={{ display: 'flex', gap: 8, marginTop: 8 }}><input data-testid="crm-pipeline-name" value={newPipeline} onChange={(event) => { setNewPipeline(event.target.value); }} placeholder="For example, new client onboarding" /><Button data-testid="crm-pipeline-save" onClick={() => { void createPipeline(); }}>Add pipeline</Button></div></section>
    {!pipelines.length ? <section data-testid="crm-pipeline-settings-empty" style={card}><strong>No pipelines yet</strong><p style={muted}>Start with the simple path a potential client takes at your firm.</p></section> : pipelines.map((pipeline, pipelineIndex) => { const orderedStages = pipeline.stageOrder.map((stageId) => stages.find((stage) => stage.id === stageId)).filter((stage): stage is StoredStage => Boolean(stage)); return <section key={pipeline.id} data-testid={`crm-pipeline-settings-${pipeline.id}`} style={card}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}><div><strong>{pipeline.name}</strong><p style={muted}>Stages appear in this order on the pipeline board.</p></div><span style={{ display: 'flex', gap: 5 }}><Button size="sm" variant="secondary" data-testid={`crm-pipeline-up-${pipeline.id}`} disabled={pipelineIndex === 0} onClick={() => { void reorderPipeline(pipeline, -1); }}><ArrowLeft size={14} /> Earlier</Button><Button size="sm" variant="secondary" data-testid={`crm-pipeline-down-${pipeline.id}`} disabled={pipelineIndex === pipelines.length - 1} onClick={() => { void reorderPipeline(pipeline, 1); }}>Later <ArrowRight size={14} /></Button></span></div><label style={fieldStyle}>Name<input data-testid={`crm-pipeline-edit-${pipeline.id}`} defaultValue={pipeline.name} onBlur={(event) => { const name = event.target.value.trim(); if (name && name !== pipeline.name) void save(saved(pipeline, { ...pipeline, name })); }} /></label><div style={{ display: 'grid', gap: 8, marginTop: 10 }}>{orderedStages.map((stage, index) => <StageSettings key={stage.id} stage={stage} templates={templates} onUpdate={updateStage} onMove={(direction) => { void reorderStage(pipeline, stage.id, direction); }} canMoveEarlier={index > 0} canMoveLater={index < orderedStages.length - 1} />)}</div><div style={{ display: 'flex', gap: 8, marginTop: 10 }}><input data-testid={`crm-stage-name-${pipeline.id}`} value={newStages[pipeline.id] ?? ''} onChange={(event) => { setNewStages((current) => ({ ...current, [pipeline.id]: event.target.value })); }} placeholder="New stage name" /><Button data-testid={`crm-stage-save-${pipeline.id}`} onClick={() => { void createStage(pipeline); }}>Add stage</Button></div></section>; })}
    {message ? <p data-testid="crm-pipeline-settings-result" role="status">{message}</p> : null}
  </main>;
}

function StageSettings({ stage, templates, onUpdate, onMove, canMoveEarlier, canMoveLater }: { stage: StoredStage; templates: readonly LiveCrmRecord[]; onUpdate: (stage: StoredStage, change: Partial<StageDef>) => Promise<void>; onMove: (direction: -1 | 1) => void; canMoveEarlier: boolean; canMoveLater: boolean }) {
  const savedRule = stage.triggerRules.find((item) => item.event === 'entered') ?? { id: id('trigger'), event: 'entered' as const, proposalRequired: true, enabled: false };
  const [rule, setRule] = useState<StageTriggerRule>(savedRule);
  const saveRule = () => {
    const without = stage.triggerRules.filter((item) => item.event !== 'entered');
    void onUpdate(stage, { triggerRules: [...without, rule] });
  };
  return <section data-testid={`crm-stage-settings-${stage.id}`} style={{ borderTop: '1px solid var(--kp-border)', paddingTop: 10 }}><div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}><label style={{ ...fieldStyle, flex: 1 }}>Stage name<input data-testid={`crm-stage-edit-${stage.id}`} defaultValue={stage.name} onBlur={(event) => { const name = event.target.value.trim(); if (name && name !== stage.name) void onUpdate(stage, { name }); }} /></label><Button size="sm" variant="secondary" data-testid={`crm-stage-up-${stage.id}`} disabled={!canMoveEarlier} onClick={() => { onMove(-1); }}>Earlier</Button><Button size="sm" variant="secondary" data-testid={`crm-stage-down-${stage.id}`} disabled={!canMoveLater} onClick={() => { onMove(1); }}>Later</Button></div><div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 8, marginTop: 8 }}><label style={fieldStyle}>When this stage is entered<select data-testid={`crm-stage-workflow-${stage.id}`} value={rule.workflowTemplateId ?? ''} onChange={(event) => { setRule((current) => ({ ...current, workflowTemplateId: event.target.value, enabled: event.target.value ? current.enabled : false })); }}><option value="">Do not suggest a workflow</option>{templates.map((template) => <option key={template.id} value={template.id}>{typeof template['name'] === 'string' ? template['name'] : 'Untitled workflow'}</option>)}</select></label><label style={fieldStyle}>Client outcome<select data-testid={`crm-stage-status-${stage.id}`} value={stage.statusEffect} onChange={(event) => { void onUpdate(stage, { statusEffect: event.target.value as StageDef['statusEffect'] }); }}><option value="open">Still open</option><option value="won">Won</option><option value="lost">Lost</option><option value="none">No change</option></select></label><label style={{ ...fieldStyle, justifyContent: 'end' }}><span>Workflow suggestion</span><input data-testid={`crm-stage-trigger-${stage.id}`} type="checkbox" checked={rule.enabled} disabled={!rule.workflowTemplateId} onChange={(event) => { setRule((current) => ({ ...current, enabled: event.target.checked, proposalRequired: true })); }} /> <span style={muted}>Always needs approval</span></label></div><Button size="sm" data-testid={`crm-stage-trigger-save-${stage.id}`} disabled={!rule.workflowTemplateId} style={{ marginTop: 8 }} onClick={saveRule}>Save workflow suggestion</Button><p style={muted}>{rule.enabled && rule.workflowTemplateId ? 'When an opportunity enters this stage, Lantern prepares the workflow for approval. It never starts it automatically.' : 'No workflow will be suggested from this stage.'}</p></section>;
}

export function CrmPipelineSurface({ route, onNavigate, data, addRequest, onAddRequestConsumed }: { route: PipelineRoute; onNavigate: (route: PipelineRoute) => void; data?: PipelineData; addRequest?: CrmHouseholdAddRequest; onAddRequestConsumed?: () => void }) {
  const live = useLiveCrmRecords();
  const effective = data ?? live;
  return route === 'pipeline-settings' ? <PipelineSettings data={effective} onNavigate={onNavigate} /> : <PipelineHome data={effective} onNavigate={onNavigate} {...(addRequest ? { addRequest } : {})} {...(onAddRequestConsumed ? { onAddRequestConsumed } : {})} />;
}
