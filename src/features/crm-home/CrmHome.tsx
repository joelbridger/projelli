/* eslint-disable lantern-i18n/no-hardcoded-string -- Frozen CRM screen copy needs its translation catalog in a separate product change. */
import { useCallback, useEffect, useState } from 'react';
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
  ShieldCheck,
  Tags,
  Users,
  Workflow,
} from 'lucide-react';
import { SurfaceHeader } from '@/ui/SurfaceHeader';
import { Button } from '@/ui/kp';
import { getCrmEngineFreshness, subscribeCrmEngineFreshness } from '@/platform/crm/store';
import { useLiveCrmRecords } from '@/platform/crm/useLiveCrmRecords';
import { CrmPipelineSurface } from '@/features/crm-pipeline';
import { createMigrationExport, runWealthboxMigration } from '@/platform/crm/migration';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import {
  applyWorkflowOffer,
  completeWorkflowStep,
  createTemplate,
  decideOffer,
  offerForInstance,
  publishTemplateUpdate,
  renameWorkflowStepLocally,
  startWorkflow,
  stepValue,
  undoWorkflowApply,
  workflowRecords,
  type LiveWorkflowInstance,
  type LiveWorkflowOffer,
} from './workflowLive';
import type {
  CrmFreshnessState,
  CrmHomeAdapter,
  CrmTask,
  CrmApproval,
  CrmActivity,
  CrmTaskSavedView,
  AttachmentAccountingRecord,
  ExportJobStatus,
  MigrationFidelityReport,
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
  tasks: [],
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

function emptyEngineAdapter(freshness: CrmFreshnessState): CrmHomeAdapter {
  return { freshness, tasks: [], approvals: [], activity: [], savedTaskViews: [], offers: [], migration: { workflowChecklists: [], attachmentAccounting: [], exports: [] }, actions: {} };
}

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
  const color = freshness.kind === 'live' ? 'var(--kp-local)' : freshness.kind === 'syncing' ? 'var(--kp-assured)' : freshness.kind === 'offline' ? 'var(--color-slate-500)' : freshness.kind === 'last-synced' ? 'var(--kp-direct)' : 'var(--kp-danger)';
  const detail = freshness.kind === 'syncing'
    ? `Showing at least the changes received through ${freshness.lastSyncedAt ?? 'the last update'}; newer changes may still arrive.`
    : freshness.kind === 'offline'
      ? 'Local edits work. Delivery waits until you reconnect.'
      : freshness.kind === 'last-synced'
        ? `Last synced ${freshness.lastSyncedAt ?? 'previously'} · Full check: ${freshness.lastFullCheckAt ?? 'not available'}`
        : freshness.kind === 'error'
          ? freshness.error ?? 'A specific connection check needs attention. Your readable local data remains available.'
          : 'Every contributing subscription has caught up.';
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
  return <aside aria-label="Home sections" style={{ width: 184, padding: 'var(--kp-space-md)', borderRight: '1px solid var(--kp-border)', background: 'var(--color-slate-50)', flex: 'none' }}>
    <div style={{ fontWeight: 700, color: 'var(--kp-navy)', marginBottom: 10 }}>Home</div>
    {homeSections.map(({ route: item, label, Icon }) => <button key={item} data-testid={`crm-home-nav-${item}`} onClick={() => { onNavigate(item); }} aria-current={activeParent === item ? 'page' : undefined} style={{ display: 'flex', width: '100%', alignItems: 'center', gap: 8, border: 0, borderRadius: 7, padding: '8px 9px', marginBottom: 3, cursor: 'pointer', textAlign: 'left', background: activeParent === item ? 'var(--kp-assured-bg)' : 'transparent', color: activeParent === item ? 'var(--kp-assured)' : 'var(--kp-text)' }}><Icon size={16} />{label}</button>)}
  </aside>;
}

function taskDay(task: CrmTask): string | null { return task.dueAt?.slice(0, 10) ?? null; }
function todayKey(): string { return new Date().toISOString().slice(0, 10); }
function isOpenTask(task: CrmTask): boolean { return task.status !== 'done' && task.status !== 'cancelled'; }
function priorityRank(task: CrmTask): number { return task.priority === 'high' ? 0 : task.priority === 'normal' ? 1 : 2; }

function Today({ tasks, approvals, activity, freshness, onNavigate, onUpdateTask, onDecideApproval }: { tasks: readonly CrmTask[]; approvals: readonly CrmApproval[]; activity: readonly CrmActivity[]; freshness: CrmFreshnessState; onNavigate: (r: CrmHomeRoute) => void; onUpdateTask: (task: CrmTask) => void | Promise<void>; onDecideApproval: (approval: CrmApproval, decision: 'approved' | 'rejected') => void | Promise<void> }) {
  const [reviewing, setReviewing] = useState(false);
  const today = todayKey();
  const open = tasks.filter(isOpenTask);
  const dueNow = open.filter((task) => { const due = taskDay(task); return due !== null && due <= today; }).sort((left, right) => (taskDay(left) ?? '').localeCompare(taskDay(right) ?? '') || priorityRank(left) - priorityRank(right));
  const pendingApprovals = approvals.filter((approval) => approval.state === 'pending');
  const recentActivity = [...activity].sort((left, right) => right.at.localeCompare(left.at)).slice(0, 6);
  const hasAnyWork = tasks.length > 0 || approvals.length > 0 || activity.length > 0;
  return <Screen title="Today" description="Your morning plan" Icon={LayoutDashboard} action={<Button data-testid="crm-today-review" iconLeft={ClipboardList} onClick={() => { setReviewing(true); }}>Review today’s plan</Button>}>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}><AskBar /><FreshnessBanner freshness={freshness} /></div>
    {!hasAnyWork ? <section data-testid="crm-today-first-use" style={panelStyle}><strong>No work yet. Add a client to begin.</strong><p style={mutedStyle}>Once client work is saved, this page will calculate today’s priorities from it.</p></section> : <section data-testid="crm-today-triage" style={panelStyle}><strong>Today, realistically</strong><p style={mutedStyle}>{dueNow.length === 0 ? 'Your firm is clear for today.' : `${String(dueNow.length)} due or overdue item${dueNow.length === 1 ? '' : 's'} from ${String(open.length)} open task${open.length === 1 ? '' : 's'}.`}</p>{dueNow.map((task) => <div key={task.id} data-testid={`crm-today-task-${task.id}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '8px 0', borderTop: '1px solid var(--kp-border)' }}><span><strong>{task.title}</strong><span style={mutedStyle}> · {(taskDay(task) ?? today) < today ? 'Overdue' : 'Due today'}{task.householdLabel ? ` · ${task.householdLabel}` : ''}</span></span><Button size="sm" variant="secondary" data-testid={`crm-today-complete-${task.id}`} onClick={() => { void onUpdateTask({ ...task, status: 'done' }); }}>Complete</Button></div>)}<Button variant="secondary" data-testid="crm-today-review-inline" onClick={() => { setReviewing(true); }}>Review</Button></section>}
    {reviewing && <section data-testid="crm-today-review-panel" style={{ ...panelStyle, borderColor: 'var(--kp-assured)' }}><strong>Review today’s plan</strong><p style={mutedStyle}>Only due and overdue work is suggested. Saving changes updates the real task.</p>{dueNow.length === 0 ? <p style={mutedStyle}>Nothing needs attention today.</p> : dueNow.map((task) => <div key={task.id} style={{ display: 'flex', gap: 8, justifyContent: 'space-between', padding: '8px 0', borderTop: '1px solid var(--kp-border)' }}><span>{task.title}</span><Button size="sm" variant="secondary" data-testid={`crm-today-keep-${task.id}`} onClick={() => { void onUpdateTask(task); }}>Keep today</Button></div>)}</section>}
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}><section data-testid="crm-approval-queue" style={panelStyle}><strong>Waiting for you</strong><p style={mutedStyle}>{pendingApprovals.length === 0 ? 'No approvals are waiting.' : `${String(pendingApprovals.length)} approval${pendingApprovals.length === 1 ? '' : 's'} waiting.`}</p>{pendingApprovals.map((approval) => <div key={approval.id} data-testid={`crm-approval-${approval.id}`} style={{ borderTop: '1px solid var(--kp-border)', paddingTop: 8, marginTop: 8 }}><strong>{approval.title}</strong>{approval.householdLabel && <span style={mutedStyle}> · {approval.householdLabel}</span>}<p style={mutedStyle}>{approval.rationale ?? 'Review this proposed change.'}</p><Button size="sm" data-testid={`crm-approval-approve-${approval.id}`} onClick={() => { void onDecideApproval(approval, 'approved'); }}>Approve</Button><Button size="sm" variant="secondary" data-testid={`crm-approval-dismiss-${approval.id}`} style={{ marginLeft: 8 }} onClick={() => { void onDecideApproval(approval, 'rejected'); }}>Dismiss</Button></div>)}{approvals.some((approval) => approval.state !== 'pending') && <p data-testid="crm-approval-history" style={mutedStyle}>Decided proposals stay in history and can be reviewed later.</p>}<Button variant="secondary" size="sm" data-testid="crm-today-open-propagation" onClick={() => { onNavigate('propagation'); }}>Review workflow updates</Button></section><section data-testid="crm-recent-activity" style={panelStyle}><strong>Recent firm activity</strong>{recentActivity.length === 0 ? <p style={mutedStyle}>No recorded activity yet.</p> : recentActivity.map((event) => <p key={event.id} data-testid={`crm-activity-${event.id}`} style={mutedStyle}>{event.summary} · {new Date(event.at).toLocaleString()}</p>)}</section></div>
  </Screen>;
}

function Tasks({ tasks, households, savedViews, freshness, onUpdateTask, onSaveView }: { tasks: readonly CrmTask[]; households: readonly { id: string; name: string }[]; savedViews: readonly CrmTaskSavedView[]; freshness: CrmFreshnessState; onUpdateTask: (task: CrmTask) => void | Promise<void>; onSaveView: (view: CrmTaskSavedView) => void | Promise<void> }) {
  const [view, setView] = useState<'list' | 'board'>('list');
  const [filter, setFilter] = useState('');
  const [editing, setEditing] = useState<CrmTask | null>(null);
  const [savingView, setSavingView] = useState(false);
  const [viewName, setViewName] = useState('');
  const filtered = tasks.filter((task) => task.title.toLowerCase().includes(filter.toLowerCase()));
  const dueToday = tasks.filter((task) => { const due = taskDay(task); return isOpenTask(task) && due !== null && due <= todayKey(); }).length;
  const advance = (task: CrmTask) => { void onUpdateTask({ ...task, status: task.status === 'done' ? 'open' : 'done' }); };
  const newTask = () => { setEditing({ id: `new-task-${crypto.randomUUID()}`, title: '', body: '', assigneeUserId: null, status: 'open', priority: 'normal', contextRefs: [] }); };
  return <Screen title="Tasks" description="Commitments that fit real time" Icon={ListChecks} action={<Button data-testid="crm-task-new" iconLeft={Plus} onClick={newTask} disabled={households.length === 0}>New task</Button>}>
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}><AskBar /><button data-testid="crm-task-list-view" onClick={() => { setView('list'); }} aria-pressed={view === 'list'}>List</button><button data-testid="crm-task-board-view" onClick={() => { setView('board'); }} aria-pressed={view === 'board'}>Board</button><input data-testid="crm-task-search" aria-label="Search tasks" value={filter} onChange={(event) => { setFilter(event.target.value); }} placeholder="Search tasks" /> <Button variant="secondary" size="sm" data-testid="crm-task-save-view-open" onClick={() => { setSavingView(true); }}>Save view</Button></div>
    {savingView && <section style={panelStyle}><label>Saved view name <input data-testid="crm-task-view-name" value={viewName} onChange={(event) => { setViewName(event.target.value); }} /></label><Button data-testid="crm-task-save-view" disabled={!viewName.trim()} style={{ marginLeft: 8 }} onClick={() => { void (async () => { await onSaveView({ id: `saved-view-${crypto.randomUUID()}`, name: viewName.trim(), layout: view === 'board' ? 'kanban' : 'list', ...(filter ? { search: filter } : {}) }); setSavingView(false); setViewName(''); })(); }}>Save</Button></section>}
    {savedViews.length > 0 && <section data-testid="crm-task-saved-views" style={panelStyle}><strong>Saved views</strong>{savedViews.map((saved) => <Button key={saved.id} size="sm" variant="secondary" data-testid={`crm-task-view-${saved.id}`} style={{ marginLeft: 8 }} onClick={() => { setView(saved.layout === 'kanban' ? 'board' : 'list'); setFilter(saved.search ?? ''); }}>{saved.name}</Button>)}</section>}
    {households.length === 0 && <section data-testid="crm-tasks-first-use" style={panelStyle}><strong>No work yet. Add a client to begin.</strong><p style={mutedStyle}>Tasks need a client link, so the first task starts after a client exists.</p></section>}
    <section data-testid="crm-task-triage-count" style={panelStyle}><strong>{dueToday === 0 ? 'No tasks due or overdue today.' : `${String(dueToday)} task${dueToday === 1 ? '' : 's'} due or overdue today.`}</strong></section><FreshnessBanner freshness={freshness} />
    {view === 'list' ? <div data-testid="crm-task-list" style={panelStyle}>{filtered.length === 0 ? <p>{tasks.length === 0 ? 'No tasks yet.' : 'No tasks match these filters.'}</p> : filtered.map((task) => <TaskRow key={task.id} task={task} onComplete={() => { advance(task); }} onOpen={() => { setEditing(task); }} />)}</div> : <TaskBoard tasks={filtered} onOpen={setEditing} onMove={(task, status) => { void onUpdateTask({ ...task, status }); }} />}
    {editing && <TaskDetail task={editing} households={households} onClose={() => { setEditing(null); }} onSave={onUpdateTask} />}
  </Screen>;
}

function TaskRow({ task, onComplete, onOpen }: { task: CrmTask; onComplete: () => void; onOpen: () => void }) {
  return <div style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--kp-border)' }}><button data-testid={`crm-task-complete-${task.id}`} aria-label={`Complete ${task.title}`} onClick={onComplete}>{task.status === 'done' ? '✓' : '□'}</button><button data-testid={`crm-task-open-${task.id}`} onClick={onOpen} style={{ background: 'transparent', border: 0, textAlign: 'left', flex: 1, cursor: 'pointer' }}><strong>{task.title}</strong><span style={mutedStyle}> · {task.householdLabel ?? 'No client'} · {task.priority} · {task.dueLabel ?? 'No due date'} · {task.assigneeLabel ?? task.assigneeUserId ?? 'Unassigned'}{task.recurrence ? ' · Recurring' : ''}</span></button></div>;
}

function TaskBoard({ tasks, onOpen, onMove }: { tasks: readonly CrmTask[]; onOpen: (task: CrmTask) => void; onMove: (task: CrmTask, status: CrmTask['status']) => void }) {
  const columns: readonly [CrmTask['status'], string][] = [['open', 'To do'], ['in_progress', 'In progress'], ['blocked', 'Blocked'], ['done', 'Done']];
  return <div data-testid="crm-task-board" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(180px, 1fr))', gap: 10, overflowX: 'auto' }}>{columns.map(([status, label]) => <section key={status} style={panelStyle}><strong>{label}</strong>{tasks.filter((task) => task.status === status).map((task) => <button key={task.id} data-testid={`crm-task-board-${task.id}`} onClick={() => { onOpen(task); }} onDoubleClick={() => { onMove(task, status === 'done' ? 'open' : 'done'); }} style={{ display: 'block', width: '100%', marginTop: 8, padding: 8, textAlign: 'left', border: '1px solid var(--kp-border)', borderRadius: 6, background: 'white' }}>{task.title}</button>)}</section>)}</div>;
}

function TaskDetail({ task, households, onClose, onSave }: { task: CrmTask; households: readonly { id: string; name: string }[]; onClose: () => void; onSave: (task: CrmTask) => void | Promise<void> }) {
  const [draft, setDraft] = useState(task);
  const [saving, setSaving] = useState(false);
  const householdId = draft.householdId ?? draft.contextRefs?.[0] ?? '';
  const selectHousehold = (id: string) => { const household = households.find((item) => item.id === id); setDraft({ ...draft, householdId: id || undefined, householdLabel: household?.name, contextRefs: id ? [id] : [] }); };
  const setRecurrence = (freq: string) => { setDraft({ ...draft, recurrence: freq ? { freq: freq as NonNullable<CrmTask['recurrence']>['freq'], interval: draft.recurrence?.interval ?? 1, regenerateOnComplete: true } : undefined }); };
  const recurrence = draft.recurrence;
  const save = async () => { setSaving(true); try { await onSave(draft); onClose(); } finally { setSaving(false); } };
  return <aside data-testid="crm-task-detail" aria-label="Task detail" style={{ ...panelStyle, position: 'fixed', right: 20, top: 80, maxWidth: 420, boxShadow: 'var(--kp-shadow-2)', zIndex: 5, display: 'grid', gap: 8 }}><h2 style={{ marginTop: 0 }}>Task detail</h2><label>Title<input data-testid="crm-task-title-input" value={draft.title} onChange={(event) => { setDraft({ ...draft, title: event.target.value }); }} /></label><label>Notes<textarea data-testid="crm-task-body" value={draft.body ?? ''} onChange={(event) => { setDraft({ ...draft, body: event.target.value }); }} /></label><label>Client<select data-testid="crm-task-household" value={householdId} onChange={(event) => { selectHousehold(event.target.value); }}><option value="">Choose a client</option>{households.map((household) => <option key={household.id} value={household.id}>{household.name}</option>)}</select></label><label>Assignee ID<input data-testid="crm-task-assignee" value={draft.assigneeUserId ?? ''} onChange={(event) => { setDraft({ ...draft, assigneeUserId: event.target.value || null, assigneeLabel: event.target.value || undefined }); }} /></label><label>Status<select data-testid="crm-task-status" value={draft.status} onChange={(event) => { setDraft({ ...draft, status: event.target.value as CrmTask['status'] }); }}><option value="open">To do</option><option value="in_progress">In progress</option><option value="blocked">Blocked</option><option value="done">Done</option></select></label><label>Priority<select data-testid="crm-task-priority" value={draft.priority} onChange={(event) => { setDraft({ ...draft, priority: event.target.value as CrmTask['priority'] }); }}><option value="high">High</option><option value="normal">Normal</option><option value="low">Low</option></select></label><label>Due date<input data-testid="crm-task-due" type="date" value={draft.dueAt ?? ''} onChange={(event) => { const due = event.target.value; setDraft({ ...draft, dueAt: due || undefined, dueLabel: due || undefined }); }} /></label><label>Repeat<select data-testid="crm-task-recurrence" value={recurrence?.freq ?? ''} onChange={(event) => { setRecurrence(event.target.value); }}><option value="">Does not repeat</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="yearly">Yearly</option></select></label>{recurrence && <label>Every <input data-testid="crm-task-recurrence-interval" type="number" min="1" value={recurrence.interval} onChange={(event) => { setDraft({ ...draft, recurrence: { ...recurrence, interval: Math.max(1, Number(event.target.value) || 1) } }); }} /></label>}<p style={mutedStyle}>One assignee. Notes live in the task body. Tasks have no comments.</p><div style={{ display: 'flex', gap: 8 }}><Button data-testid="crm-task-save" disabled={saving || !draft.title.trim() || (draft.id.startsWith('new-task-') && !householdId)} onClick={() => { void save(); }}>{saving ? 'Saving…' : 'Save local change'}</Button><Button variant="secondary" onClick={onClose}>Close</Button></div></aside>;
}

function Workflows({ freshness, onNavigate }: { freshness: CrmFreshnessState; onNavigate: (route: CrmHomeRoute) => void }) {
  const [draftChanged, setDraftChanged] = useState(true);
  const [published, setPublished] = useState(false);
  return <Screen title="Workflows" description="Versioned ways of working" Icon={Workflow} action={<Button data-testid="crm-workflow-new-template" iconLeft={Plus} onClick={() => { setDraftChanged(true); }}>New template</Button>}>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}><AskBar /><FreshnessBanner freshness={freshness} /></div><section style={panelStyle}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><div><strong>Onboarding</strong><p style={mutedStyle}>Published: {published ? 'Welcome sequence refresh' : 'Current workflow'} · 12 open workflows</p></div><Button variant="secondary" data-testid="crm-workflow-edit-draft" onClick={() => { setDraftChanged(true); }}>Edit draft</Button></div><ol><li>Confirm household details · Operations · +0 days · Required</li><li>Open accounts · Advisor · +2 days · Required</li><li>Send welcome packet · CSA · +3 days · Required</li></ol><p style={mutedStyle}>Schedule editor and outcomes & branching editor are part of the draft. Open workflows do not change when this publishes.</p>{draftChanged && <div style={{ ...panelStyle, background: 'var(--color-background)' }}><strong>Draft update: Added 1 · Changed 2 · Removed 0</strong><Button data-testid="crm-workflow-publish" style={{ marginLeft: 8 }} disabled={freshness.kind === 'offline'} onClick={() => { setPublished(true); setDraftChanged(false); onNavigate('propagation'); }}>Publish update</Button></div>}</section><section style={panelStyle}><strong>Open instances</strong><p>Henderson household · Onboarding · 5 of 7 complete <Button size="sm" variant="secondary" data-testid="crm-workflow-review" onClick={() => { onNavigate('propagation'); }}>Review update</Button></p><p style={mutedStyle}>Pending labels use the named revision set, never a version number. Completed work stays untouched.</p></section></Screen>;
}

function PropagationReview({ offers, freshness, onApply, onUndo, undoReport }: { offers: readonly PropagationOffer[]; freshness: CrmFreshnessState; onApply: (offers: readonly PropagationApplyOffer[]) => void; onUndo: () => void; undoReport: string | null }) {
  const [draft, setDraft] = useState<readonly PropagationOffer[]>(offers);
  const [outcome, setOutcome] = useState<string | null>(null);
  const decisions = (current: readonly PropagationOffer[]) => current.flatMap((offer) => offer.steps.flatMap((step) => step.decisions));
  const unresolved = decisions(draft).filter((decision) => decision.decision === 'review_required');
  const eligible = draft.filter((offer) => offer.state === 'ready' && !offer.steps.some((step) => step.decisions.some((decision) => decision.decision === 'review_required')));
  const setDecision = (offerId: string, decisionId: string, decision: OfferDecision['decision']) => { setDraft((current) => current.map((offer) => offer.id !== offerId ? offer : { ...offer, steps: offer.steps.map((step) => ({ ...step, decisions: step.decisions.map((item) => item.id === decisionId ? { ...item, decision } : item) })) })); };
  const approveAll = () => { setDraft((current) => current.map((offer) => offer.steps.some((step) => step.decisions.some((decision) => decision.decision === 'review_required')) ? offer : { ...offer, steps: offer.steps.map((step) => ({ ...step, decisions: step.decisions.map((decision) => ({ ...decision, decision: 'accepted' as const })) })) })); };
  const apply = () => {
    if (unresolved.length) { setOutcome('Review every concurrent update before applying. Nothing was changed.'); return; }
    const payload = draft.map((offer) => ({ offerId: offer.id, instanceId: offer.instanceId, acceptedDecisions: offer.steps.flatMap((step) => step.decisions.filter((decision) => decision.decision === 'accepted').map(({ id, revisionId, stepId, field, reofferState }) => ({ id, revisionId, stepId, field, reofferState }))) }));
    onApply(payload);
    setOutcome(`${String(payload.flatMap((offer) => offer.acceptedDecisions).length)} accepted derived fields sent for apply. Progress, notes, assignments, completions, and outcomes were excluded.`);
  };
  const reportUndo = () => { onUndo(); };
  return <Screen title="Propagation review" description="One offer per open workflow instance" Icon={GitPullRequest} action={<Button data-testid="crm-propagation-approve-all" disabled={freshness.kind === 'offline' || freshness.kind === 'syncing' || freshness.kind === 'last-synced'} onClick={approveAll}>Approve all eligible</Button>}>
    <FreshnessBanner freshness={freshness} />
    {(freshness.kind === 'offline' || freshness.kind === 'last-synced') && <div role="alert" style={{ ...panelStyle, borderColor: 'var(--kp-direct)' }}>{freshness.kind === 'offline' ? 'Reconnect to review firm workflow changes safely. This view is read-only offline.' : 'Bulk approval waits until the eligible instance set is complete.'}</div>}
    {unresolved.length > 0 && <div data-testid="crm-propagation-review-required" role="alert" style={{ ...panelStyle, borderColor: 'var(--kp-danger)' }}>Concurrent updates still need an explicit accept or reject decision. Apply is blocked.</div>}
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><span style={mutedStyle}>All {draft.length}</span><span style={mutedStyle}>Ready: {eligible.length}</span><span style={mutedStyle}>Need a decision: {unresolved.length}</span></div>
    {draft.map((offer) => <PropagationOfferCard key={offer.id} offer={offer} onDecision={setDecision} />)}
    <footer style={{ ...panelStyle, position: 'sticky', bottom: 0, display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}><span>{decisions(draft).filter((decision) => decision.decision === 'accepted').length} accepted derived fields across {draft.length} instances</span><div style={{ display: 'flex', gap: 8 }}><Button variant="secondary" data-testid="crm-propagation-undo" onClick={reportUndo}>Undo last apply</Button><Button data-testid="crm-propagation-apply" disabled={freshness.kind !== 'live' || unresolved.length > 0} onClick={apply}>Apply</Button></div></footer>{outcome && <p data-testid="crm-propagation-result" role="status">{outcome}</p>}{undoReport && <p data-testid="crm-propagation-undo-report" role="status">{undoReport}</p>}
  </Screen>;
}

function PropagationOfferCard({ offer, onDecision }: { offer: PropagationOffer; onDecision: (offerId: string, decisionId: string, decision: OfferDecision['decision']) => void }) {
  return <section data-testid={`crm-propagation-offer-${offer.id}`} style={panelStyle}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><strong>{offer.householdLabel} · one offer</strong><span style={mutedStyle}>{offer.revisionLabel}</span></div>{offer.steps.map((step) => <section key={step.id} data-testid={`crm-propagation-step-${step.id}`} style={{ borderTop: '1px solid var(--kp-border)', marginTop: 10, paddingTop: 10 }}><strong>{step.label}</strong><span style={mutedStyle}> · stable step ID: {step.id} · {step.changeKind}</span>{step.decisions.map((decision) => <PropagationFieldRow key={decision.id} decision={decision} onDecision={(choice) => { onDecision(offer.id, decision.id, choice); }} />)}{step.newAssignmentOffer && <p style={mutedStyle}>Separate new-assignment offer: {step.newAssignmentOffer.assigneeLabel}. It is not part of propagation.</p>}<p style={mutedStyle}>Protected progress: {step.protectedProgress.status}; notes {step.protectedProgress.hasNotes ? 'kept' : 'none'}; completion {step.protectedProgress.hasCompletion ? 'kept' : 'none'}; outcome {step.protectedProgress.hasOutcome ? 'kept' : 'none'}; assignment history {step.protectedProgress.hasAssignmentHistory ? 'kept' : 'none'}.</p></section>)}<p style={mutedStyle}>Protected progress, notes, completions, outcomes, and assignment history cannot enter the apply payload.</p></section>;
}

function PropagationFieldRow({ decision, onDecision }: { decision: OfferDecision; onDecision: (decision: OfferDecision['decision']) => void }) {
  return <div style={{ display: 'flex', gap: 8, padding: '8px 0', alignItems: 'start' }}><span><strong>{decision.label}</strong><br /><span style={mutedStyle}>{decision.before ? `${decision.before} → ` : ''}{decision.after} · {decision.reofferState === 'reoffered' ? 'Re-offered after a descendant update' : 'Original offer'}</span></span><div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}><Button size="sm" variant={decision.decision === 'accepted' ? 'primary' : 'secondary'} data-testid={`crm-propagation-accept-${decision.id}`} onClick={() => { onDecision('accepted'); }}>Accept</Button><Button size="sm" variant={decision.decision === 'rejected' ? 'primary' : 'secondary'} data-testid={`crm-propagation-reject-${decision.id}`} onClick={() => { onDecision('rejected'); }}>Reject</Button>{decision.decision === 'review_required' && <span data-testid={`crm-propagation-unresolved-${decision.id}`} style={mutedStyle}>Review required</span>}</div></div>;
}

type LiveWorkflowData = ReturnType<typeof workflowRecords>;
type HouseholdChoice = { id: string; label: string };
function displayValue(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  return value === undefined || value === null ? '' : JSON.stringify(value);
}

function liveStepTitle(instance: LiveWorkflowInstance, stepId: string) {
  return displayValue(stepValue(instance, stepId, 'title')) || instance.snapshot.steps[stepId]?.titleSnapshot || 'Untitled step';
}

function LiveWorkflows({ data, households, onSave, onNavigate }: { data: LiveWorkflowData; households: readonly HouseholdChoice[]; onSave: (record: LiveCrmRecord) => Promise<unknown>; onNavigate: (route: CrmHomeRoute) => void }) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('Client onboarding');
  const [titles, setTitles] = useState(['Confirm household details', 'Open accounts', 'Send welcome packet']);
  const [newHousehold, setNewHousehold] = useState('Northcrest household');
  const [selectedHouseholdId, setSelectedHouseholdId] = useState('');
  const [editing, setEditing] = useState(false);
  const [changedTitle, setChangedTitle] = useState('');
  const [addedTitle, setAddedTitle] = useState('Send welcome summary');
  const [error, setError] = useState<string | null>(null);
  const template = data.templates[0];
  const instances = template ? data.instances.filter((instance) => instance.templateId === template.id) : [];
  const save = async (record: LiveCrmRecord) => { try { setError(null); await onSave(record); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); } };
  const start = async () => {
    if (!template) return;
    let household = households.find((item) => item.id === selectedHouseholdId);
    if (!household) {
      const id = `household-${String(Date.now())}`;
      household = { id, label: newHousehold.trim() || 'New household' };
      await save({ id, kind: 'household', matterId: id, name: household.label });
    }
    await save(startWorkflow(template, household));
  };
  const publish = async () => {
    if (!template) return;
    try {
      setError(null);
      const update = publishTemplateUpdate(template, changedTitle, addedTitle);
      await onSave(update.template);
      for (const instance of instances) await onSave(offerForInstance(update.template, instance, update.revisionId, update.label));
      setEditing(false);
      onNavigate('propagation');
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  return <Screen title="Workflows" description="Steps your firm follows for each household" Icon={Workflow} action={<Button data-testid="crm-live-workflow-new-template" iconLeft={Plus} onClick={() => { setCreating(true); }}>New template</Button>}>
    {error && <div role="alert" style={{ ...panelStyle, borderColor: 'var(--kp-danger)' }}>{error}</div>}
    {!template && !creating && <section style={panelStyle}><strong>No workflow templates yet</strong><p style={mutedStyle}>Create a set of steps, then use it for a household.</p><Button data-testid="crm-live-workflow-create-first" onClick={() => { setCreating(true); }}>Create a workflow</Button></section>}
    {creating && <section data-testid="crm-live-workflow-template-form" style={panelStyle}><strong>Create a workflow template</strong><p style={mutedStyle}>Start with the three steps your firm follows. You can adjust them before publishing later.</p><label>Template name<input data-testid="crm-live-workflow-name" value={name} onChange={(event) => { setName(event.target.value); }} /></label>{titles.map((title, index) => <label key={index} style={{ display: 'block', marginTop: 8 }}>Step {String(index + 1)}<input data-testid={`crm-live-workflow-step-title-${String(index + 1)}`} value={title} onChange={(event) => { setTitles((current) => current.map((item, position) => position === index ? event.target.value : item)); }} /></label>)}<div style={{ display: 'flex', gap: 8, marginTop: 12 }}><Button data-testid="crm-live-workflow-create-template" onClick={() => { void save(createTemplate(name, titles)); setCreating(false); }}>Save template</Button><Button variant="secondary" onClick={() => { setCreating(false); }}>Cancel</Button></div></section>}
    {template && <><section data-testid="crm-live-workflow-template" style={panelStyle}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}><div><strong>{template.name}</strong><p style={mutedStyle}>{instances.length} open household workflow{instances.length === 1 ? '' : 's'}</p></div><span style={{ display: 'flex', gap: 8 }}><Button variant="secondary" data-testid="crm-live-workflow-open-propagation" onClick={() => { onNavigate('propagation'); }}>Review updates</Button><Button variant="secondary" data-testid="crm-live-workflow-edit-template" onClick={() => { setChangedTitle((template.steps[1] ?? template.steps[0])?.title ?? ''); setEditing(true); }}>Edit steps</Button></span></div><ol>{template.steps.map((step) => <li key={step.id}>{step.title} · {step.role} · {step.dueOffset === 0 ? 'start day' : `day ${String(step.dueOffset + 1)}`} · {step.required ? 'required' : 'optional'}</li>)}</ol>{editing && <div data-testid="crm-live-workflow-update-form" style={{ ...panelStyle, background: 'var(--color-background)' }}><strong>Update this template</strong><p style={mutedStyle}>This will ask before changing any household’s open work.</p><label>Rename “{(template.steps[1] ?? template.steps[0])?.title}”<input data-testid="crm-live-workflow-change-title" value={changedTitle} onChange={(event) => { setChangedTitle(event.target.value); }} /></label><label style={{ display: 'block', marginTop: 8 }}>Add a step<input data-testid="crm-live-workflow-add-title" value={addedTitle} onChange={(event) => { setAddedTitle(event.target.value); }} /></label><Button data-testid="crm-live-workflow-publish" style={{ marginTop: 10 }} onClick={() => { void publish(); }}>Publish update</Button></div>}</section>
      <section style={panelStyle}><strong>Start for a household</strong><p style={mutedStyle}>This creates an open workflow for one real household. Nothing is shared until you choose to do so.</p>{households.length ? <label>Household<select data-testid="crm-live-workflow-household" value={selectedHouseholdId} onChange={(event) => { setSelectedHouseholdId(event.target.value); }}><option value="">Choose a household</option>{households.map((household) => <option key={household.id} value={household.id}>{household.label}</option>)}</select></label> : <label>Household name<input data-testid="crm-live-workflow-new-household" value={newHousehold} onChange={(event) => { setNewHousehold(event.target.value); }} /></label>}<Button data-testid="crm-live-workflow-start" style={{ marginLeft: 8 }} onClick={() => { void start(); }}>Start workflow</Button></section>
      <section data-testid="crm-live-workflow-instances" style={panelStyle}><strong>Open household workflows</strong>{instances.length === 0 ? <p style={mutedStyle}>Start this workflow for a household to see its steps here.</p> : instances.map((instance) => <LiveInstanceCard key={instance.id} instance={instance} onSave={save} />)}</section></>}
  </Screen>;
}

function LiveInstanceCard({ instance, onSave }: { instance: LiveWorkflowInstance; onSave: (record: LiveCrmRecord) => Promise<unknown> }) {
  const [editingStep, setEditingStep] = useState<string | null>(null);
  const [localTitle, setLocalTitle] = useState('');
  const steps = Object.values(instance.snapshot.steps).filter((step) => !step.hiddenByTemplateRemoval);
  return <section data-testid={`crm-live-workflow-instance-${instance.id}`} style={{ borderTop: '1px solid var(--kp-border)', marginTop: 10, paddingTop: 10 }}><strong>{instance.householdLabel}</strong><span style={mutedStyle}> · {String(steps.filter((step) => step.status === 'done').length)} of {String(steps.length)} complete</span>{steps.map((step) => <div key={step.stepId} data-testid={`crm-live-workflow-instance-step-${step.stepId}`} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '7px 0' }}><span>{step.status === 'done' ? '✓' : '□'}</span><strong>{liveStepTitle(instance, step.stepId)}</strong>{step.status === 'done' ? <span style={mutedStyle}>Completed work stays as it is.</span> : <Button size="sm" variant="secondary" data-testid={`crm-live-workflow-complete-${instance.id}-${step.stepId}`} onClick={() => { void onSave(completeWorkflowStep(instance, step.stepId)); }}>Complete step</Button>}<Button size="sm" variant="secondary" data-testid={`crm-live-workflow-edit-local-${instance.id}-${step.stepId}`} onClick={() => { setEditingStep(step.stepId); setLocalTitle(liveStepTitle(instance, step.stepId)); }}>Edit for this household</Button>{editingStep === step.stepId && <span><input data-testid={`crm-live-workflow-local-title-${instance.id}-${step.stepId}`} value={localTitle} onChange={(event) => { setLocalTitle(event.target.value); }} /><Button size="sm" data-testid={`crm-live-workflow-local-save-${instance.id}-${step.stepId}`} onClick={() => { void onSave(renameWorkflowStepLocally(instance, step.stepId, localTitle)); setEditingStep(null); }}>Save</Button></span>}</div>)}</section>;
}

function plainField(decision: LiveWorkflowOffer['engineOffer']['decisions'][number], instance: LiveWorkflowInstance) {
  const before = stepValue(instance, decision.stepId, decision.field);
  const value = displayValue(decision.value);
  if (decision.changeKind === 'add') return decision.field === 'title' ? `Add “${value}”` : `${decision.field === 'defaultAssigneeRole' ? 'Send it to' : decision.field === 'dueOffset' ? 'Schedule it for' : 'Set'} ${value}`;
  if (decision.changeKind === 'remove') return 'Remove this untouched future step';
  if (decision.field === 'title') return `Rename “${displayValue(before)}” to “${value}”`;
  if (decision.field === 'dueOffset') return `Move timing from ${displayValue(before) || 'the current day'} to ${value}`;
  if (decision.field === 'defaultAssigneeRole') return `Send new work from ${displayValue(before) || 'the current role'} to ${value}`;
  return `Change ${decision.field} from ${displayValue(before) || 'the current setting'} to ${value}`;
}

function LivePropagationReview({ data, onSave }: { data: LiveWorkflowData; onSave: (record: LiveCrmRecord) => Promise<unknown> }) {
  const [message, setMessage] = useState<string | null>(null);
  const offers = data.offers.filter((offer) => offer.engineOffer.state === 'pending');
  const instanceFor = (offer: LiveWorkflowOffer) => data.instances.find((instance) => instance.id === offer.engineOffer.instanceId);
  const templateFor = (offer: LiveWorkflowOffer) => data.templates.find((template) => template.id === offer.templateId);
  const change = async (offer: LiveWorkflowOffer, decisionId: string, decision: 'accepted' | 'rejected') => { await onSave(decideOffer(offer, decisionId, decision)); };
  const apply = async (offer: LiveWorkflowOffer) => {
    const template = templateFor(offer); const instance = instanceFor(offer);
    if (!template || !instance) return;
    try { const result = applyWorkflowOffer(template, instance, offer); await onSave(result.instance); await onSave(result.offer); setMessage(`${offer.householdLabel} is updated. Completed work and notes stayed as they were.`); } catch (reason) { setMessage(reason instanceof Error ? reason.message : String(reason)); }
  };
  const undo = async (instance: LiveWorkflowInstance) => { const result = undoWorkflowApply(instance); await onSave(result.instance); setMessage(result.protectedCells.length ? `Restored ${String(result.undoneCells.length)} untouched change${result.undoneCells.length === 1 ? '' : 's'}. Kept ${String(result.protectedCells.length)} later household change${result.protectedCells.length === 1 ? '' : 's'}: ${result.protectedCells.join(', ')}.` : `Restored ${String(result.undoneCells.length)} untouched change${result.undoneCells.length === 1 ? '' : 's'}. No later household changes needed to stay.`); };
  return <Screen title="Propagation review" description="Review template updates before they touch household work" Icon={GitPullRequest} action={undefined}>
    {offers.length === 0 ? <section style={panelStyle}><strong>No template updates waiting for review</strong><p style={mutedStyle}>When you publish a workflow update, each household’s open work will appear here for a simple yes or no decision.</p></section> : <><section style={panelStyle}><strong>Template updates ready to review</strong><p style={mutedStyle}>Choose what should change for each household. Work already done stays exactly as it is.</p></section>{offers.map((offer) => { const instance = instanceFor(offer); const grouped = new Map<string, LiveWorkflowOffer['engineOffer']['decisions']>(); for (const decision of offer.engineOffer.decisions) grouped.set(decision.stepId, [...(grouped.get(decision.stepId) ?? []), decision]); const ready = !offer.engineOffer.requiresConcurrentHeadReview && !offer.engineOffer.decisions.some((decision) => decision.decision === 'review_required'); return <section key={offer.id} data-testid={`crm-live-propagation-offer-${offer.id}`} style={panelStyle}><strong>{offer.householdLabel}: {String(grouped.size)} update{grouped.size === 1 ? '' : 's'} to review</strong><p style={mutedStyle}>{offer.revisionLabel}. Work already done stays as it is.</p>{[...grouped.entries()].map(([stepId, decisions]) => <div key={stepId} style={{ borderTop: '1px solid var(--kp-border)', paddingTop: 9, marginTop: 9 }}><strong>{instance ? liveStepTitle(instance, stepId) : 'New workflow step'}</strong>{instance?.snapshot.steps[stepId]?.status === 'done' && <p style={mutedStyle}>This step is complete. Its completed work and notes will not change.</p>}{decisions.map((decision) => <div key={decision.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 0' }}><span style={{ flex: 1 }}>{plainField(decision, instance ?? { snapshot: { steps: {} } } as LiveWorkflowInstance)}</span><Button size="sm" variant={decision.decision === 'accepted' ? 'primary' : 'secondary'} data-testid={`crm-live-propagation-accept-${decision.id}`} onClick={() => { void change(offer, decision.id, 'accepted'); }}>Accept</Button><Button size="sm" variant={decision.decision === 'rejected' ? 'primary' : 'secondary'} data-testid={`crm-live-propagation-reject-${decision.id}`} onClick={() => { void change(offer, decision.id, 'rejected'); }}>Keep current</Button></div>)}</div>)}<div style={{ display: 'flex', gap: 8, marginTop: 12 }}><Button data-testid={`crm-live-propagation-apply-${offer.id}`} disabled={!ready} onClick={() => { void apply(offer); }}>Apply these changes</Button>{instance?.lastApplyEventId && <Button variant="secondary" data-testid={`crm-live-propagation-undo-${instance.id}`} onClick={() => { void undo(instance); }}>Undo last update</Button>}</div></section>; })}</>}
    {data.instances.filter((instance) => instance.lastApplyEventId).map((instance) => <section key={`undo-${instance.id}`} style={panelStyle}><strong>{instance.householdLabel}</strong><span style={mutedStyle}> · Last update can be undone safely. Later household edits will stay in place.</span><Button data-testid={`crm-live-propagation-undo-${instance.id}`} variant="secondary" style={{ marginLeft: 8 }} onClick={() => { void undo(instance); }}>Undo last update</Button></section>)}
    {message && <p data-testid="crm-live-propagation-result" role="status">{message}</p>}
  </Screen>;
}

function Reports({ freshness }: { freshness: CrmFreshnessState }) { const [running, setRunning] = useState(false); const [report, setReport] = useState('No contact in 6 months'); return <Screen title="Reports" description="Answers from current records" Icon={BarChart3} action={<Button data-testid="crm-report-run" iconLeft={RefreshCw} onClick={() => { setRunning(true); }}>Run report</Button>}><div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><AskBar />{['No contact in 6 months', 'Attention vs fee', 'Birthdays', 'Age 65', 'RMD due', 'Review due'].map((name) => <button key={name} data-testid={`crm-report-${name.replaceAll(' ', '-').toLowerCase()}`} aria-pressed={report === name} onClick={() => { setReport(name); }}>{name}</button>)}</div><FreshnessBanner freshness={freshness} /><section style={panelStyle}><strong>{running ? 'Computed just now' : 'Choose a report'} from 1,284 sources</strong><p style={mutedStyle}>N means decrypted records and source-backed facts considered after filters. {report === 'Attention vs fee' ? 'Fee data is missing; this report does not estimate it.' : ''}</p>{running && <><p>Henderson household · Last meaningful contact Jan 8 · Platinum</p><p>Ortiz household · Last meaningful contact Dec 17 · Gold</p><Button variant="secondary">Save this view</Button> <Button variant="secondary">Export as Word</Button></>}</section></Screen>; }

function FirmSetup({ onNavigate, freshness }: { onNavigate: (route: CrmHomeRoute) => void; freshness: CrmFreshnessState }) { return <Screen title="Firm" description="The few rules that shape real work" Icon={Users} action={<Button data-testid="crm-firm-open-admin" iconLeft={ShieldCheck}>Open firm administration</Button>}><FreshnessBanner freshness={freshness} /><div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10 }}>{[{ route: 'firm-setup' as const, label: 'Firm setup', detail: 'Members, roles, service tiers, retention, teams' }, { route: 'fields-tags' as const, label: 'Fields and tags', detail: 'Shared structure for records' }, { route: 'intake-links' as const, label: 'Intake links', detail: 'Create, preview, review' }, { route: 'migration' as const, label: 'Migration', detail: 'Mirror, parallel run, cutover' }].map((item) => <button key={item.route} data-testid={`crm-firm-route-${item.route}`} onClick={() => { onNavigate(item.route); }} style={{ ...panelStyle, textAlign: 'left', cursor: 'pointer' }}><strong>{item.label}</strong><p style={mutedStyle}>{item.detail}</p></button>)}</div><section style={panelStyle}><strong>Members · Roles · Service tiers · Retention · Teams</strong><p>Maya Patel · Owner · Active · display from firm administration</p><p style={mutedStyle}>This is a display-only shell over firm administration. Ethical walls, invitations, access, and deactivation are managed there.</p></section></Screen>; }

function FieldsTags() { return <Screen title="Fields and tags" description="Shared structure without setup before value" Icon={Tags} action={<Button data-testid="crm-field-new" iconLeft={Plus}>New field</Button>}><section style={panelStyle}><strong>Custom fields</strong><p>Service region · Choice · Household · Optional <Button size="sm" variant="secondary">Edit</Button></p><p>Referral source · Choice · Household · Optional <Button size="sm" variant="secondary">Edit</Button></p></section><section style={panelStyle}><strong>Tags</strong><p><span>Tax planning</span> · <span>New client</span> · <span>Money movement</span></p><Button variant="secondary">Manage tags</Button><p style={mutedStyle}>Changing a field type after values exist is blocked. Make a replacement instead.</p></section><section style={panelStyle}><strong>Firm documents</strong><p style={mutedStyle}>Title, type, tags, last update. Content stays in the existing document editor.</p><Button variant="secondary">Open in document editor</Button></section></Screen>; }

function IntakeLinks() { return <Screen title="Intake links" description="Scoped forms that create reviewable submissions" Icon={ClipboardList} action={<Button data-testid="crm-intake-new" iconLeft={Plus}>New intake link</Button>}><section style={panelStyle}><strong>New client information</strong><p style={mutedStyle}>Choose fields and confirmation copy, preview on phone or desktop, then copy/share the link. A submission never writes directly into a household.</p><Button variant="secondary">Preview form</Button> <Button variant="secondary">Copy link</Button></section><section style={panelStyle}><strong>Submission review</strong><p>One response needs a deliberate match/create decision.</p><Button>Match this response</Button></section></Screen>; }

function Migration({ route, freshness, migration, onNavigate, actions }: { route: CrmHomeRoute; freshness: CrmFreshnessState; migration: CrmHomeAdapter['migration']; onNavigate: (route: CrmHomeRoute) => void; actions: CrmHomeAdapter['actions'] }) {
  const [parallel, setParallel] = useState(false);
  const [baseUrl, setBaseUrl] = useState('http://127.0.0.1:8788/v1');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => { setRunning(true); setError(null); try { await actions.runMigrationImport?.(baseUrl); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); } finally { setRunning(false); } };
  const exportKind = route === 'archive-export' ? 'archive' : route === 'rollback-export' ? 'rollback' : null;
  if (exportKind) return <ExportReadiness job={migration.exports.find((job) => job.kind === exportKind) ?? { kind: exportKind, status: 'failed', failureReason: 'No export job was supplied by the CRM data engine.' }} onCreate={() => actions.createExport?.(exportKind)} onRetry={() => actions.retryExport?.(exportKind)} />;
  if (route === 'workflow-recreation') return <WorkflowFallbackChecklist records={migration.workflowChecklists} onRecord={(record) => actions.recordWorkflowChecklist?.(record)} />;
  if (route === 'attachment-accounting') return <AttachmentFallbackChecklist records={migration.attachmentAccounting} onRecord={(record) => actions.recordAttachmentAccounting?.(record)} />;
  if (route === 'fidelity') return <FidelityReport onNavigate={onNavigate} {...(migration.report ? { report: migration.report } : {})} />;
  return <Screen title="Wealthbox migration" description="Bring over your practice safely" Icon={Activity} action={<Button data-testid="crm-migration-fidelity" disabled={!migration.report} onClick={() => { onNavigate('fidelity'); }}>Review import report</Button>}><FreshnessBanner freshness={freshness} /><section style={panelStyle}><strong>{migration.report ? 'Import finished' : 'Connect the simulator and import'}</strong><p style={mutedStyle}>{migration.report ? migration.report.message : 'Use the local simulator address. This only uses made-up Northcrest practice data.'}</p><label style={{ display: 'block', marginBottom: 10 }}>Simulator address <input data-testid="crm-migration-base-url" value={baseUrl} onChange={(event) => { setBaseUrl(event.target.value); }} style={{ display: 'block', width: 'min(620px, 100%)' }} /></label><Button data-testid="crm-migration-run-import" disabled={running} onClick={() => { void run(); }}>{running ? 'Importing…' : migration.report ? 'Run import again' : 'Run import'}</Button>{error && <p data-testid="crm-migration-error" role="alert">{error}</p>}</section><section style={panelStyle}><strong>Parallel run {parallel ? 'is active' : 'comes next'}</strong><p style={mutedStyle}>It mirrors only the information the source system lets us read. It does not pretend it can see a workflow’s current step when the source system does not provide it.</p><div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><Button variant="secondary" data-testid="crm-migration-archive" disabled={!migration.report} iconLeft={FileArchive} onClick={() => { onNavigate('archive-export'); }}>Archive export</Button><Button variant="secondary" data-testid="crm-migration-rollback" disabled={!migration.report} iconLeft={Download} onClick={() => { onNavigate('rollback-export'); }}>Rollback export</Button><Button data-testid="crm-migration-start-parallel" disabled={parallel || !migration.report} onClick={() => { setParallel(true); }}>{parallel ? 'Parallel run active' : 'Start parallel run'}</Button></div></section><section style={panelStyle}><strong>Things a person must check</strong><p style={mutedStyle}>If some information cannot be brought over, this gives you a simple checklist. Nothing is hidden behind technical error names.</p><div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><Button variant="secondary" data-testid="crm-migration-workflow-fallback" disabled={!migration.report} onClick={() => { onNavigate('workflow-recreation'); }}>In-flight workflow checklist</Button><Button variant="secondary" data-testid="crm-migration-attachment-fallback" disabled={!migration.report} onClick={() => { onNavigate('attachment-accounting'); }}>Attachment checklist</Button></div></section></Screen>;
}

function FidelityReport({ onNavigate, report }: { onNavigate: (route: CrmHomeRoute) => void; report?: MigrationFidelityReport }) { if (!report) return <Screen title="Import report" description="No import has run yet" Icon={Flag}><p>Run the import first.</p></Screen>; return <Screen title="Import report" description={new Date(report.generatedAt).toLocaleString()} Icon={Flag}><section style={panelStyle}><strong>What came over</strong><p style={mutedStyle}>{report.message}</p><div data-testid="crm-fidelity-matrix">{report.matrix.map((row) => <section key={row.sourceType} data-testid={`crm-fidelity-row-${row.sourceType}`} style={{ borderTop: '1px solid var(--kp-border)', padding: '8px 0' }}><strong>{row.sourceType.replaceAll('_', ' ')}</strong><span> · {row.fetched} found · {row.imported} imported · {row.skipped} not imported</span>{row.plainReason ? <p role="alert" style={mutedStyle}>{row.plainReason}</p> : null}</section>)}</div></section><section style={panelStyle}><strong>Attachments: {report.attachments.viaApi}</strong><p>{report.attachments.affected} clients need an answer: {report.attachments.exported} exported, {report.attachments.gaps} marked as a gap, {report.attachments.unaccounted} still need attention.</p><strong>In-flight workflows</strong><p>{report.workflows.checklists} checklist items · {report.workflows.pending} still need a decision.</p><Button variant="secondary" data-testid="crm-migration-workflow-fallback" onClick={() => { onNavigate('workflow-recreation'); }}>Open workflow checklist</Button> <Button variant="secondary" data-testid="crm-migration-attachment-fallback" onClick={() => { onNavigate('attachment-accounting'); }}>Open attachment checklist</Button></section></Screen>; }

function WorkflowFallbackChecklist({ records, onRecord }: { records: readonly MigrationWorkflowChecklist[]; onRecord: (record: MigrationWorkflowChecklist) => void | Promise<void> }) {
  const [drafts, setDrafts] = useState(records);
  const [saved, setSaved] = useState<ReadonlySet<string>>(() => new Set());
  const update = (id: string, change: Partial<MigrationWorkflowChecklist>) => { setDrafts((current) => current.map((record) => record.id === id ? { ...record, ...change } : record)); };
  const complete = (record: MigrationWorkflowChecklist) => record.evidenceReviewed && record.selectedCurrentStep && ((record.decision === 'recreate' && record.resultingInstanceLabel) || (record.decision === 'gap' && record.gapReason));
  const recordChecklist = async (record: MigrationWorkflowChecklist) => { await onRecord(record); setSaved((current) => new Set(current).add(record.id)); };
  return <Screen title="In-flight workflow re-creation" description="Required through cutover" Icon={Workflow}><p style={mutedStyle}>Every affected client is listed. The source API does not supply open-workflow state, so an operator selects the current step and records a resulting instance or a trace gap.</p>{drafts.map((record) => <section key={record.id} data-testid={`crm-workflow-checklist-${record.id}`} style={panelStyle}><strong>{record.clientLabel} · {record.sourceTemplateLabel}</strong><p style={mutedStyle}>Evidence: {record.activityEvidence.join(' · ') || 'No readable trace available'}</p><label><input data-testid={`crm-workflow-evidence-${record.id}`} type="checkbox" checked={Boolean(record.evidenceReviewed)} onChange={(event) => { update(record.id, { evidenceReviewed: event.target.checked }); }} /> I reviewed the available workflow evidence</label><label style={{ display: 'block', marginTop: 8 }}>Current step <select data-testid={`crm-workflow-step-${record.id}`} value={record.selectedCurrentStep ?? ''} onChange={(event) => { update(record.id, { selectedCurrentStep: event.target.value }); }}><option value="">Choose the current step</option>{record.availableSteps.map((step) => <option key={step}>{step}</option>)}</select></label><div style={{ display: 'flex', gap: 8, marginTop: 8 }}><Button size="sm" variant={record.decision === 'recreate' ? 'primary' : 'secondary'} onClick={() => { update(record.id, { decision: 'recreate' }); }}>Create resulting instance</Button><Button size="sm" variant={record.decision === 'gap' ? 'primary' : 'secondary'} onClick={() => { update(record.id, { decision: 'gap' }); }}>Record trace gap</Button></div>{record.decision === 'recreate' ? <label style={{ display: 'block', marginTop: 8 }}>Resulting Lantern instance <input data-testid={`crm-workflow-instance-${record.id}`} value={record.resultingInstanceLabel ?? ''} onChange={(event) => { update(record.id, { resultingInstanceLabel: event.target.value }); }} /></label> : record.decision === 'gap' ? <label style={{ display: 'block', marginTop: 8 }}>Gap reason <input data-testid={`crm-workflow-gap-${record.id}`} value={record.gapReason ?? ''} onChange={(event) => { update(record.id, { gapReason: event.target.value }); }} /></label> : null}<Button data-testid={`crm-workflow-record-${record.id}`} style={{ marginTop: 10 }} disabled={!complete(record)} onClick={() => { void recordChecklist(record); }}>Record this client’s checklist</Button>{saved.has(record.id) && <p data-testid={`crm-workflow-recorded-${record.id}`} role="status">Checklist recorded</p>}</section>)}</Screen>;
}

function AttachmentFallbackChecklist({ records, onRecord }: { records: readonly AttachmentAccountingRecord[]; onRecord: (record: AttachmentAccountingRecord) => void | Promise<void> }) {
  const [drafts, setDrafts] = useState(records);
  const [saved, setSaved] = useState<ReadonlySet<string>>(() => new Set());
  const update = (id: string, change: Partial<AttachmentAccountingRecord>) => { setDrafts((current) => current.map((record) => record.id === id ? { ...record, ...change } : record)); };
  const complete = (record: AttachmentAccountingRecord) => (record.status === 'exported' && record.exportSource && record.exportedBy) || (record.status === 'gap' && record.gapReason && record.gapOwner);
  const recordAttachment = async (record: AttachmentAccountingRecord) => { await onRecord(record); setSaved((current) => new Set(current).add(record.id)); };
  return <Screen title="Attachment accounting" description="Required through cutover" Icon={FileArchive}><p style={mutedStyle}>Every affected client needs exactly one complete record. An absence is never silently treated as no attachment.</p>{drafts.map((record) => <section key={record.id} data-testid={`crm-attachment-record-${record.id}`} style={panelStyle}><strong>{record.clientLabel}</strong><label style={{ display: 'block', marginTop: 8 }}>Status <select data-testid={`crm-attachment-status-${record.id}`} value={record.status} onChange={(event) => { update(record.id, { status: event.target.value as AttachmentAccountingRecord['status'] }); }}><option value="pending">Choose a status</option><option value="exported">Exported</option><option value="gap">Attachment gap</option></select></label>{record.status === 'exported' ? <><label style={{ display: 'block', marginTop: 8 }}>Export source <input data-testid={`crm-attachment-source-${record.id}`} value={record.exportSource ?? ''} onChange={(event) => { update(record.id, { exportSource: event.target.value }); }} /></label><label style={{ display: 'block', marginTop: 8 }}>Operator <input data-testid={`crm-attachment-operator-${record.id}`} value={record.exportedBy ?? ''} onChange={(event) => { update(record.id, { exportedBy: event.target.value }); }} /></label></> : record.status === 'gap' ? <><label style={{ display: 'block', marginTop: 8 }}>Gap reason <input data-testid={`crm-attachment-reason-${record.id}`} value={record.gapReason ?? ''} onChange={(event) => { update(record.id, { gapReason: event.target.value }); }} /></label><label style={{ display: 'block', marginTop: 8 }}>Gap owner <input data-testid={`crm-attachment-owner-${record.id}`} value={record.gapOwner ?? ''} onChange={(event) => { update(record.id, { gapOwner: event.target.value }); }} /></label></> : null}<Button data-testid={`crm-attachment-record-save-${record.id}`} style={{ marginTop: 10 }} disabled={!complete(record)} onClick={() => { void recordAttachment(record); }}>Record this client’s attachment status</Button>{saved.has(record.id) && <p data-testid={`crm-attachment-recorded-${record.id}`} role="status">Attachment status recorded</p>}</section>)}</Screen>;
}

function ExportReadiness({ job, onCreate, onRetry }: { job: ExportJobStatus; onCreate: () => void; onRetry: () => void }) { const kind = job.kind; return <Screen title={`${kind === 'archive' ? 'Archive' : 'Rollback'} export`} description="Prepare an export without changing a connector account" Icon={kind === 'archive' ? FileArchive : Download}><section style={panelStyle}><strong>{job.status === 'ready' ? 'Ready to prepare' : job.status === 'preparing' ? 'Preparing export' : job.status === 'exported' ? 'Exported' : 'Failed — retry available'}</strong><ul>{kind === 'archive' ? <><li>Manifest present</li><li>Raw-capture checksums verified</li><li>Fidelity counts matched</li><li>Storage destination selected</li></> : <><li>Full check complete</li><li>Current report saved</li><li>Eligible Lantern changes counted</li><li>Destination format checked</li><li>Known unsupported items listed</li></>}</ul>{job.status === 'exported' ? <p data-testid="crm-exported-status">Exported {job.exportedAt ?? 'at the recorded export time'} · {kind === 'archive' ? `Manifest ID: ${job.manifestId ?? 'missing from engine data'}` : `Reconciliation report: ${job.reconciliationReportId ?? 'missing from engine data'}`}</p> : job.status === 'failed' ? <><p role="alert">{job.failureReason ?? 'The export failed. Nothing changed in the connector account.'}</p><Button data-testid="crm-export-retry" onClick={onRetry}>Retry {kind} export</Button></> : job.status === 'preparing' ? <p data-testid="crm-export-preparing" role="status">Preparing the export. This page will update when the CRM data engine records its result.</p> : <Button data-testid="crm-export-create" onClick={onCreate}>Create {kind} export</Button>}</section></Screen>; }

function Screen({ title, description, Icon, action, children }: { title: string; description: string; Icon: typeof LayoutDashboard; action?: React.ReactNode; children: React.ReactNode }) { return <div data-testid={`crm-screen-${title.toLowerCase().replaceAll(' ', '-')}`} style={{ padding: 'var(--kp-space-xl)', overflow: 'auto', width: '100%', display: 'flex', flexDirection: 'column', gap: 'var(--kp-space-md)' }}><SurfaceHeader Icon={Icon} title={title} description={description} actions={action} />{children}</div>; }

function ConnectedCrmHome({ adapter, initialRoute = 'today', preview = false, workflowData, workflowHouseholds, saveLiveRecord }: Required<Pick<CrmHomeProps, 'adapter'>> & Omit<CrmHomeProps, 'adapter'> & { workflowData?: LiveWorkflowData; workflowHouseholds?: readonly HouseholdChoice[]; saveLiveRecord?: (record: LiveCrmRecord) => Promise<unknown> }) {
  // The screen receives engine-derived data only; preview data is opt-in above.
  const activeAdapter = adapter;
  const [route, setRoute] = useState<CrmHomeRoute>(initialRoute);
  const [notificationsRead, setNotificationsRead] = useState(false);
  const [undoReport, setUndoReport] = useState<string | null>(null);
  const freshness = activeAdapter.freshness;
  const offers = activeAdapter.offers;
  const approvals = activeAdapter.approvals ?? [];
  const activity = activeAdapter.activity ?? [];
  const savedTaskViews = activeAdapter.savedTaskViews ?? [];
  const updateTask = async (task: CrmTask) => { await activeAdapter.actions.updateTask?.(task); };
  const jump = (next: CrmHomeRoute) => { setRoute(next); };
  const reportUndo = useCallback(() => { const result = activeAdapter.actions.undoPropagation?.() ?? { restored: 0, protectedCells: [] }; setUndoReport(result.protectedCells.length ? `${String(result.restored)} untouched derived cells restored. Protected cells kept: ${result.protectedCells.join(', ')}.` : `${String(result.restored)} untouched derived cells restored. No protected cells needed to stay.`); }, [activeAdapter]);
  useEffect(() => { const onKeyDown = (event: KeyboardEvent) => { if ((event.target as HTMLElement | null)?.tagName === 'INPUT') return; if (event.key === 'g') { (window as Window & { __crmGo?: boolean }).__crmGo = true; return; } if ((window as Window & { __crmGo?: boolean }).__crmGo) { const key = event.key.toLowerCase(); const destination = key === 'h' ? 'today' : key === 't' ? 'tasks' : key === 'w' ? 'workflows' : key === 'p' ? 'pipeline' : key === 'r' ? 'reports' : key === 'f' ? 'firm-setup' : key === 'm' ? 'migration' : null; if (destination) { event.preventDefault(); jump(destination); } (window as Window & { __crmGo?: boolean }).__crmGo = false; } if (event.key === '/' && route !== 'tasks') { document.querySelector<HTMLInputElement>('[data-testid="crm-ask-input"]')?.focus(); } if (route === 'propagation' && event.key.toLowerCase() === 'u') { event.preventDefault(); reportUndo(); } }; window.addEventListener('keydown', onKeyDown); return () => { window.removeEventListener('keydown', onKeyDown); }; }, [activeAdapter, reportUndo, route]);
  const notificationPanel = <aside aria-label="Notifications" style={{ position: 'absolute', right: 20, top: 56, width: 340, zIndex: 10, ...panelStyle, boxShadow: 'var(--kp-shadow-2)' }}><strong>Notifications ({String(approvals.filter((approval) => approval.state === 'pending').length)})</strong><p style={mutedStyle}>Approval decisions are shown in Today. This device keeps ordinary read state locally.</p><p style={mutedStyle}>The relay exposes delivery timing and opaque envelope IDs, never message content.</p><Button data-testid="crm-notifications-read" variant="secondary" onClick={() => { setNotificationsRead(true); activeAdapter.actions.markNotificationsRead?.(); }}>{notificationsRead ? 'Marked read on this device' : 'Mark all read on this device'}</Button></aside>;
  const content = route === 'today' ? <Today tasks={activeAdapter.tasks} approvals={approvals} activity={activity} freshness={freshness} onNavigate={jump} onUpdateTask={updateTask} onDecideApproval={(approval, decision) => activeAdapter.actions.decideApproval?.(approval, decision)} /> : route === 'tasks' ? <Tasks tasks={activeAdapter.tasks} households={activeAdapter.households ?? []} savedViews={savedTaskViews} freshness={freshness} onUpdateTask={updateTask} onSaveView={(view) => activeAdapter.actions.saveTaskView?.(view)} /> : route === 'workflows' ? workflowData && workflowHouseholds && saveLiveRecord ? <LiveWorkflows data={workflowData} households={workflowHouseholds} onSave={saveLiveRecord} onNavigate={jump} /> : <Workflows freshness={freshness} onNavigate={jump} /> : route === 'propagation' ? workflowData && saveLiveRecord ? <LivePropagationReview data={workflowData} onSave={saveLiveRecord} /> : <PropagationReview offers={offers} freshness={freshness} onApply={(selected) => activeAdapter.actions.applyPropagation?.(selected)} onUndo={reportUndo} undoReport={undoReport} /> : route === 'pipeline' || route === 'pipeline-settings' ? <CrmPipelineSurface route={route} onNavigate={jump} /> : route === 'reports' ? <Reports freshness={freshness} /> : route === 'fields-tags' ? <FieldsTags /> : route === 'intake-links' ? <IntakeLinks /> : route === 'migration' || route === 'fidelity' || route === 'workflow-recreation' || route === 'attachment-accounting' || route === 'archive-export' || route === 'rollback-export' ? <Migration route={route} freshness={freshness} migration={activeAdapter.migration} onNavigate={jump} actions={activeAdapter.actions} /> : <FirmSetup onNavigate={jump} freshness={freshness} />;
  const [showNotifications, setShowNotifications] = useState(false);
  return <div data-testid="crm-home" style={{ display: 'flex', height: '100%', minHeight: 0, position: 'relative', background: 'var(--color-background)' }}>{preview && <div data-testid="crm-home-preview-label" role="status" style={{ position: 'absolute', zIndex: 20, right: 16, bottom: 12, ...panelStyle, padding: 8, borderColor: 'var(--kp-direct)' }}>Preview mode. Not connected to CRM data.</div>}<HomeRail route={route} onNavigate={jump} /><div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', position: 'relative' }}>{content}<button data-testid="crm-notifications-button" aria-label="Open notifications" onClick={() => { setShowNotifications((open) => !open); }} style={{ position: 'absolute', top: 15, right: 18, border: 0, background: 'transparent', cursor: 'pointer', color: 'var(--kp-navy)' }}><Bell size={20} /> <span aria-label={`${String(approvals.filter((approval) => approval.state === 'pending').length)} notifications`}>{String(approvals.filter((approval) => approval.state === 'pending').length)}</span></button>{showNotifications && notificationPanel}</div></div>;
}

export function CrmHome({ adapter, preview = false, initialRoute }: CrmHomeProps) {
  const [freshness, setFreshness] = useState<CrmFreshnessState>(getCrmEngineFreshness());
  const live = useLiveCrmRecords();
  useEffect(() => subscribeCrmEngineFreshness(setFreshness), []);
  const households = live.records.filter((record) => record.kind === 'household' && typeof record['name'] === 'string').map((record) => ({ id: record.id, name: record['name'] as string }));
  const householdName = (id: string | undefined) => households.find((household) => household.id === id)?.name;
  const contextIds = (record: Record<string, unknown>): string[] => Array.isArray(record['contextRefs']) ? record['contextRefs'].flatMap((value) => typeof value === 'string' ? [value] : value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string' ? [(value as { id: string }).id] : []) : [];
  const householdIdFor = (record: Record<string, unknown>): string | undefined => {
    const ref = record['householdRef'];
    return ref && typeof ref === 'object' && typeof (ref as { id?: unknown }).id === 'string' ? (ref as { id: string }).id : contextIds(record)[0];
  };
  const liveTasks: readonly CrmTask[] = live.records.filter((record) => record.kind === 'task').map((record) => {
    const householdId = householdIdFor(record);
    const recurrence = record['recurrence'];
    const recurrenceFrequencyValue = (recurrence as { freq?: unknown } | null)?.freq;
    const recurrenceFrequency = typeof recurrenceFrequencyValue === 'string' ? recurrenceFrequencyValue : '';
    const validRecurrence = recurrence && typeof recurrence === 'object' && ['daily', 'weekly', 'monthly', 'yearly'].includes(recurrenceFrequency) ? { freq: recurrenceFrequency as NonNullable<CrmTask['recurrence']>['freq'], interval: Math.max(1, Number((recurrence as { interval?: unknown }).interval) || 1), regenerateOnComplete: (recurrence as { regenerateOnComplete?: unknown }).regenerateOnComplete !== false } : undefined;
    return {
      id: record.id,
      title: typeof record['title'] === 'string' ? record['title'] : 'Untitled task',
      ...(typeof record['body'] === 'string' ? { body: record['body'] } : {}),
      assigneeUserId: typeof record['assigneeUserId'] === 'string' ? record['assigneeUserId'] : null,
      ...(typeof record['assigneeLabel'] === 'string' ? { assigneeLabel: record['assigneeLabel'] } : {}),
      status: record['status'] === 'in_progress' || record['status'] === 'blocked' || record['status'] === 'done' || record['status'] === 'cancelled' ? record['status'] : 'open',
      priority: record['priority'] === 'high' || record['priority'] === 'low' ? record['priority'] : 'normal',
      ...(householdId ? { householdId, householdLabel: householdName(householdId) } : {}),
      ...(typeof record['due'] === 'string' ? { dueAt: record['due'], dueLabel: record['due'] } : typeof record['dueAt'] === 'string' ? { dueAt: record['dueAt'], dueLabel: record['dueAt'] } : {}),
      ...(validRecurrence ? { recurrence: validRecurrence, recurrenceLabel: 'Recurring' } : {}),
      contextRefs: contextIds(record),
    };
  });
  const liveApprovals: readonly CrmApproval[] = live.records.filter((record) => record.kind === 'proposalRecord').map((record) => {
    const householdId = householdIdFor(record);
    const proposalKind = typeof record['proposalKind'] === 'string' ? record['proposalKind'].replaceAll('_', ' ') : 'proposed change';
    return { id: record.id, title: typeof record['title'] === 'string' ? record['title'] : `Review ${proposalKind}`, ...(typeof record['rationale'] === 'string' ? { rationale: record['rationale'] } : {}), ...(householdId ? { householdLabel: householdName(householdId) } : {}), state: record['state'] === 'approved' || record['state'] === 'rejected' || record['state'] === 'expired' ? record['state'] : 'pending', ...(typeof record['decidedAt'] === 'string' ? { decidedAt: record['decidedAt'] } : {}) };
  });
  const liveActivity: readonly CrmActivity[] = live.records.filter((record) => record.kind === 'activityEvent' && typeof record['at'] === 'string').map((record) => ({ id: record.id, summary: typeof record['summary'] === 'string' ? record['summary'] : 'CRM activity recorded', at: record['at'] as string }));
  const savedTaskViews: readonly CrmTaskSavedView[] = live.records.filter((record) => record.kind === 'savedView' && record['surface'] === 'tasks').map((record) => ({ id: record.id, name: typeof record['name'] === 'string' ? record['name'] : 'Saved view', layout: record['layout'] === 'kanban' || record['layout'] === 'table' ? record['layout'] : 'list', ...(typeof (record['query'] as { search?: unknown } | undefined)?.search === 'string' ? { search: (record['query'] as { search: string }).search } : {}) }));
  const liveWorkflowChecklists: readonly MigrationWorkflowChecklist[] = live.records.filter((record) => record.kind === 'migration_workflow_checklist').map((record) => ({
    id: record.id,
    clientLabel: typeof record['clientLabel'] === 'string' ? record['clientLabel'] : 'Imported client',
    sourceTemplateLabel: typeof record['sourceTemplateLabel'] === 'string' ? record['sourceTemplateLabel'] : 'Imported workflow',
    activityEvidence: Array.isArray(record['activityEvidence']) ? record['activityEvidence'].filter((item): item is string => typeof item === 'string') : [],
    availableSteps: Array.isArray(record['availableSteps']) ? record['availableSteps'].filter((item): item is string => typeof item === 'string') : [],
    ...(typeof record['selectedCurrentStep'] === 'string' ? { selectedCurrentStep: record['selectedCurrentStep'] } : {}),
    evidenceReviewed: record['evidenceReviewed'] === true,
    decision: record['decision'] === 'recreate' || record['decision'] === 'gap' ? record['decision'] : 'pending',
    ...(typeof record['resultingInstanceLabel'] === 'string' ? { resultingInstanceLabel: record['resultingInstanceLabel'] } : {}),
    ...(typeof record['gapReason'] === 'string' ? { gapReason: record['gapReason'] } : {}),
  }));
  const liveAttachmentAccounting: readonly AttachmentAccountingRecord[] = live.records.filter((record) => record.kind === 'migration_attachment_accounting').map((record) => ({
    id: record.id,
    clientLabel: typeof record['clientLabel'] === 'string' ? record['clientLabel'] : 'Imported client',
    status: record['status'] === 'exported' || record['status'] === 'gap' ? record['status'] : 'pending',
    ...(typeof record['exportSource'] === 'string' ? { exportSource: record['exportSource'] } : {}),
    ...(typeof record['exportedBy'] === 'string' ? { exportedBy: record['exportedBy'] } : {}),
    ...(typeof record['gapReason'] === 'string' ? { gapReason: record['gapReason'] } : {}),
    ...(typeof record['gapOwner'] === 'string' ? { gapOwner: record['gapOwner'] } : {}),
  }));
  const reportRecord = live.records.find((record) => record.kind === 'migration_report');
  const liveReport: MigrationFidelityReport | undefined = reportRecord && Array.isArray(reportRecord['matrix']) && typeof reportRecord['batchId'] === 'string' && typeof reportRecord['generatedAt'] === 'string' && typeof reportRecord['message'] === 'string' && reportRecord['attachments'] && typeof reportRecord['attachments'] === 'object' && reportRecord['workflows'] && typeof reportRecord['workflows'] === 'object' ? reportRecord as unknown as MigrationFidelityReport : undefined;
  const liveExports: readonly ExportJobStatus[] = (['archive', 'rollback'] as const).map((kind) => {
    const record = live.records.find((item) => item.kind === 'migration_export' && item['exportKind'] === kind);
    return {
      kind,
      status: record?.['status'] === 'exported' || record?.['status'] === 'preparing' || record?.['status'] === 'failed' ? record['status'] : 'ready',
      ...(typeof record?.['exportedAt'] === 'string' ? { exportedAt: record['exportedAt'] } : {}),
      ...(typeof record?.['manifestId'] === 'string' ? { manifestId: record['manifestId'] } : {}),
      ...(typeof record?.['reconciliationReportId'] === 'string' ? { reconciliationReportId: record['reconciliationReportId'] } : {}),
      ...(typeof record?.['failureReason'] === 'string' ? { failureReason: record['failureReason'] } : {}),
    };
  });
  const recordActivity = async (summary: string, task?: CrmTask) => {
    const now = new Date().toISOString();
    await live.save({ id: `activity-${crypto.randomUUID()}`, kind: 'activityEvent', matterId: 'firm_home', at: now, summary, actor: { userId: 'local-user', displayName: 'You' }, targetRef: task ? { kind: 'task', id: task.id, ...(task.householdId ? { matterId: task.householdId } : {}) } : { kind: 'firmDoc', id: 'firm_home' }, ...(task?.householdId ? { householdId: task.householdId } : {}), payload: {}, important: false });
  };
  const nextRecurringDue = (due: string | undefined, recurrence: NonNullable<CrmTask['recurrence']>): string | undefined => {
    if (!due) return undefined;
    const date = new Date(`${due.slice(0, 10)}T12:00:00Z`);
    const amount = recurrence.interval;
    if (recurrence.freq === 'daily') date.setUTCDate(date.getUTCDate() + amount);
    else if (recurrence.freq === 'weekly') date.setUTCDate(date.getUTCDate() + amount * 7);
    else if (recurrence.freq === 'monthly') date.setUTCMonth(date.getUTCMonth() + amount);
    else date.setUTCFullYear(date.getUTCFullYear() + amount);
    return date.toISOString().slice(0, 10);
  };
  const saveTask = async (task: CrmTask) => {
    const householdId = task.householdId ?? task.contextRefs?.[0];
    if (!householdId) throw new Error('Choose a client before saving a task.');
    const previous = liveTasks.find((item) => item.id === task.id);
    const householdRef = { kind: 'household', id: householdId, matterId: householdId };
    await live.save({ id: task.id, kind: 'task', matterId: 'firm_home', title: task.title.trim(), body: task.body ?? '', assigneeUserId: task.assigneeUserId, status: task.status, ...(task.dueAt ? { due: task.dueAt } : {}), priority: task.priority, ...(task.recurrence ? { recurrence: task.recurrence } : {}), householdRef, contextRefs: [householdRef], customFields: {} });
    await recordActivity(task.status === 'done' && previous?.status !== 'done' ? `Completed task: ${task.title}` : previous ? `Updated task: ${task.title}` : `Created task: ${task.title}`, { ...task, householdId });
    if (task.status === 'done' && previous?.status !== 'done' && task.recurrence?.regenerateOnComplete) {
      const dueAt = nextRecurringDue(task.dueAt, task.recurrence);
      const child: CrmTask = { ...task, id: `task-${crypto.randomUUID()}`, status: 'open', ...(dueAt ? { dueAt, dueLabel: dueAt } : {}) };
      await live.save({ id: child.id, kind: 'task', matterId: 'firm_home', title: child.title, body: child.body ?? '', assigneeUserId: child.assigneeUserId, status: 'open', ...(dueAt ? { due: dueAt } : {}), priority: child.priority, recurrence: child.recurrence, householdRef, contextRefs: [householdRef], customFields: {} });
      await recordActivity(`Created next recurring task: ${child.title}`, child);
    }
  };
  const liveAdapter: CrmHomeAdapter = {
    ...emptyEngineAdapter(freshness),
    tasks: liveTasks,
    households,
    approvals: liveApprovals,
    activity: liveActivity,
    savedTaskViews,
    migration: { workflowChecklists: liveWorkflowChecklists, attachmentAccounting: liveAttachmentAccounting, exports: liveExports, ...(liveReport ? { report: liveReport } : {}) },
    actions: {
      updateTask: saveTask,
      recordWorkflowChecklist: async (record) => { await live.save({ ...record, kind: 'migration_workflow_checklist', matterId: 'firm' }); },
      recordAttachmentAccounting: async (record) => { await live.save({ ...record, kind: 'migration_attachment_accounting', matterId: 'firm' }); },
      createExport: (kind) => { void createMigrationExport(live.workspaceRoot, kind).then(() => live.reload()); },
      retryExport: (kind) => { void createMigrationExport(live.workspaceRoot, kind).then(() => live.reload()); },
      runMigrationImport: async (baseUrl) => { await runWealthboxMigration(live.workspaceRoot, baseUrl); await live.reload(); },
      saveTaskView: async (view) => { await live.save({ id: view.id, kind: 'savedView', matterId: 'firm_home', name: view.name, surface: 'tasks', layout: view.layout, query: { entity: 'task', filters: [], ...(view.search ? { search: view.search } : {}) }, visibility: 'personal' }); await recordActivity(`Saved task view: ${view.name}`); },
      decideApproval: async (approval, decision) => {
        const record = live.records.find((item) => item.id === approval.id && item.kind === 'proposalRecord');
        if (!record) throw new Error('This approval is no longer available.');
        const decidedAt = new Date().toISOString();
        await live.save({ ...record, state: decision, decidedAt, decidedBy: { userId: 'local-user', displayName: 'You' } });
        if (decision === 'approved' && record['proposalKind'] === 'task_create') {
          const proposed = record['proposedMutation'] as { task?: Partial<CrmTask> } | undefined;
          const proposalTask = proposed?.task;
          if (proposalTask?.title) await saveTask({ id: `task-${record.id}`, title: proposalTask.title, body: '', assigneeUserId: proposalTask.assigneeUserId ?? null, status: 'open', priority: proposalTask.priority ?? 'normal', ...(proposalTask.householdId ? { householdId: proposalTask.householdId } : householdIdFor(record) ? { householdId: householdIdFor(record) } : {}), ...(proposalTask.dueAt ? { dueAt: proposalTask.dueAt } : {}), contextRefs: proposalTask.contextRefs ?? [] });
        }
        await recordActivity(`${decision === 'approved' ? 'Approved' : 'Dismissed'} proposal: ${approval.title}`);
      },
    },
  };
  const activeAdapter = adapter ?? (preview ? PREVIEW_ADAPTER : liveAdapter);
  const workflowHouseholds: HouseholdChoice[] = live.records.filter((record) => record.kind === 'household').map((record) => ({ id: record.id, label: typeof record['name'] === 'string' ? record['name'] : typeof record['label'] === 'string' ? record['label'] : 'Untitled household' }));
  const liveWorkflowProps = adapter || preview ? {} : { workflowData: workflowRecords(live.records), workflowHouseholds, saveLiveRecord: live.save };
  return <ConnectedCrmHome adapter={activeAdapter} preview={preview} {...liveWorkflowProps} {...(initialRoute ? { initialRoute } : {})} />;
}

export default CrmHome;
