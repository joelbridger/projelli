import type { InternalProject } from './model';

export const INTERNAL_PROJECTS_STORAGE_KEY = 'lantern:crm:internal-projects:v1';

export interface InternalProjectsSnapshot {
  projects: readonly InternalProject[];
  selectedProjectId: string | null;
}

export interface InternalProjectRepository {
  load(): InternalProjectsSnapshot;
  save(snapshot: InternalProjectsSnapshot): void;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

const emptySnapshot = (): InternalProjectsSnapshot => ({ projects: [], selectedProjectId: null });

function isStatus(value: unknown): boolean {
  return value === 'planning' || value === 'on_track' || value === 'in_progress' || value === 'needs_attention' || value === 'complete';
}

function isProject(value: unknown): value is InternalProject {
  if (!value || typeof value !== 'object') return false;
  const project = value as Partial<InternalProject>;
  return typeof project.id === 'string' && typeof project.name === 'string' && typeof project.category === 'string' && isStatus(project.status) && typeof project.owner === 'string' && (typeof project.dueDate === 'string' || project.dueDate === null) && Array.isArray(project.milestones) && Array.isArray(project.collaborators) && typeof project.createdAt === 'string' && typeof project.updatedAt === 'string';
}

function parseSnapshot(raw: string | null): InternalProjectsSnapshot {
  if (!raw) return emptySnapshot();
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return emptySnapshot();
    const snapshot = value as Partial<InternalProjectsSnapshot>;
    if (!Array.isArray(snapshot.projects) || !snapshot.projects.every(isProject)) return emptySnapshot();
    const selectedProjectId = typeof snapshot.selectedProjectId === 'string' && snapshot.projects.some((project) => project.id === snapshot.selectedProjectId) ? snapshot.selectedProjectId : null;
    return { projects: snapshot.projects, selectedProjectId };
  } catch {
    return emptySnapshot();
  }
}

/** Browser-profile persistence is the approved TS-only adapter for this Wave-1 surface. */
export function createInternalProjectRepository(storage: StorageLike | undefined = typeof localStorage === 'undefined' ? undefined : localStorage): InternalProjectRepository {
  return {
    load: () => {
      try {
        return parseSnapshot(storage?.getItem(INTERNAL_PROJECTS_STORAGE_KEY) ?? null);
      } catch {
        return emptySnapshot();
      }
    },
    save: (snapshot) => {
      if (!storage) return;
      storage.setItem(INTERNAL_PROJECTS_STORAGE_KEY, JSON.stringify(snapshot));
    },
  };
}
