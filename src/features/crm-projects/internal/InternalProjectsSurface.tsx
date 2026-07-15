import { useState } from 'react';
import { ClipboardList, Plus, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Badge, Button, Card, EmptyState } from '@/ui/kp';
import { SurfaceHeader } from '@/ui/SurfaceHeader';
import { createInternalProject, internalProjectStatuses, projectProgress, toggleInternalProjectMilestone, type CreateInternalProjectInput, type InternalProject, type InternalProjectStatus } from './model';
import { createInternalProjectRepository, type InternalProjectRepository } from './repository';

const panelStyle = { border: '1px solid var(--kp-border)', borderRadius: 'var(--radius-lg)', background: 'var(--kp-surface)', padding: 'var(--kp-space-md)' } as const;
const mutedStyle = { color: 'var(--kp-text-faint)', fontSize: 'var(--kp-font-sm)' } as const;

interface InternalProjectsSurfaceProps {
  repository?: InternalProjectRepository;
}

const defaultCreateInput = (): CreateInternalProjectInput => ({ name: '', category: '', status: 'planning', owner: '', dueDate: null, milestones: [], collaborators: [] });

function statusVariant(status: InternalProjectStatus): 'neutral' | 'success' | 'warning' | 'danger' | 'direct' {
  if (status === 'on_track' || status === 'complete') return 'success';
  if (status === 'needs_attention') return 'danger';
  if (status === 'in_progress') return 'direct';
  return 'warning';
}

function formatDueDate(value: string | null, fallback: string): string {
  if (!value) return fallback;
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.valueOf()) ? fallback : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

export function InternalProjectsSurface({ repository = createInternalProjectRepository() }: InternalProjectsSurfaceProps) {
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = useState(() => repository.load());
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState(defaultCreateInput);
  const selected = snapshot.projects.find((project) => project.id === snapshot.selectedProjectId) ?? null;
  const save = (next: typeof snapshot) => { repository.save(next); setSnapshot(next); };
  const select = (projectId: string) => save({ ...snapshot, selectedProjectId: projectId });
  const create = () => {
    if (!draft.name.trim() || !draft.owner.trim()) return;
    const project = createInternalProject(draft);
    save({ projects: [...snapshot.projects, project], selectedProjectId: project.id });
    setDraft(defaultCreateInput());
    setCreating(false);
  };
  const updateMilestone = (project: InternalProject, milestoneId: string) => save({ ...snapshot, projects: snapshot.projects.map((item) => item.id === project.id ? toggleInternalProjectMilestone(item, milestoneId) : item) });

  return <div data-testid="internal-projects-surface" style={{ padding: 'var(--kp-space-xl)', overflow: 'auto', width: '100%', display: 'grid', gap: 'var(--kp-space-md)', alignContent: 'start' }}>
    <SurfaceHeader Icon={ClipboardList} title={t('internal-projects.title')} description={t('internal-projects.description')} actions={<Button data-testid="internal-projects-create" iconLeft={Plus} onClick={() => setCreating((value) => !value)}>{t('internal-projects.new')}</Button>} />
    {creating ? <CreateProjectForm draft={draft} onChange={setDraft} onCancel={() => setCreating(false)} onCreate={create} /> : null}
    {snapshot.projects.length === 0 ? <EmptyState data-testid="internal-projects-empty" icon={ClipboardList} title={t('internal-projects.empty.title')} body={t('internal-projects.empty.body')} actions={<Button data-testid="internal-projects-empty-create" iconLeft={Plus} onClick={() => setCreating(true)}>{t('internal-projects.empty.action')}</Button>} /> : <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.65fr) minmax(280px, 0.85fr)', gap: 'var(--kp-space-md)', alignItems: 'start' }}>
      <ProjectList projects={snapshot.projects} selectedProjectId={selected?.id ?? null} onSelect={select} t={t} />
      <ProjectDetail project={selected} onToggleMilestone={updateMilestone} t={t} />
    </div>}
  </div>;
}

function CreateProjectForm({ draft, onChange, onCancel, onCreate }: { draft: CreateInternalProjectInput; onChange: (next: CreateInternalProjectInput) => void; onCancel: () => void; onCreate: () => void }) {
  const { t } = useTranslation();
  const update = <Key extends keyof CreateInternalProjectInput>(key: Key, value: CreateInternalProjectInput[Key]) => onChange({ ...draft, [key]: value });
  return <Card variant="raised" data-testid="internal-projects-create-form"><div style={{ display: 'grid', gap: 10 }}><h2 style={{ margin: 0 }}>{t('internal-projects.create.title')}</h2><label>{t('internal-projects.fields.name')}<input data-testid="internal-projects-name" value={draft.name} onChange={(event) => update('name', event.target.value)} /></label><label>{t('internal-projects.fields.category')}<input data-testid="internal-projects-category" value={draft.category} onChange={(event) => update('category', event.target.value)} /></label><label>{t('internal-projects.fields.owner')}<input data-testid="internal-projects-owner" value={draft.owner} onChange={(event) => update('owner', event.target.value)} /></label><label>{t('internal-projects.fields.status')}<select data-testid="internal-projects-status" value={draft.status} onChange={(event) => update('status', event.target.value as InternalProjectStatus)}>{internalProjectStatuses.map((status) => <option value={status} key={status}>{t(`internal-projects.status.${status}`)}</option>)}</select></label><label>{t('internal-projects.fields.due')}<input data-testid="internal-projects-due" type="date" value={draft.dueDate ?? ''} onChange={(event) => update('dueDate', event.target.value || null)} /></label><label>{t('internal-projects.fields.milestones')}<textarea data-testid="internal-projects-milestones" value={draft.milestones.join('\n')} onChange={(event) => update('milestones', event.target.value.split('\n'))} /></label><label>{t('internal-projects.fields.collaborators')}<input data-testid="internal-projects-collaborators" value={draft.collaborators.join(', ')} onChange={(event) => update('collaborators', event.target.value.split(','))} /></label><div style={{ display: 'flex', gap: 8 }}><Button data-testid="internal-projects-save" disabled={!draft.name.trim() || !draft.owner.trim()} onClick={onCreate}>{t('internal-projects.create.save')}</Button><Button variant="secondary" onClick={onCancel}>{t('internal-projects.create.cancel')}</Button></div></div></Card>;
}

function ProjectList({ projects, selectedProjectId, onSelect, t }: { projects: readonly InternalProject[]; selectedProjectId: string | null; onSelect: (id: string) => void; t: TFunction }) {
  return <section data-testid="internal-projects-list" style={panelStyle}><table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}><thead><tr>{['project', 'status', 'owner', 'progress', 'due'].map((column) => <th key={column} style={{ padding: '0 8px 8px', ...mutedStyle }}>{t(`internal-projects.columns.${column}`)}</th>)}</tr></thead><tbody>{projects.map((project) => { const progress = projectProgress(project); return <tr key={project.id} data-testid={`internal-project-row-${project.id}`} aria-selected={selectedProjectId === project.id} onClick={() => onSelect(project.id)} style={{ cursor: 'pointer', background: selectedProjectId === project.id ? 'var(--kp-assured-bg)' : undefined }}><td style={{ padding: 8 }}><strong>{project.name}</strong><br /><span style={mutedStyle}>{project.category || t('internal-projects.noCategory')}</span></td><td style={{ padding: 8 }}><Badge variant={statusVariant(project.status)}>{t(`internal-projects.status.${project.status}`)}</Badge></td><td style={{ padding: 8 }}>{project.owner}</td><td style={{ padding: 8, minWidth: 110 }}><span>{t('internal-projects.progressLabel', { completed: progress.completed, total: progress.total })}</span><div aria-label={t('internal-projects.progressAria', { percent: progress.percent })} style={{ height: 6, background: 'var(--kp-border)', borderRadius: 999, marginTop: 5 }}><div style={{ width: `${String(progress.percent)}%`, height: '100%', background: 'var(--kp-assured)', borderRadius: 999 }} /></div></td><td style={{ padding: 8 }}>{formatDueDate(project.dueDate, t('internal-projects.noDue'))}</td></tr>; })}</tbody></table></section>;
}

function ProjectDetail({ project, onToggleMilestone, t }: { project: InternalProject | null; onToggleMilestone: (project: InternalProject, milestoneId: string) => void; t: TFunction }) {
  if (!project) return <aside data-testid="internal-projects-detail-empty" style={panelStyle}><EmptyState compact icon={ClipboardList} title={t('internal-projects.detail.emptyTitle')} body={t('internal-projects.detail.emptyBody')} /></aside>;
  const progress = projectProgress(project);
  return <aside data-testid="internal-projects-detail" style={panelStyle}><Badge variant={statusVariant(project.status)}>{t(`internal-projects.status.${project.status}`)}</Badge><h2 style={{ marginBottom: 4 }}>{project.name}</h2><p style={mutedStyle}>{t('internal-projects.detail.owner', { owner: project.owner })}</p><div aria-label={t('internal-projects.progressAria', { percent: progress.percent })} style={{ height: 8, background: 'var(--kp-border)', borderRadius: 999 }}><div style={{ width: `${String(progress.percent)}%`, height: '100%', background: 'var(--kp-assured)', borderRadius: 999 }} /></div><p><strong>{t('internal-projects.progressLabel', { completed: progress.completed, total: progress.total })}</strong> · {t('internal-projects.detail.due', { due: formatDueDate(project.dueDate, t('internal-projects.noDue')) })}</p><h3>{t('internal-projects.detail.milestones')}</h3>{project.milestones.length === 0 ? <p style={mutedStyle}>{t('internal-projects.detail.noMilestones')}</p> : project.milestones.map((milestone) => <label key={milestone.id} style={{ display: 'block', margin: '7px 0' }}><input data-testid={`internal-project-milestone-${milestone.id}`} type="checkbox" checked={milestone.completed} onChange={() => onToggleMilestone(project, milestone.id)} /> {milestone.title}</label>)}<h3>{t('internal-projects.detail.summary')}</h3><p data-testid="internal-project-summary" style={mutedStyle}>{t('internal-projects.detail.files', { count: project.summary.files })} · {t('internal-projects.detail.notes', { count: project.summary.notes })} · {t('internal-projects.detail.events', { count: project.summary.events })}</p><h3>{t('internal-projects.detail.collaborators')}</h3><div data-testid="internal-project-collaborators" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{project.collaborators.length ? project.collaborators.map((collaborator) => <Badge key={collaborator}><Users size={12} /> {collaborator}</Badge>) : <span style={mutedStyle}>{t('internal-projects.detail.noCollaborators')}</span>}</div></aside>;
}
