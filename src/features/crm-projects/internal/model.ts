/**
 * The small, feature-owned contract for firm work that is not attached to a
 * client. Task and workflow links intentionally stay out of this foundation:
 * their registries arrive in a later wave.
 */
export type InternalProjectStatus = 'planning' | 'on_track' | 'in_progress' | 'needs_attention' | 'complete';

export interface InternalProjectMilestone {
  id: string;
  title: string;
  completed: boolean;
}

export interface InternalProjectSummary {
  files: number;
  notes: number;
  events: number;
}

export interface InternalProject {
  id: string;
  name: string;
  category: string;
  status: InternalProjectStatus;
  owner: string;
  dueDate: string | null;
  milestones: readonly InternalProjectMilestone[];
  collaborators: readonly string[];
  summary: InternalProjectSummary;
  createdAt: string;
  updatedAt: string;
}

export interface CreateInternalProjectInput {
  name: string;
  category: string;
  status: InternalProjectStatus;
  owner: string;
  dueDate: string | null;
  milestones: readonly string[];
  collaborators: readonly string[];
}

export const internalProjectStatuses: readonly InternalProjectStatus[] = [
  'planning',
  'on_track',
  'in_progress',
  'needs_attention',
  'complete',
];

export function projectProgress(project: InternalProject): { completed: number; total: number; percent: number } {
  const total = project.milestones.length;
  const completed = project.milestones.filter((milestone) => milestone.completed).length;
  return { completed, total, percent: total === 0 ? 0 : Math.round((completed / total) * 100) };
}

export function createInternalProject(input: CreateInternalProjectInput, now = new Date().toISOString()): InternalProject {
  return {
    id: `internal-project:${crypto.randomUUID()}`,
    name: input.name.trim(),
    category: input.category.trim(),
    status: input.status,
    owner: input.owner.trim(),
    dueDate: input.dueDate,
    milestones: input.milestones.map((title) => ({ id: `milestone:${crypto.randomUUID()}`, title: title.trim(), completed: false })).filter((milestone) => milestone.title.length > 0),
    collaborators: [...new Set(input.collaborators.map((collaborator) => collaborator.trim()).filter(Boolean))],
    summary: { files: 0, notes: 0, events: 0 },
    createdAt: now,
    updatedAt: now,
  };
}

export function toggleInternalProjectMilestone(project: InternalProject, milestoneId: string, now = new Date().toISOString()): InternalProject {
  return {
    ...project,
    milestones: project.milestones.map((milestone) => milestone.id === milestoneId ? { ...milestone, completed: !milestone.completed } : milestone),
    updatedAt: now,
  };
}
