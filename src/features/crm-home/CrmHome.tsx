import { useEffect, useState } from 'react';
import {
  Activity,
  BarChart3,
  Bell,
  ClipboardList,
  Download,
  FileArchive,
  Flag,
  GitPullRequest,
  Landmark,
  LayoutDashboard,
  ListChecks,
  Plus,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Tags,
  Users,
  Workflow,
} from 'lucide-react';
import { SurfaceHeader } from '@/ui/SurfaceHeader';
import { Button } from '@/ui/kp';
import type {
  CrmFreshnessState,
  CrmHomeAdapter,
  CrmTask,
  AttachmentAccountingRecord,
  ExportJobStatus,
  MigrationWorkflowChecklist,
  OfferDecision,
  PropagationOffer,
  PropagationApplyOffer,
} from './types';

export type CrmHomeRoute =
  | 'today'
  | 'tasks'
  | 'workflows'
  | 'propagation'
  | 'pipeline'
  | 'pipeline-settings'
  | 'reports'
  | 'firm-setup'
  | 'fields-tags'
  | 'intake-links'
  | 'migration'
  | 'fidelity'
  | 'workflow-recreation'
  | 'attachment-accounting'
  | 'archive-export'
  | 'rollback-export';

export interface CrmHomeProps {
  adapter?: CrmHomeAdapter;
  initialRoute?: CrmHomeRoute;
  /** Sample records are visual-test-only and always visibly labelled. */
  preview?: boolean;
}

const PREVIEW_TASKS: readonly CrmTask[] = [
  { id: 'task-henderson', title: 'Send review packet', householdLabel: 'Henderson household', assigneeUserId: 'priya', assigneeLabel: 'Priya', status: 'open', dueLabel: 'Thu', priority: 'high' },
  { id: 'task-miller', title: 'Confirm transfer', householdLabel: 'Miller household', assigneeUserId: 'andy', assigneeLabel: 'Andy', status: 'blocked', dueLabel: 'Today', priority: 'high' },
  { id: 'task-ortiz', title: 'Schedule annual review', householdLabel: 'Ortiz household', assigneeUserId: 'maya', assigneeLabel: 'Maya', status: 'in_progress', dueLabel: 'Sep 18', priority: 'normal', recurrenceLabel: 'Recurring' },
];

const PREVIEW_OFFERS: readonly PropagationOffer[] = [
  {
    id: 'offer-henderson', instanceId: 'winst-henderson', householdLabel: 'Henderson household', revisionLabel: 'Welcome sequence refresh', state: 'ready',
    steps: [{
      id: 'step-confirm-transfer', label: 'Confirm recurring transfer', changeKind: 'modify', protectedProgress: { status: 'todo', hasNotes: false, hasCompletion: false, hasOutcome: false, hasAssignmentHistory: false },
      decisions: [
        { id: 'decision-due', revisionId: 'rev-welcome-refresh', stepId: 'step-confirm-transfer', field: 'due_offset', label: 'Due offset', before: '+0 days', after: '+4 days', decision: 'accepted', reofferState: 'original' },
        { id: 'decision-role', revisionId: 'rev-welcome-refresh', stepId: 'step-confirm-transfer', field: 'default_assignee_role', label: 'Default assignee role', before: 'CSA', after: 'Operations', decision: 'accepted', reofferState: 'original' },
      ],
    }, {
      id: 'step-paper-kit', label: 'Paper welcome kit', changeKind: 'remove', protectedProgress: { status: 'todo', hasNotes: false, hasCompletion: false, hasOutcome: false, hasAssignmentHistory: false },
      decisions: [{ id: 'decision-remove', revisionId: 'rev-welcome-refresh', stepId: 'step-paper-kit', field: 'title', label: 'Remove untouched step', after: 'Untouched step will be removed', decision: 'accepted', reofferState: 'original' }],
    }],
  },
  {
    id: 'offer-miller', instanceId: 'winst-miller', householdLabel: 'Miller household', revisionLabel: 'Welcome sequence refresh', state: 'needs-decision',
    steps: [{
      id: 'step-send-packet', label: 'Send welcome packet', changeKind: 'modify', protectedProgress: { status: 'in_progress', hasNotes: true, hasCompletion: false, hasOutcome: false, hasAssignmentHistory: true },
      decisions: [{ id: 'decision-conflict', revisionId: 'rev-welcome-refresh-a', stepId: 'step-send-packet', field: 'due_offset', label: 'Due offset', before: '+2 days', after: '+4 days', decision: 'review_required', reofferState: 'original' }],
      newAssignmentOffer: { id: 'assignment-miller', stepId: 'step-send-packet', assigneeLabel: 'Operations for future routing', decision: 'review_required' },
    }],
  },
];

const PREVIEW_MIGRATION = {
  workflowChecklists: [{ id: 'workflow-henderson', clientLabel: 'Henderson household', sourceTemplateLabel: 'Annual review', activityEvidence: ['Activity: review due', 'Legacy Project: Annual review'], availableSteps: ['Prepare review', 'Confirm meeting', 'Complete review'], decision: 'pending' as const }],
  attachmentAccounting: [{ id: 'attachment-henderson', clientLabel: 'Henderson household', status: 'pending' as const }],
  exports: [{ kind: 'archive' as const, status: 'ready' as const, manifestId: 'manifest_preview_001' }, { kind: 'rollback' as const, status: 'ready' as const }],
};

const PREVIEW_ADAPTER: CrmHomeAdapter = {
  freshness: { kind: 'offline' },
  tasks: PREVIEW_TASKS,
  offers: PREVIEW_OFFERS,
  migration: PREVIEW_MIGRATION,
  actions: {
    updateTask: () => undefined,
    applyPropagation: () => undefined,
    undoPropagation: () => ({ restored: 0, protectedCells: [] }),
    markNotificationsRead: () => undefined,
    recordWorkflowChecklist: () => undefined,
    recordAttachmentAccounting: () => undefined,
    createExport: () => undefined,
    retryExport: () => undefined,
  },
};

const ENGINE_PENDING_FRESHNESS: CrmFreshnessState = { kind: 'offline' };

const homeSections: readonly { route: CrmHomeRoute; label: string; Icon: typeof LayoutDashboard }[] = [
  { route: 'today', label: 'Today', Icon: LayoutDashboard },
  { route: 'tasks', label: 'Tasks', Icon: ListChecks },
  { route: 'workflows', label: 'Workflows', Icon: Workflow },
  { route: 'pipeline', label: 'Pipeline', Icon: Landmark },
  { route: 'reports', label: 'Reports', Icon: BarChart3 },
  { route: 'firm-setup', label: 'Firm', Icon: Users },
];

const panelStyle = { border: '1px solid var(--kp-border)', borderRadius: 'var(--radius-lg)', background: 'var(--kp-surface)', padding: 'var(--kp-space-md)' } as const;
const mutedStyle = { color: 'var(--kp-text-faint)', fontSize: 'var(--kp-font-sm)' } as const;

function FreshnessBanner({ freshness }: { freshness: CrmFreshnessState }) {
  const marker = freshness.kind === 'live' ? '● Live' : freshness.kind === 'syncing' ? '◌ Syncing' : freshness.kind === 'offline' ? '☁ Working offline' : freshness.kind === 'last-synced' ? '● Last synced' : '● Needs attention';
  const color = freshness.kind === 'live' ? '#16794a' : freshness.kind === 'syncing' ? '#2463b5' : freshness.kind === 'offline' ? '#64748b' : freshness.kind === 'last-synced' ? '#a75f00' : '#b42318';
  const detail = freshness.kind === 'syncing'
    ? `Showing at least the changes received through ${freshness.lastSyncedAt ?? 'the last update'}; newer changes may still arrive.`
    : freshness.kind === 'offline'
      ? 'Local edits work. Delivery waits until you reconnect.'
      : freshness.kind === 'last-synced'
        ? `Last synced ${freshness.lastSyncedAt ?? 'previously'} · Full check: ${freshness.lastFullCheckAt ?? 'not available'}`
        : freshness.kind === 'error'
          ? freshness.error ?? 'A specific connection check needs attention. Your readable local data remains available.'
          : freshness.kind === 'live' ? 'Every contributing subscription has caught up.' : '';
  return <div data-testid="crm-freshness-banner" role="status" style={{ ...panelStyle, padding: 'var(--kp-space-sm)', borderColor: color, display: 'flex', gap: 'var(--kp-space-sm)', alignItems: 'center', flexWrap: 'wrap' }}>
    <strong style={{ color }}>{marker}</strong><span style={mutedStyle}>{detail}</span>
  </div>;
}

function AskBar({ scope = 'the firm' }: { scope?: string }) {
  return <label style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 260, border: '1px solid var(--kp-border)', borderRadius: 8, padding: '7px 10px', background: 'white' }}>
    <span aria-hidden="true">✦</span><input data-testid="crm-ask-input" aria-label={`Ask ${scope}`} placeholder={`Ask ${scope}…`} style={{ border: 0, outline: 0, width: '100%', font: 'inherit', background: 'transparent' }} />
  </label>;
}

function HomeRail({ route, onNavigate }: { route: CrmHomeRoute; onNavigate: (route: CrmHomeRoute) => void }) {
  const activeParent = route.startsWith('firm') || route === 'fields-tags' || route === 'intake-links' || route.includes('migration') || route.includes('fidelity') || route.includes('export') || route === 'workflow-recreation' || route === 'attachment-accounting' ? 'firm-setup' : route === 'propagation' ? 'workflows' : route === 'pipeline-settings' ? 'pipeline' : route;
  return <aside aria-label="Home sections" style={{ width: 184, padding: 'var(--kp-space-md)', borderRight: '1px solid var(--kp-border)', background: '#f8fafc', flex: 'none' }}>
    <div style={{ fontWeight: 700, color: 'var(--kp-navy)', marginBottom: 10 }}>Home</div>
    {homeSections.map(({ route: item, label, Icon }) => <button key={item} data-testid={`crm-home-nav-${item}`} onClick={() => onNavigate(item)} aria-current={activeParent === item ? 'page' : undefined} style={{ display: 'flex', width: '100%', alignItems: 'center', gap: 8, border: 0, borderRadius: 7, padding: '8px 9px', marginBottom: 3, cursor: 'pointer', textAlign: 'left', background: activeParent === item ? '#e7f0fc' : 'transparent', color: activeParent === item ? '#124f91' : 'var(--kp-text)' }}><Icon size={16} />{label}</button>)}
  </aside>;
}

function Today({ tasks, freshness, onNavigate, onUpdateTask }: { tasks: readonly CrmTask[]; freshness: CrmFreshnessState; onNavigate: (r: CrmHomeRoute) => void; onUpdateTask: (task: CrmTask) => void }) {
  const [reviewing, setReviewing] = useState(false);
  const open = tasks.filter((task) => task.status !== 'done' && task.status !== 'cancelled');
  return <Screen title="Today" description="Good morning, Maya" Icon={LayoutDashboard} action={<Button data-testid="crm-today-review" iconLeft={ClipboardList} onClick={() => setReviewing(true)}>Review today’s plan</Button>}>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}><AskBar /><FreshnessBanner freshness={freshness} /></div>
    <section style={panelStyle}><strong>Today, realistically</strong><p style={mutedStyle}>6 of 21 open items fit today. Four can wait without affecting a meeting or due date.</p><Button variant="secondary" data-testid="crm-today-review-inline" onClick={() => setReviewing(true)}>Review</Button></section>
    {reviewing && <section data-testid="crm-today-review-panel" style={{ ...panelStyle, borderColor: '#2463b5' }}><strong>Review today’s plan</strong><p style={mutedStyle}>Keep it today, move it, or delegate it. Nothing moves until you save.</p>{open.map((task) => <div key={task.id} style={{ display: 'flex', gap: 8, justifyContent: 'space-between', padding: '8px 0', borderTop: '1px solid var(--kp-border)' }}><span>{task.title}</span><Button size="sm" variant="secondary" data-testid={`crm-today-keep-${task.id}`} onClick={() => onUpdateTask(task)}>Keep today</Button></div>)}</section>}
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}><section style={panelStyle}><strong>Waiting for you</strong><p style={mutedStyle}>2 local changes need approval<br />1 template update needs review</p><Button variant="secondary" size="sm" data-testid="crm-today-open-propagation" onClick={() => onNavigate('propagation')}>Review updates</Button></section><section style={panelStyle}><strong>Recent firm activity</strong><p style={mutedStyle}>Priya completed Send review packet · 9:14<br />New fact added to Henderson household · 8:40</p></section></div>
  </Screen>;
}

function Tasks({ tasks, freshness, onUpdateTask }: { tasks: readonly CrmTask[]; freshness: CrmFreshnessState; onUpdateTask: (task: CrmTask) => void }) {
  const [view, setView] = useState<'list' | 'board'>('list');
  const [filter, setFilter] = useState('');
  const [editing, setEditing] = useState<CrmTask | null>(null);
  const filtered = tasks.filter((task) => task.title.toLowerCase().includes(filter.toLowerCase()));
  const advance = (task: CrmTask) => onUpdateTask({ ...task, status: task.status === 'done' ? 'open' : 'done' });
  return <Screen title="Tasks" description="Commitments that fit real time" Icon={ListChecks} action={<Button data-testid="crm-task-new" iconLeft={Plus} onClick={() => setEditing({ id: `task-${Date.now()}`, title: '', assigneeUserId: 'maya', assigneeLabel: 'Maya', status: 'open', priority: 'normal' })}>New task</Button>}>
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}><AskBar /><button data-testid="crm-task-list-view" onClick={() => setView('list')} aria-pressed={view === 'list'}>List</button><button data-testid="crm-task-board-view" onClick={() => setView('board')} aria-pressed={view === 'board'}>Board</button><input data-testid="crm-task-search" aria-label="Search tasks" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Search tasks" /></div>
    <section style={panelStyle}><strong>6 of 21 fit today.</strong><span style={mutedStyle}> You can review the suggested plan.</span></section><FreshnessBanner freshness={freshness} />
    {view === 'list' ? <div data-testid="crm-task-list" style={panelStyle}>{filtered.length === 0 ? <p>No tasks match these filters.</p> : filtered.map((task) => <TaskRow key={task.id} task={task} onComplete={() => advance(task)} onOpen={() => setEditing(task)} />)}</div> : <TaskBoard tasks={filtered} onOpen={setEditing} onMove={(task, status) => onUpdateTask({ ...task, status })} />}
    {editing && <TaskDetail task={editing} onClose={() => setEditing(null)} onSave={(task) => { onUpdateTask(task); setEditing(null); }} />}
  </Screen>;
}

function TaskRow({ task, onComplete, onOpen }: { task: CrmTask; onComplete: () => void; onOpen: () => void }) {
  return <div style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--kp-border)' }}><button data-testid={`crm-task-complete-${task.id}`} aria-label={`Complete ${task.title}`} onClick={onComplete}>{task.status === 'done' ? '✓' : '□'}</button><button data-testid={`crm-task-open-${task.id}`} onClick={onOpen} style={{ background: 'transparent', border: 0, textAlign: 'left', flex: 1, cursor: 'pointer' }}><strong>{task.title}</strong><span style={mutedStyle}> · {task.householdLabel ?? 'Firm'} · {task.priority} · {task.dueLabel ?? 'No due date'} · {task.assigneeLabel}</span></button></div>;
}

function TaskBoard({ tasks, onOpen, onMove }: { tasks: readonly CrmTask[]; onOpen: (task: CrmTask) => void; onMove: (task: CrmTask, status: CrmTask['status']) => void }) {
  const columns: readonly [CrmTask['status'], string][] = [['open', 'To do'], ['in_progress', 'In progress'], ['blocked', 'Blocked'], ['done', 'Done']];
  return <div data-testid="crm-task-board" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(180px, 1fr))', gap: 10, overflowX: 'auto' }}>{columns.map(([status, label]) => <section key={status} style={panelStyle}><strong>{label}</strong>{tasks.filter((task) => task.status === status).map((task) => <button key={task.id} data-testid={`crm-task-board-${task.id}`} onClick={() => onOpen(task)} onDoubleClick={() => onMove(task, status === 'done' ? 'open' : 'done')} style={{ display: 'block', width: '100%', marginTop: 8, padding: 8, textAlign: 'left', border: '1px solid var(--kp-border)', borderRadius: 6, background: 'white' }}>{task.title}</button>)}</section>)}</div>;
}

function TaskDetail({ task, onClose, onSave }: { task: CrmTask; onClose: () => void; onSave: (task: CrmTask) => void }) {
  const [draft, setDraft] = useState(task);
  return <aside data-testid="crm-task-detail" aria-label="Task detail" style={{ ...panelStyle, position: 'fixed', right: 20, top: 80, maxWidth: 420, boxShadow: '0 10px 30px #0003', zIndex: 5 }}><h2 style={{ marginTop: 0 }}>Task detail</h2><label>Title<input data-testid="crm-task-title-input" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label><label>Assignee<select data-testid="crm-task-assignee" value={draft.assigneeUserId} onChange={(event) => setDraft({ ...draft, assigneeUserId: event.target.value, assigneeLabel: event.target.value === 'maya' ? 'Maya' : event.target.value })}><option value="maya">Maya</option><option value="priya">Priya</option><option value="andy">Andy</option></select></label><p style={mutedStyle}>One assignee. Notes live in the task body. Tasks have no comments.</p><div style={{ display: 'flex', gap: 8 }}><Button data-testid="crm-task-save" onClick={() => onSave(draft)}>Save local change</Button><Button variant="secondary" onClick={onClose}>Close</Button></div></aside>;
}

function Workflows({ freshness, onNavigate }: { freshness: CrmFreshnessState; onNavigate: (route: CrmHomeRoute) => void }) {
  const [draftChanged, setDraftChanged] = useState(true);
  const [published, setPublished] = useState(false);
  return <Screen title="Workflows" description="Versioned ways of working" Icon={Workflow} action={<Button data-testid="crm-workflow-new-template" iconLeft={Plus} onClick={() => setDraftChanged(true)}>New template</Button>}>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}><AskBar /><FreshnessBanner freshness={freshness} /></div><section style={panelStyle}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><div><strong>Onboarding</strong><p style={mutedStyle}>Published: {published ? 'Welcome sequence refresh' : 'Current workflow'} · 12 open workflows</p></div><Button variant="secondary" data-testid="crm-workflow-edit-draft" onClick={() => setDraftChanged(true)}>Edit draft</Button></div><ol><li>Confirm household details · Operations · +0 days · Required</li><li>Open accounts · Advisor · +2 days · Required</li><li>Send welcome packet · CSA · +3 days · Required</li></ol><p style={mutedStyle}>Schedule editor and outcomes & branching editor are part of the draft. Open workflows do not change when this publishes.</p>{draftChanged && <div style={{ ...panelStyle, background: '#f8fbff' }}><strong>Draft update: Added 1 · Changed 2 · Removed 0</strong><Button data-testid="crm-workflow-publish" style={{ marginLeft: 8 }} disabled={freshness.kind === 'offline'} onClick={() => { setPublished(true); setDraftChanged(false); onNavigate('propagation'); }}>Publish update</Button></div>}</section><section style={panelStyle}><strong>Open instances</strong><p>Henderson household · Onboarding · 5 of 7 complete <Button size="sm" variant="secondary" data-testid="crm-workflow-review" onClick={() => onNavigate('propagation')}>Review update</Button></p><p style={mutedStyle}>Pending labels use the named revision set, never a version number. Completed work stays untouched.</p></section></Screen>;
}

function PropagationReview({ offers, freshness, onApply, onUndo, undoReport }: { offers: readonly PropagationOffer[]; freshness: CrmFreshnessState; onApply: (offers: readonly PropagationApplyOffer[]) => void; onUndo: () => void; undoReport: string | null }) {
  const [draft, setDraft] = useState<readonly PropagationOffer[]>(offers);
  const [outcome, setOutcome] = useState<string | null>(null);
  const decisions = (current: readonly PropagationOffer[]) => current.flatMap((offer) => offer.steps.flatMap((step) => step.decisions));
  const unresolved = decisions(draft).filter((decision) => decision.decision === 'review_required');
  const eligible = draft.filter((offer) => offer.state === 'ready' && !offer.steps.some((step) => step.decisions.some((decision) => decision.decision === 'review_required')));
  const setDecision = (offerId: string, decisionId: string, decision: OfferDecision['decision']) => setDraft((current) => current.map((offer) => offer.id !== offerId ? offer : { ...offer, steps: offer.steps.map((step) => ({ ...step, decisions: step.decisions.map((item) => item.id === decisionId ? { ...item, decision } : item) })) }));
  const approveAll = () => setDraft((current) => current.map((offer) => offer.steps.some((step) => step.decisions.some((decision) => decision.decision === 'review_required')) ? offer : { ...offer, steps: offer.steps.map((step) => ({ ...step, decisions: step.decisions.map((decision) => ({ ...decision, decision: 'accepted' as const })) })) }));
  const apply = () => {
    if (unresolved.length) { setOutcome('Review every concurrent update before applying. Nothing was changed.'); return; }
    const payload = draft.map((offer) => ({ offerId: offer.id, instanceId: offer.instanceId, acceptedDecisions: offer.steps.flatMap((step) => step.decisions.filter((decision) => decision.decision === 'accepted').map(({ id, revisionId, stepId, field, reofferState }) => ({ id, revisionId, stepId, field, reofferState }))) }));
    onApply(payload);
    setOutcome(`${payload.flatMap((offer) => offer.acceptedDecisions).length} accepted derived fields sent for apply. Progress, notes, assignments, completions, and outcomes were excluded.`);
  };
  const reportUndo = () => onUndo();
  return <Screen title="Propagation review" description="One offer per open workflow instance" Icon={GitPullRequest} action={<Button data-testid="crm-propagation-approve-all" disabled={freshness.kind === 'offline' || freshness.kind === 'syncing' || freshness.kind === 'last-synced'} onClick={approveAll}>Approve all eligible</Button>}>
    <FreshnessBanner freshness={freshness} />
    {(freshness.kind === 'offline' || freshness.kind === 'last-synced') && <div role="alert" style={{ ...panelStyle, borderColor: '#a75f00' }}>{freshness.kind === 'offline' ? 'Reconnect to review firm workflow changes safely. This view is read-only offline.' : 'Bulk approval waits until the eligible instance set is complete.'}</div>}
    {unresolved.length > 0 && <div data-testid="crm-propagation-review-required" role="alert" style={{ ...panelStyle, borderColor: '#b42318' }}>Concurrent updates still need an explicit accept or reject decision. Apply is blocked.</div>}
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><span style={mutedStyle}>All {draft.length}</span><span style={mutedStyle}>Ready: {eligible.length}</span><span style={mutedStyle}>Need a decision: {unresolved.length}</span></div>
    {draft.map((offer) => <PropagationOfferCard key={offer.id} offer={offer} onDecision={setDecision} />)}
    <footer style={{ ...panelStyle, position: 'sticky', bottom: 0, display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}><span>{decisions(draft).filter((decision) => decision.decision === 'accepted').length} accepted derived fields across {draft.length} instances</span><div style={{ display: 'flex', gap: 8 }}><Button variant="secondary" data-testid="crm-propagation-undo" onClick={reportUndo}>Undo last apply</Button><Button data-testid="crm-propagation-apply" disabled={freshness.kind !== 'live' || unresolved.length > 0} onClick={apply}>Apply</Button></div></footer>{outcome && <p data-testid="crm-propagation-result" role="status">{outcome}</p>}{undoReport && <p data-testid="crm-propagation-undo-report" role="status">{undoReport}</p>}
  </Screen>;
}

function PropagationOfferCard({ offer, onDecision }: { offer: PropagationOffer; onDecision: (offerId: string, decisionId: string, decision: OfferDecision['decision']) => void }) {
  return <section data-testid={`crm-propagation-offer-${offer.id}`} style={panelStyle}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><strong>{offer.householdLabel} · one offer</strong><span style={mutedStyle}>{offer.revisionLabel}</span></div>{offer.steps.map((step) => <section key={step.id} data-testid={`crm-propagation-step-${step.id}`} style={{ borderTop: '1px solid var(--kp-border)', marginTop: 10, paddingTop: 10 }}><strong>{step.label}</strong><span style={mutedStyle}> · stable step ID: {step.id} · {step.changeKind}</span>{step.decisions.map((decision) => <PropagationFieldRow key={decision.id} decision={decision} onDecision={(choice) => onDecision(offer.id, decision.id, choice)} />)}{step.newAssignmentOffer && <p style={mutedStyle}>Separate new-assignment offer: {step.newAssignmentOffer.assigneeLabel}. It is not part of propagation.</p>}<p style={mutedStyle}>Protected progress: {step.protectedProgress.status}; notes {step.protectedProgress.hasNotes ? 'kept' : 'none'}; completion {step.protectedProgress.hasCompletion ? 'kept' : 'none'}; outcome {step.protectedProgress.hasOutcome ? 'kept' : 'none'}; assignment history {step.protectedProgress.hasAssignmentHistory ? 'kept' : 'none'}.</p></section>)}<p style={mutedStyle}>Protected progress, notes, completions, outcomes, and assignment history cannot enter the apply payload.</p></section>;
}

function PropagationFieldRow({ decision, onDecision }: { decision: OfferDecision; onDecision: (decision: OfferDecision['decision']) => void }) {
  return <div style={{ display: 'flex', gap: 8, padding: '8px 0', alignItems: 'start' }}><span><strong>{decision.label}</strong><br /><span style={mutedStyle}>{decision.before ? `${decision.before} → ` : ''}{decision.after} · {decision.reofferState === 'reoffered' ? 'Re-offered after a descendant update' : 'Original offer'}</span></span><div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}><Button size="sm" variant={decision.decision === 'accepted' ? 'primary' : 'secondary'} data-testid={`crm-propagation-accept-${decision.id}`} onClick={() => onDecision('accepted')}>Accept</Button><Button size="sm" variant={decision.decision === 'rejected' ? 'primary' : 'secondary'} data-testid={`crm-propagation-reject-${decision.id}`} onClick={() => onDecision('rejected')}>Reject</Button>{decision.decision === 'review_required' && <span data-testid={`crm-propagation-unresolved-${decision.id}`} style={mutedStyle}>Review required</span>}</div></div>;
}

function Pipeline({ freshness, onNavigate }: { freshness: CrmFreshnessState; onNavigate: (route: CrmHomeRoute) => void }) {
  return <Screen title="Pipeline" description="Potential work, not another project container" Icon={Landmark} action={<Button data-testid="crm-pipeline-new" iconLeft={Plus}>New opportunity</Button>}><div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}><AskBar /><Button variant="secondary" data-testid="crm-pipeline-settings" onClick={() => onNavigate('pipeline-settings')} iconLeft={Settings2}>Settings</Button></div><FreshnessBanner freshness={freshness} /><div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(180px, 1fr))', gap: 10, overflowX: 'auto' }}>{['Discovery', 'Recommendation', 'Decision', 'Won'].map((stage) => <section key={stage} style={panelStyle}><strong>{stage}</strong><p>{stage === 'Discovery' ? 'Patel · $400k · Sep 14' : stage === 'Decision' ? 'Chen · $180k · today' : stage === 'Won' ? 'Lewis · $600k' : 'Avery · $250k · Sep 20'}</p></section>)}</div><section style={panelStyle}><strong>Legacy Projects</strong><p style={mutedStyle}>Read-only historical records. They never write back or auto-convert.</p><Button variant="secondary" data-testid="crm-legacy-start-workflow">Start a workflow from this</Button></section></Screen>;
}

function PipelineSettings() { return <Screen title="Pipeline settings" description="Firm configuration" Icon={Settings2}><section style={panelStyle}><strong>Retirement conversions</strong><p style={mutedStyle}>Stages are ordered, archived, and managed here. Stage entry can propose a workflow; it never launches one automatically.</p>{['Discovery', 'Recommendation', 'Decision'].map((stage) => <div key={stage} style={{ borderTop: '1px solid var(--kp-border)', padding: 8 }}><strong>{stage}</strong><span style={mutedStyle}> · Entry trigger · Proposal required · Enabled</span></div>)}</section></Screen>; }

function Reports({ freshness }: { freshness: CrmFreshnessState }) { const [running, setRunning] = useState(false); const [report, setReport] = useState('No contact in 6 months'); return <Screen title="Reports" description="Answers from current records" Icon={BarChart3} action={<Button data-testid="crm-report-run" iconLeft={RefreshCw} onClick={() => setRunning(true)}>Run report</Button>}><div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><AskBar />{['No contact in 6 months', 'Attention vs fee', 'Birthdays', 'Age 65', 'RMD due', 'Review due'].map((name) => <button key={name} data-testid={`crm-report-${name.replaceAll(' ', '-').toLowerCase()}`} aria-pressed={report === name} onClick={() => setReport(name)}>{name}</button>)}</div><FreshnessBanner freshness={freshness} /><section style={panelStyle}><strong>{running ? 'Computed just now' : 'Choose a report'} from 1,284 sources</strong><p style={mutedStyle}>N means decrypted records and source-backed facts considered after filters. {report === 'Attention vs fee' ? 'Fee data is missing; this report does not estimate it.' : ''}</p>{running && <><p>Henderson household · Last meaningful contact Jan 8 · Platinum</p><p>Ortiz household · Last meaningful contact Dec 17 · Gold</p><Button variant="secondary">Save this view</Button> <Button variant="secondary">Export as Word</Button></>}</section></Screen>; }

function FirmSetup({ onNavigate, freshness }: { onNavigate: (route: CrmHomeRoute) => void; freshness: CrmFreshnessState }) { return <Screen title="Firm" description="The few rules that shape real work" Icon={Users} action={<Button data-testid="crm-firm-open-admin" iconLeft={ShieldCheck}>Open firm administration</Button>}><FreshnessBanner freshness={freshness} /><div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10 }}>{[{ route: 'firm-setup' as const, label: 'Firm setup', detail: 'Members, roles, service tiers, retention, teams' }, { route: 'fields-tags' as const, label: 'Fields and tags', detail: 'Shared structure for records' }, { route: 'intake-links' as const, label: 'Intake links', detail: 'Create, preview, review' }, { route: 'migration' as const, label: 'Migration', detail: 'Mirror, parallel run, cutover' }].map((item) => <button key={item.route} data-testid={`crm-firm-route-${item.route}`} onClick={() => onNavigate(item.route)} style={{ ...panelStyle, textAlign: 'left', cursor: 'pointer' }}><strong>{item.label}</strong><p style={mutedStyle}>{item.detail}</p></button>)}</div><section style={panelStyle}><strong>Members · Roles · Service tiers · Retention · Teams</strong><p>Maya Patel · Owner · Active · display from firm administration</p><p style={mutedStyle}>This is a display-only shell over firm administration. Ethical walls, invitations, access, and deactivation are managed there.</p></section></Screen>; }

function FieldsTags() { return <Screen title="Fields and tags" description="Shared structure without setup before value" Icon={Tags} action={<Button data-testid="crm-field-new" iconLeft={Plus}>New field</Button>}><section style={panelStyle}><strong>Custom fields</strong><p>Service region · Choice · Household · Optional <Button size="sm" variant="secondary">Edit</Button></p><p>Referral source · Choice · Household · Optional <Button size="sm" variant="secondary">Edit</Button></p></section><section style={panelStyle}><strong>Tags</strong><p><span>Tax planning</span> · <span>New client</span> · <span>Money movement</span></p><Button variant="secondary">Manage tags</Button><p style={mutedStyle}>Changing a field type after values exist is blocked. Make a replacement instead.</p></section><section style={panelStyle}><strong>Firm documents</strong><p style={mutedStyle}>Title, type, tags, last update. Content stays in the existing document editor.</p><Button variant="secondary">Open in document editor</Button></section></Screen>; }

function IntakeLinks() { return <Screen title="Intake links" description="Scoped forms that create reviewable submissions" Icon={ClipboardList} action={<Button data-testid="crm-intake-new" iconLeft={Plus}>New intake link</Button>}><section style={panelStyle}><strong>New client information</strong><p style={mutedStyle}>Choose fields and confirmation copy, preview on phone or desktop, then copy/share the link. A submission never writes directly into a household.</p><Button variant="secondary">Preview form</Button> <Button variant="secondary">Copy link</Button></section><section style={panelStyle}><strong>Submission review</strong><p>One response needs a deliberate match/create decision.</p><Button>Match this response</Button></section></Screen>; }

function Migration({ route, freshness, migration, onNavigate, actions }: { route: CrmHomeRoute; freshness: CrmFreshnessState; migration: CrmHomeAdapter['migration']; onNavigate: (route: CrmHomeRoute) => void; actions: CrmHomeAdapter['actions'] }) {
  const [parallel, setParallel] = useState(false);
  const exportKind = route === 'archive-export' ? 'archive' : route === 'rollback-export' ? 'rollback' : null;
  if (exportKind) return <ExportReadiness job={migration.exports.find((job) => job.kind === exportKind) ?? { kind: exportKind, status: 'failed', failureReason: 'No export job was supplied by the CRM data engine.' }} onCreate={() => actions.createExport(exportKind)} onRetry={() => actions.retryExport(exportKind)} />;
  if (route === 'workflow-recreation') return <WorkflowFallbackChecklist records={migration.workflowChecklists} onRecord={(record) => actions.recordWorkflowChecklist(record)} />;
  if (route === 'attachment-accounting') return <AttachmentFallbackChecklist records={migration.attachmentAccounting} onRecord={(record) => actions.recordAttachmentAccounting(record)} />;
  if (route === 'fidelity') return <FidelityReport onNavigate={onNavigate} />;
  return <Screen title="Wealthbox migration" description="Mirror → Parallel run → Cutover" Icon={Activity} action={<Button data-testid="crm-migration-fidelity" onClick={() => onNavigate('fidelity')}>Review fidelity report</Button>}><FreshnessBanner freshness={freshness} /><section style={panelStyle}><strong>Mirror ● Last synced &nbsp; Parallel run {parallel ? '● Active' : '○ Next'} &nbsp; Cutover ○ Locked</strong><p>80 households · 262 people · 1,904 notes · 311 tasks</p><div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><Button variant="secondary" data-testid="crm-migration-archive" iconLeft={FileArchive} onClick={() => onNavigate('archive-export')}>Archive export</Button><Button variant="secondary" data-testid="crm-migration-rollback" iconLeft={Download} onClick={() => onNavigate('rollback-export')}>Rollback export</Button><Button data-testid="crm-migration-start-parallel" disabled={parallel} onClick={() => setParallel(true)}>{parallel ? 'Parallel run active' : 'Start parallel run'}</Button></div></section><section style={panelStyle}><strong>Parallel run is deliberately limited</strong><p style={mutedStyle}>It mirrors readable workflow templates and activity traces. It never claims to read open-workflow state from an API. External writes require a reviewed tracked diff and approval.</p></section><section style={panelStyle}><strong>Required through cutover</strong><div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><Button variant="secondary" data-testid="crm-migration-workflow-fallback" onClick={() => onNavigate('workflow-recreation')}>In-flight workflow re-creation</Button><Button variant="secondary" data-testid="crm-migration-attachment-fallback" onClick={() => onNavigate('attachment-accounting')}>Attachment accounting</Button></div></section></Screen>;
}

function FidelityReport({ onNavigate }: { onNavigate: (route: CrmHomeRoute) => void }) { return <Screen title="Fidelity report" description="Jul 11 · 10:42" Icon={Flag} action={<Button variant="secondary">Export report</Button>}><section style={panelStyle}><strong>Attention needed before cutover</strong><p>Households 80 fetched / 80 imported / 0 skipped · Complete</p><p>Notes 1,904 fetched / 1,892 imported / 12 skipped · Review</p><p>Open workflows: 4 checklists · 3 decided · 1 needs operator decision</p><p>Attachments: 78 exported · 2 explicit client gaps</p><Button variant="secondary" onClick={() => onNavigate('workflow-recreation')}>See workflow checklist</Button> <Button variant="secondary" onClick={() => onNavigate('attachment-accounting')}>See attachment accounting</Button></section><p style={mutedStyle}>Cutover stays locked until every active-client skip is explained, the full check and frozen archive match, rollback is ready, every workflow checklist is decided, and each attachment is exported or marked as a gap.</p></Screen>; }

function WorkflowFallbackChecklist({ records, onRecord }: { records: readonly MigrationWorkflowChecklist[]; onRecord: (record: MigrationWorkflowChecklist) => void }) {
  const [drafts, setDrafts] = useState(records);
  const update = (id: string, change: Partial<MigrationWorkflowChecklist>) => setDrafts((current) => current.map((record) => record.id === id ? { ...record, ...change } : record));
  const complete = (record: MigrationWorkflowChecklist) => record.evidenceReviewed && record.selectedCurrentStep && ((record.decision === 'recreate' && record.resultingInstanceLabel) || (record.decision === 'gap' && record.gapReason));
  return <Screen title="In-flight workflow re-creation" description="Required through cutover" Icon={Workflow}><p style={mutedStyle}>Every affected client is listed. The source API does not supply open-workflow state, so an operator selects the current step and records a resulting instance or a trace gap.</p>{drafts.map((record) => <section key={record.id} data-testid={`crm-workflow-checklist-${record.id}`} style={panelStyle}><strong>{record.clientLabel} · {record.sourceTemplateLabel}</strong><p style={mutedStyle}>Evidence: {record.activityEvidence.join(' · ') || 'No readable trace available'}</p><label><input data-testid={`crm-workflow-evidence-${record.id}`} type="checkbox" checked={Boolean(record.evidenceReviewed)} onChange={(event) => update(record.id, { evidenceReviewed: event.target.checked })} /> I reviewed the available workflow evidence</label><label style={{ display: 'block', marginTop: 8 }}>Current step <select data-testid={`crm-workflow-step-${record.id}`} value={record.selectedCurrentStep ?? ''} onChange={(event) => update(record.id, { selectedCurrentStep: event.target.value })}><option value="">Choose the current step</option>{record.availableSteps.map((step) => <option key={step}>{step}</option>)}</select></label><div style={{ display: 'flex', gap: 8, marginTop: 8 }}><Button size="sm" variant={record.decision === 'recreate' ? 'primary' : 'secondary'} onClick={() => update(record.id, { decision: 'recreate' })}>Create resulting instance</Button><Button size="sm" variant={record.decision === 'gap' ? 'primary' : 'secondary'} onClick={() => update(record.id, { decision: 'gap' })}>Record trace gap</Button></div>{record.decision === 'recreate' ? <label style={{ display: 'block', marginTop: 8 }}>Resulting Lantern instance <input data-testid={`crm-workflow-instance-${record.id}`} value={record.resultingInstanceLabel ?? ''} onChange={(event) => update(record.id, { resultingInstanceLabel: event.target.value })} /></label> : record.decision === 'gap' ? <label style={{ display: 'block', marginTop: 8 }}>Gap reason <input data-testid={`crm-workflow-gap-${record.id}`} value={record.gapReason ?? ''} onChange={(event) => update(record.id, { gapReason: event.target.value })} /></label> : null}<Button data-testid={`crm-workflow-record-${record.id}`} style={{ marginTop: 10 }} disabled={!complete(record)} onClick={() => onRecord(record)}>Record this client’s checklist</Button></section>)}</Screen>;
}

function AttachmentFallbackChecklist({ records, onRecord }: { records: readonly AttachmentAccountingRecord[]; onRecord: (record: AttachmentAccountingRecord) => void }) {
  const [drafts, setDrafts] = useState(records);
  const update = (id: string, change: Partial<AttachmentAccountingRecord>) => setDrafts((current) => current.map((record) => record.id === id ? { ...record, ...change } : record));
  const complete = (record: AttachmentAccountingRecord) => (record.status === 'exported' && record.exportSource && record.exportedBy) || (record.status === 'gap' && record.gapReason && record.gapOwner);
  return <Screen title="Attachment accounting" description="Required through cutover" Icon={FileArchive}><p style={mutedStyle}>Every affected client needs exactly one complete record. An absence is never silently treated as no attachment.</p>{drafts.map((record) => <section key={record.id} data-testid={`crm-attachment-record-${record.id}`} style={panelStyle}><strong>{record.clientLabel}</strong><label style={{ display: 'block', marginTop: 8 }}>Status <select data-testid={`crm-attachment-status-${record.id}`} value={record.status} onChange={(event) => update(record.id, { status: event.target.value as AttachmentAccountingRecord['status'] })}><option value="pending">Choose a status</option><option value="exported">Exported</option><option value="gap">Attachment gap</option></select></label>{record.status === 'exported' ? <><label style={{ display: 'block', marginTop: 8 }}>Export source <input data-testid={`crm-attachment-source-${record.id}`} value={record.exportSource ?? ''} onChange={(event) => update(record.id, { exportSource: event.target.value })} /></label><label style={{ display: 'block', marginTop: 8 }}>Operator <input data-testid={`crm-attachment-operator-${record.id}`} value={record.exportedBy ?? ''} onChange={(event) => update(record.id, { exportedBy: event.target.value })} /></label></> : record.status === 'gap' ? <><label style={{ display: 'block', marginTop: 8 }}>Gap reason <input data-testid={`crm-attachment-reason-${record.id}`} value={record.gapReason ?? ''} onChange={(event) => update(record.id, { gapReason: event.target.value })} /></label><label style={{ display: 'block', marginTop: 8 }}>Gap owner <input data-testid={`crm-attachment-owner-${record.id}`} value={record.gapOwner ?? ''} onChange={(event) => update(record.id, { gapOwner: event.target.value })} /></label></> : null}<Button data-testid={`crm-attachment-record-save-${record.id}`} style={{ marginTop: 10 }} disabled={!complete(record)} onClick={() => onRecord(record)}>Record this client’s attachment status</Button></section>)}</Screen>;
}

function ExportReadiness({ job, onCreate, onRetry }: { job: ExportJobStatus; onCreate: () => void; onRetry: () => void }) { const kind = job.kind; return <Screen title={`${kind === 'archive' ? 'Archive' : 'Rollback'} export`} description="Prepare an export without changing a connector account" Icon={kind === 'archive' ? FileArchive : Download}><section style={panelStyle}><strong>{job.status === 'ready' ? 'Ready to prepare' : job.status === 'preparing' ? 'Preparing export' : job.status === 'exported' ? 'Exported' : 'Failed — retry available'}</strong><ul>{kind === 'archive' ? <><li>Manifest present</li><li>Raw-capture checksums verified</li><li>Fidelity counts matched</li><li>Storage destination selected</li></> : <><li>Full check complete</li><li>Current report saved</li><li>Eligible Lantern changes counted</li><li>Destination format checked</li><li>Known unsupported items listed</li></>}</ul>{job.status === 'exported' ? <p data-testid="crm-exported-status">Exported {job.exportedAt ?? 'at the recorded export time'} · {kind === 'archive' ? `Manifest ID: ${job.manifestId ?? 'missing from engine data'}` : `Reconciliation report: ${job.reconciliationReportId ?? 'missing from engine data'}`}</p> : job.status === 'failed' ? <><p role="alert">{job.failureReason ?? 'The export failed. Nothing changed in the connector account.'}</p><Button data-testid="crm-export-retry" onClick={onRetry}>Retry {kind} export</Button></> : job.status === 'preparing' ? <p data-testid="crm-export-preparing" role="status">Preparing the export. This page will update when the CRM data engine records its result.</p> : <Button data-testid="crm-export-create" onClick={onCreate}>Create {kind} export</Button>}</section></Screen>; }

function Screen({ title, description, Icon, action, children }: { title: string; description: string; Icon: typeof LayoutDashboard; action?: React.ReactNode; children: React.ReactNode }) { return <div data-testid={`crm-screen-${title.toLowerCase().replaceAll(' ', '-')}`} style={{ padding: 'var(--kp-space-xl)', overflow: 'auto', width: '100%', display: 'flex', flexDirection: 'column', gap: 'var(--kp-space-md)' }}><SurfaceHeader Icon={Icon} title={title} description={description} actions={action} />{children}</div>; }

function EnginePendingHome() {
  return <div data-testid="crm-home-engine-pending" style={{ display: 'flex', height: '100%', minHeight: 0, padding: 'var(--kp-space-xl)', background: '#fff' }}><main style={{ ...panelStyle, maxWidth: 680, alignSelf: 'flex-start' }}><h1 style={{ marginTop: 0 }}>CRM data engine not yet connected</h1><FreshnessBanner freshness={ENGINE_PENDING_FRESHNESS} /><p>This Home space is waiting for the real CRM data engine. It is intentionally non-interactive, so sample people, tasks, and sync claims are never shown as real firm data.</p><p style={mutedStyle}>ENGINE-PENDING: wire the typed CrmHomeAdapter from the CRM engine before enabling this space.</p></main></div>;
}

function ConnectedCrmHome({ adapter, initialRoute = 'today', preview = false }: Required<Pick<CrmHomeProps, 'adapter'>> & Omit<CrmHomeProps, 'adapter'>) {
  // ENGINE-PENDING: B1/B5/B8 provide these values through their typed adapters.
  // This UI only dispatches actions and never chooses a persistence mechanism.
  const activeAdapter = adapter;
  const [route, setRoute] = useState<CrmHomeRoute>(initialRoute);
  const [tasks, setTasks] = useState<readonly CrmTask[]>(activeAdapter.tasks);
  const [notificationsRead, setNotificationsRead] = useState(false);
  const [undoReport, setUndoReport] = useState<string | null>(null);
  const freshness = activeAdapter.freshness;
  const offers = activeAdapter.offers;
  const updateTask = (task: CrmTask) => { setTasks((current) => current.some((item) => item.id === task.id) ? current.map((item) => item.id === task.id ? task : item) : [...current, task]); activeAdapter.actions.updateTask(task); };
  const jump = (next: CrmHomeRoute) => setRoute(next);
  const reportUndo = () => { const result = activeAdapter.actions.undoPropagation(); setUndoReport(result.protectedCells.length ? `${result.restored} untouched derived cells restored. Protected cells kept: ${result.protectedCells.join(', ')}.` : `${result.restored} untouched derived cells restored. No protected cells needed to stay.`); };
  useEffect(() => { const onKeyDown = (event: KeyboardEvent) => { if ((event.target as HTMLElement | null)?.tagName === 'INPUT') return; if (event.key === 'g') { (window as Window & { __crmGo?: boolean }).__crmGo = true; return; } if ((window as Window & { __crmGo?: boolean }).__crmGo) { const key = event.key.toLowerCase(); const destination = key === 'h' ? 'today' : key === 't' ? 'tasks' : key === 'w' ? 'workflows' : key === 'p' ? 'pipeline' : key === 'r' ? 'reports' : key === 'f' ? 'firm-setup' : key === 'm' ? 'migration' : null; if (destination) { event.preventDefault(); jump(destination); } (window as Window & { __crmGo?: boolean }).__crmGo = false; } if (event.key === '/' && route !== 'tasks') { document.querySelector<HTMLInputElement>('[data-testid="crm-ask-input"]')?.focus(); } if (route === 'propagation' && event.key.toLowerCase() === 'u') { event.preventDefault(); reportUndo(); } }; window.addEventListener('keydown', onKeyDown); return () => window.removeEventListener('keydown', onKeyDown); }, [activeAdapter, route]);
  const notificationPanel = <aside aria-label="Notifications" style={{ position: 'absolute', right: 20, top: 56, width: 340, zIndex: 10, ...panelStyle, boxShadow: '0 10px 30px #0002' }}><strong>Notifications (3)</strong><p>New assignment · Confirm transfer · Miller household · recipient: Maya</p><p style={mutedStyle}>Sent 10:34 · delivered 10:35 · acked 10:36 · ciphertext: 4–16 KiB<br />Opaque id: env_7f…91</p><p style={mutedStyle}>The relay sees recipient, timestamps, size band, delivery/ack timing, and opaque ID. It does not store a sender.</p><Button data-testid="crm-notifications-read" variant="secondary" onClick={() => { setNotificationsRead(true); activeAdapter.actions.markNotificationsRead(); }}>{notificationsRead ? 'Marked read on this device' : 'Mark all read on this device'}</Button></aside>;
  const content = route === 'today' ? <Today tasks={tasks} freshness={freshness} onNavigate={jump} onUpdateTask={updateTask} /> : route === 'tasks' ? <Tasks tasks={tasks} freshness={freshness} onUpdateTask={updateTask} /> : route === 'workflows' ? <Workflows freshness={freshness} onNavigate={jump} /> : route === 'propagation' ? <PropagationReview offers={offers} freshness={freshness} onApply={(selected) => activeAdapter.actions.applyPropagation(selected)} onUndo={reportUndo} undoReport={undoReport} /> : route === 'pipeline' ? <Pipeline freshness={freshness} onNavigate={jump} /> : route === 'pipeline-settings' ? <PipelineSettings /> : route === 'reports' ? <Reports freshness={freshness} /> : route === 'fields-tags' ? <FieldsTags /> : route === 'intake-links' ? <IntakeLinks /> : route === 'migration' || route === 'fidelity' || route === 'workflow-recreation' || route === 'attachment-accounting' || route === 'archive-export' || route === 'rollback-export' ? <Migration route={route} freshness={freshness} migration={activeAdapter.migration} onNavigate={jump} actions={activeAdapter.actions} /> : <FirmSetup onNavigate={jump} freshness={freshness} />;
  const [showNotifications, setShowNotifications] = useState(false);
  return <div data-testid="crm-home" style={{ display: 'flex', height: '100%', minHeight: 0, position: 'relative', background: '#fff' }}>{preview && <div data-testid="crm-home-preview-label" role="status" style={{ position: 'absolute', zIndex: 20, right: 16, bottom: 12, ...panelStyle, padding: 8, borderColor: '#a75f00' }}>Preview sample content only. Not connected to CRM data.</div>}<HomeRail route={route} onNavigate={jump} /><div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', position: 'relative' }}>{content}<button data-testid="crm-notifications-button" aria-label="Open notifications" onClick={() => setShowNotifications((open) => !open)} style={{ position: 'absolute', top: 15, right: 18, border: 0, background: 'transparent', cursor: 'pointer', color: 'var(--kp-navy)' }}><Bell size={20} /> <span aria-label="3 notifications">3</span></button>{showNotifications && notificationPanel}</div></div>;
}

export function CrmHome({ adapter, preview = false, initialRoute }: CrmHomeProps) {
  const activeAdapter = adapter ?? (preview ? PREVIEW_ADAPTER : undefined);
  if (!activeAdapter) return <EnginePendingHome />;
  return <ConnectedCrmHome adapter={activeAdapter} preview={preview} {...(initialRoute ? { initialRoute } : {})} />;
}

export default CrmHome;
