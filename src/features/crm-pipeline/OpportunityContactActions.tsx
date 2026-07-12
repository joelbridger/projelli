/* eslint-disable lantern-i18n/no-hardcoded-string -- Frozen CRM screen copy needs its translation catalog in a separate product change. */
import { useState } from 'react';
import { Check, Plus, Sparkles } from 'lucide-react';
import { Button } from '@/ui/kp';

export type OpportunityContactActionKind = 'field_update' | 'tag_add' | 'task_create';
export type OpportunityContactActionState = 'ready' | 'pending_approval' | 'complete' | 'dismissed';

export interface OpportunityContactActionStep {
  id: string;
  title: string;
  kind: OpportunityContactActionKind;
  state: OpportunityContactActionState;
  fieldName?: string;
  value?: string;
  tagName?: string;
  taskTitle?: string;
  proposalId?: string;
}

const muted = { color: 'var(--kp-text-faint)', fontSize: 'var(--kp-font-sm)' } as const;
const fieldStyle = { display: 'grid', gap: 4, fontSize: 'var(--kp-font-sm)' } as const;

function actionSummary(action: OpportunityContactActionStep): string {
  if (action.kind === 'field_update') return `Update ${action.fieldName || 'a contact field'} to ${action.value || 'a new value'}`;
  if (action.kind === 'tag_add') return `Add the “${action.tagName || 'new'}” tag`;
  return `Create the task “${action.taskTitle || 'new follow-up'}”`;
}

function validDraft(action: Omit<OpportunityContactActionStep, 'id' | 'state'>): boolean {
  if (!action.title.trim()) return false;
  if (action.kind === 'field_update') return Boolean(action.fieldName?.trim() && action.value?.trim());
  if (action.kind === 'tag_add') return Boolean(action.tagName?.trim());
  return Boolean(action.taskTitle?.trim());
}

export function OpportunityContactActionsEditor({
  actions,
  onChange,
}: {
  actions: readonly OpportunityContactActionStep[];
  onChange: (actions: OpportunityContactActionStep[]) => void;
}) {
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<OpportunityContactActionKind>('field_update');
  const [fieldName, setFieldName] = useState('');
  const [value, setValue] = useState('');
  const [tagName, setTagName] = useState('');
  const [taskTitle, setTaskTitle] = useState('');
  const draft = { title, kind, fieldName, value, tagName, taskTitle };
  const add = () => {
    if (!validDraft(draft)) return;
    onChange([...actions, {
      id: crypto.randomUUID(), title: title.trim(), kind, state: 'ready',
      ...(kind === 'field_update' ? { fieldName: fieldName.trim(), value: value.trim() } : {}),
      ...(kind === 'tag_add' ? { tagName: tagName.trim() } : {}),
      ...(kind === 'task_create' ? { taskTitle: taskTitle.trim() } : {}),
    }]);
    setTitle(''); setFieldName(''); setValue(''); setTagName(''); setTaskTitle('');
  };
  return <section data-testid="crm-opportunity-contact-actions-editor" style={{ borderTop: '1px solid var(--kp-border)', paddingTop: 12, gridColumn: '1 / -1' }}>
    <strong>Contact actions in this workflow</strong>
    <p style={muted}>When a step is ready, Lantern prepares the change for your approval. It never changes a contact on its own.</p>
    {actions.length ? <ol data-testid="crm-opportunity-contact-actions-draft" style={{ margin: '8px 0', paddingLeft: 20 }}>{actions.map((action, index) => <li key={action.id} style={{ marginTop: 4 }}>{action.title}: {actionSummary(action)} <button type="button" data-testid={`crm-opportunity-action-remove-${String(index)}`} onClick={() => { onChange(actions.filter((item) => item.id !== action.id)); }} style={{ marginLeft: 6, border: 0, background: 'transparent', color: 'var(--kp-danger)', cursor: 'pointer' }}>Remove</button></li>)}</ol> : <p data-testid="crm-opportunity-contact-actions-empty" style={muted}>Add the first step below. For example, tag a prospect or create a follow-up task.</p>}
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8, marginTop: 8 }}>
      <label style={fieldStyle}>Workflow step<input data-testid="crm-opportunity-action-title" value={title} onChange={(event) => { setTitle(event.target.value); }} placeholder="For example, qualify prospect" /></label>
      <label style={fieldStyle}>Action<select data-testid="crm-opportunity-action-type" value={kind} onChange={(event) => { setKind(event.target.value as OpportunityContactActionKind); }}><option value="field_update">Update a contact field</option><option value="tag_add">Add a tag</option><option value="task_create">Create a task</option></select></label>
      {kind === 'field_update' ? <><label style={fieldStyle}>Field name<input data-testid="crm-opportunity-action-field" value={fieldName} onChange={(event) => { setFieldName(event.target.value); }} placeholder="For example, Prospect status" /></label><label style={fieldStyle}>New value<input data-testid="crm-opportunity-action-value" value={value} onChange={(event) => { setValue(event.target.value); }} placeholder="For example, Qualified" /></label></> : null}
      {kind === 'tag_add' ? <label style={fieldStyle}>Tag name<input data-testid="crm-opportunity-action-tag" value={tagName} onChange={(event) => { setTagName(event.target.value); }} placeholder="For example, Priority prospect" /></label> : null}
      {kind === 'task_create' ? <label style={fieldStyle}>Task title<input data-testid="crm-opportunity-action-task" value={taskTitle} onChange={(event) => { setTaskTitle(event.target.value); }} placeholder="For example, Call Morgan" /></label> : null}
    </div>
    <Button type="button" size="sm" variant="secondary" iconLeft={Plus} data-testid="crm-opportunity-action-add" disabled={!validDraft(draft)} style={{ marginTop: 8 }} onClick={add}>Add workflow step</Button>
  </section>;
}

export function OpportunityContactActions({
  opportunityId,
  actions,
  onPrepare,
  onApprove,
  onDismiss,
}: {
  opportunityId: string;
  actions: readonly OpportunityContactActionStep[];
  onPrepare: (action: OpportunityContactActionStep) => void;
  onApprove: (action: OpportunityContactActionStep) => void;
  onDismiss: (action: OpportunityContactActionStep) => void;
}) {
  if (!actions.length) return null;
  return <section data-testid={`crm-opportunity-workflow-${opportunityId}`} style={{ borderTop: '1px solid var(--kp-border)', marginTop: 10, paddingTop: 9 }}>
    <strong style={{ fontSize: 'var(--kp-font-sm)' }}>Contact actions</strong>
    <p style={{ ...muted, margin: '4px 0 8px' }}>Each change waits here for your approval.</p>
    {actions.map((action, index) => <div key={action.id} data-testid={`crm-opportunity-action-${opportunityId}-${String(index)}`} style={{ display: 'grid', gap: 5, borderTop: index ? '1px solid var(--kp-border)' : undefined, paddingTop: index ? 8 : 0, marginTop: index ? 8 : 0 }}>
      <div><strong>{action.title}</strong><span style={muted}> · {actionSummary(action)}</span></div>
      {action.state === 'ready' ? <Button size="sm" variant="secondary" iconLeft={Sparkles} data-testid={`crm-opportunity-action-prepare-${opportunityId}-${String(index)}`} onClick={() => { onPrepare(action); }}>Complete step and prepare approval</Button> : null}
      {action.state === 'pending_approval' ? <div data-testid={`crm-opportunity-action-review-${opportunityId}-${String(index)}`} style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}><span style={{ ...muted, color: 'var(--kp-assured)' }}>Lantern proposed this change. Nothing has changed yet.</span><Button size="sm" iconLeft={Check} data-testid={`crm-opportunity-action-approve-${opportunityId}-${String(index)}`} onClick={() => { onApprove(action); }}>Approve and apply</Button><Button size="sm" variant="secondary" data-testid={`crm-opportunity-action-dismiss-${opportunityId}-${String(index)}`} onClick={() => { onDismiss(action); }}>Dismiss</Button></div> : null}
      {action.state === 'complete' ? <span data-testid={`crm-opportunity-action-complete-${opportunityId}-${String(index)}`} style={{ ...muted, color: 'var(--color-green-800)' }}>Approved and applied.</span> : null}
      {action.state === 'dismissed' ? <span style={muted}>Dismissed. You can edit the opportunity to add it again.</span> : null}
    </div>)}
  </section>;
}

export { actionSummary };
