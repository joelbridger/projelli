/* eslint-disable lantern-i18n/no-hardcoded-string -- Frozen CRM screen copy needs its translation catalog in a separate product change. */
import { useMemo, useState } from 'react';
import { CheckCircle2, FolderKanban, Plus } from 'lucide-react';
import { Button } from '@/ui/kp';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import { useLiveCrmRecords } from '@/platform/crm/useLiveCrmRecords';
import { FreshnessBanner, Screen, mutedStyle, panelStyle } from '@/features/crm-home/shared/ui';

type ProjectStatus = 'open' | 'completed';
type StoredProject = LiveCrmRecord & {
  kind: 'project';
  name: string;
  description: string;
  status: ProjectStatus;
  householdRef: { kind: 'household'; id: string; label?: string };
  taskIds: string[];
  completedAt?: string;
};

type StoredTask = LiveCrmRecord & {
  kind: 'task';
  title: string;
  status?: string;
  projectId?: string;
};

const localActor = { userId: 'local-user', display: 'You', kind: 'user' as const };
const localSource = { origin: 'user' as const, sources: [] };

function now() { return new Date().toISOString(); }
function id(prefix: string) { return `${prefix}:${crypto.randomUUID()}`; }
function isProject(record: LiveCrmRecord): record is StoredProject {
  return record.kind === 'project'
    && typeof record['name'] === 'string'
    && typeof record['description'] === 'string'
    && record['householdRef'] !== null
    && typeof record['householdRef'] === 'object'
    && typeof (record['householdRef'] as { id?: unknown }).id === 'string';
}
function isTask(record: LiveCrmRecord): record is StoredTask {
  return record.kind === 'task' && typeof record['title'] === 'string';
}
function householdName(record: LiveCrmRecord) {
  return typeof record['name'] === 'string' && record['name'].trim()
    ? record['name']
    : 'Unnamed household';
}
function base(recordId: string): LiveCrmRecord {
  const time = now();
  return {
    id: recordId,
    kind: 'project',
    matterId: 'firm_home',
    createdAt: time,
    createdBy: localActor,
    updatedAt: time,
    updatedBy: localActor,
    source: localSource,
    deleted: false,
    externalRefs: [],
    schemaVersion: 1,
  };
}

export function ProjectsSurface() {
  const live = useLiveCrmRecords();
  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const projects = useMemo(
    () => live.records.filter(isProject).filter((project) => project['deleted'] !== true),
    [live.records],
  );
  const households = useMemo(
    () => live.records.filter((record) => record.kind === 'household' && record['deleted'] !== true),
    [live.records],
  );
  const selected = projects.find((project) => project.id === selectedId) ?? null;
  const selectProject = (project: StoredProject) => {
    setSelectedId(project.id);
    setCreating(false);
    setEditing(false);
  };
  const save = async (record: LiveCrmRecord, success?: string) => {
    try {
      await live.save(record);
      if (success) setMessage(success);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not save this project.');
    }
  };

  return (
    <Screen
      title="Projects"
      description="Keep a larger piece of client work, its tasks, and its progress together."
      Icon={FolderKanban}
      action={
        <Button
          data-testid="crm-project-new"
          iconLeft={Plus}
          disabled={!households.length}
          onClick={() => { setCreating(true); setSelectedId(null); setEditing(false); setMessage(null); }}
        >
          New project
        </Button>
      }
    >
      <FreshnessBanner freshness={live.freshness} />
      {live.error ? <section role="alert" style={panelStyle}>Could not load saved projects: {live.error}</section> : null}
      {!households.length ? (
        <section data-testid="crm-project-first-use-households" style={panelStyle}>
          <strong>Start with a client</strong>
          <p style={mutedStyle}>Projects always belong to a household. Add a household in Clients first, then come back here to keep the work together.</p>
        </section>
      ) : null}
      {message ? <p data-testid="crm-project-result" role="status">{message}</p> : null}
      {(creating || editing) ? (
        <ProjectEditor
          project={editing ? selected : null}
          households={households}
          onCancel={() => { setCreating(false); setEditing(false); }}
          onSave={(draft) => {
            void save(draft, editing ? 'Project updated.' : 'Project created. Add the first task when you are ready.')
              .then(() => {
                setSelectedId(draft.id);
                setCreating(false);
                setEditing(false);
              })
              .catch((error: unknown) => {
                setMessage(error instanceof Error ? error.message : 'Could not save this project.');
              });
          }}
        />
      ) : selected ? (
        <ProjectDetail
          project={selected}
          tasks={live.records.filter(isTask).filter((task) => task.projectId === selected.id && task['deleted'] !== true)}
          householdLabel={householdName(households.find((household) => household.id === selected.householdRef.id) ?? { id: selected.householdRef.id, kind: 'household' })}
          onEdit={() => { setEditing(true); setMessage(null); }}
          onSave={(record, success) => {
            void save(record, success).catch((error: unknown) => {
              setMessage(error instanceof Error ? error.message : 'Could not save this project.');
            });
          }}
        />
      ) : (
        <>
          {!projects.length ? (
            <section data-testid="crm-project-first-use" style={panelStyle}>
              <strong>No projects yet</strong>
              <p style={mutedStyle}>Use a project for a larger piece of work, such as a retirement plan update. Add the tasks that make it happen, then mark the project complete when the work is done.</p>
              <Button data-testid="crm-project-create-first" disabled={!households.length} onClick={() => { setCreating(true); }}>Create a project</Button>
            </section>
          ) : null}
          <section data-testid="crm-project-list" style={{ display: 'grid', gap: 10 }}>
            {projects.map((project) => (
              <button
                key={project.id}
                data-testid={`crm-project-open-${project.id}`}
                onClick={() => { selectProject(project); }}
                style={{ ...panelStyle, cursor: 'pointer', textAlign: 'left', width: '100%' }}
              >
                <strong>{project.name}</strong>
                <div style={mutedStyle}>{householdName(households.find((household) => household.id === project.householdRef.id) ?? { id: project.householdRef.id, kind: 'household' })} · {project.status === 'completed' ? 'Completed' : 'Open'}</div>
                {project.description ? <p style={{ ...mutedStyle, marginBottom: 0 }}>{project.description}</p> : null}
              </button>
            ))}
          </section>
        </>
      )}
    </Screen>
  );
}

function ProjectEditor({ project, households, onCancel, onSave }: {
  project: StoredProject | null;
  households: readonly LiveCrmRecord[];
  onCancel: () => void;
  onSave: (record: StoredProject) => void;
}) {
  const [name, setName] = useState(project?.name ?? '');
  const [householdId, setHouseholdId] = useState(project?.householdRef.id ?? households[0]?.id ?? '');
  const [description, setDescription] = useState(project?.description ?? '');
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const household = households.find((item) => item.id === householdId);
    if (!name.trim() || !household) return;
    const record: StoredProject = {
      ...(project ?? base(id('project'))),
      kind: 'project',
      name: name.trim(),
      description: description.trim(),
      status: project?.status ?? 'open',
      householdRef: { kind: 'household', id: household.id, label: householdName(household) },
      taskIds: project?.taskIds ?? [],
    } as StoredProject;
    onSave(record);
  };
  return <section data-testid="crm-project-editor" style={{ ...panelStyle, borderColor: 'var(--kp-assured)' }}>
    <h2 style={{ marginTop: 0 }}>{project ? 'Edit project' : 'New project'}</h2>
    <form onSubmit={submit} style={{ display: 'grid', gap: 10, maxWidth: 620 }}>
      <label style={fieldStyle}>Project name<input data-testid="crm-project-name" value={name} onChange={(event) => { setName(event.target.value); }} placeholder="For example, retirement plan update" autoFocus /></label>
      <label style={fieldStyle}>Client<select data-testid="crm-project-household" value={householdId} onChange={(event) => { setHouseholdId(event.target.value); }}>{households.map((household) => <option key={household.id} value={household.id}>{householdName(household)}</option>)}</select></label>
      <label style={fieldStyle}>What is this project for?<textarea data-testid="crm-project-description" value={description} onChange={(event) => { setDescription(event.target.value); }} placeholder="A short note helps everyone understand the work." /></label>
      <div style={{ display: 'flex', gap: 8 }}><Button data-testid="crm-project-save" type="submit" disabled={!name.trim() || !householdId}>Save project</Button><Button data-testid="crm-project-cancel" variant="secondary" type="button" onClick={onCancel}>Cancel</Button></div>
    </form>
  </section>;
}

function ProjectDetail({ project, tasks, householdLabel, onEdit, onSave }: {
  project: StoredProject;
  tasks: readonly StoredTask[];
  householdLabel: string;
  onEdit: () => void;
  onSave: (record: LiveCrmRecord, success?: string) => void;
}) {
  const [taskTitle, setTaskTitle] = useState('');
  const completedTasks = tasks.filter((task) => task.status === 'done').length;
  const addTask = () => {
    const title = taskTitle.trim();
    if (!title || project.status === 'completed') return;
    const taskId = id('project-task');
    const time = now();
    onSave({
      id: taskId,
      kind: 'task',
      matterId: project.householdRef.id,
      createdAt: time,
      createdBy: localActor,
      updatedAt: time,
      updatedBy: localActor,
      source: localSource,
      deleted: false,
      externalRefs: [],
      schemaVersion: 1,
      title,
      body: '',
      householdRef: project.householdRef,
      assigneeUserId: null,
      status: 'open',
      priority: 'normal',
      contextRefs: [{ kind: 'project', id: project.id, matterId: project.matterId, label: project.name }],
      customFields: {},
      projectId: project.id,
    }, 'Task added to this project.');
    onSave({ ...project, taskIds: [...project.taskIds, taskId], updatedAt: time, updatedBy: localActor }, undefined);
    setTaskTitle('');
  };
  const updateTask = (task: StoredTask, status: 'open' | 'done') => {
    onSave({ ...task, status, updatedAt: now(), updatedBy: localActor }, status === 'done' ? 'Task completed.' : 'Task reopened.');
  };
  const complete = () => { onSave({ ...project, status: 'completed', completedAt: now(), updatedAt: now(), updatedBy: localActor }, 'Project completed.'); };
  const reopen = () => { onSave({ ...project, status: 'open', completedAt: undefined, updatedAt: now(), updatedBy: localActor }, 'Project reopened.'); };
  return <section data-testid="crm-project-detail" style={{ display: 'grid', gap: 12 }}>
    <section style={panelStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'start' }}><div><h2 data-testid="crm-project-title" style={{ margin: 0 }}>{project.name}</h2><p style={mutedStyle}>{householdLabel} · <span data-testid="crm-project-status">{project.status === 'completed' ? 'Completed' : 'Open'}</span></p>{project.description ? <p style={{ marginBottom: 0 }}>{project.description}</p> : <p style={mutedStyle}>No project note yet.</p>}</div><div style={{ display: 'flex', gap: 8 }}><Button data-testid="crm-project-edit" variant="secondary" onClick={onEdit}>Edit</Button>{project.status === 'completed' ? <Button data-testid="crm-project-reopen" variant="secondary" onClick={reopen}>Reopen project</Button> : <Button data-testid="crm-project-complete" iconLeft={CheckCircle2} onClick={complete}>Complete project</Button>}</div></div>
    </section>
    <section data-testid="crm-project-tasks" style={panelStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}><div><strong>Project tasks</strong><p style={{ ...mutedStyle, margin: '4px 0 0' }}>{completedTasks} of {tasks.length} complete</p></div></div>
      {project.status === 'open' ? <div style={{ display: 'flex', gap: 8, marginTop: 10 }}><input data-testid="crm-project-task-title" value={taskTitle} onChange={(event) => { setTaskTitle(event.target.value); }} placeholder="Add a task" aria-label="New project task" /><Button data-testid="crm-project-task-add" disabled={!taskTitle.trim()} onClick={addTask}>Add task</Button></div> : <p style={mutedStyle}>This project is complete. Reopen it if more work is needed.</p>}
      {!tasks.length ? <p style={mutedStyle}>No tasks yet. Add the first small step to get this work moving.</p> : <div style={{ display: 'grid', gap: 7, marginTop: 10 }}>{tasks.map((task) => <div key={task.id} data-testid={`crm-project-task-${task.id}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', borderTop: '1px solid var(--kp-border)', paddingTop: 8 }}><span>{task.title}</span><Button size="sm" variant="secondary" data-testid={`crm-project-task-toggle-${task.id}`} disabled={project.status === 'completed'} onClick={() => { updateTask(task, task.status === 'done' ? 'open' : 'done'); }}>{task.status === 'done' ? 'Reopen' : 'Complete'}</Button></div>)}</div>}
    </section>
  </section>;
}

const fieldStyle = { display: 'grid', gap: 4, fontSize: 'var(--kp-font-sm)' } as const;
