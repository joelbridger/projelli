import '@/features/crm-home/testSetup';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { InternalProjectsSurface } from './InternalProjectsSurface';
import { createInternalProject } from './model';
import { createInternalProjectRepository, INTERNAL_PROJECTS_STORAGE_KEY } from './repository';
import { internalProjectsSurface } from './surface';
import { isEnabled } from '@/platform/flags';

describe('internal firm projects', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('creates through the form and restores every field in a fresh repository', () => {
    const firstRepository = createInternalProjectRepository();
    const firstMount = render(<InternalProjectsSurface repository={firstRepository} />);
    expect(screen.getByTestId('internal-projects-empty')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('internal-projects-empty-create'));
    fireEvent.change(screen.getByTestId('internal-projects-name'), { target: { value: 'Annual ADV update' } });
    fireEvent.change(screen.getByTestId('internal-projects-category'), { target: { value: 'Compliance filing' } });
    fireEvent.change(screen.getByTestId('internal-projects-owner'), { target: { value: 'Priya Shah' } });
    fireEvent.change(screen.getByTestId('internal-projects-status'), { target: { value: 'in_progress' } });
    fireEvent.change(screen.getByTestId('internal-projects-due'), { target: { value: '2026-08-12' } });
    fireEvent.change(screen.getByTestId('internal-projects-milestones'), { target: { value: 'Review business description\nFinal partner approval' } });
    fireEvent.change(screen.getByTestId('internal-projects-collaborators'), { target: { value: 'Priya Shah, Sarah Morgan' } });
    fireEvent.click(screen.getByTestId('internal-projects-save'));

    expect(screen.getByTestId('internal-projects-list')).toHaveTextContent('Annual ADV update');
    expect(screen.getByTestId('internal-projects-detail')).toHaveTextContent('Priya Shah');
    expect(screen.getByTestId('internal-project-collaborators')).toHaveTextContent('Sarah Morgan');
    expect(screen.getByTestId('internal-project-summary')).toHaveTextContent('0 files');
    const created = firstRepository.load().projects[0];
    expect(created).toMatchObject({
      name: 'Annual ADV update',
      category: 'Compliance filing',
      status: 'in_progress',
      owner: 'Priya Shah',
      dueDate: '2026-08-12',
      collaborators: ['Priya Shah', 'Sarah Morgan'],
      summary: { files: 0, notes: 0, events: 0 },
    });
    expect(created?.milestones.map((milestone) => milestone.title)).toEqual([
      'Review business description',
      'Final partner approval',
    ]);
    expect(created?.milestones.map((milestone) => milestone.completed)).toEqual([
      false,
      false,
    ]);
    expect(created?.createdAt).toEqual(expect.any(String));
    expect(created?.updatedAt).toEqual(expect.any(String));

    firstMount.unmount();
    const freshRepository = createInternalProjectRepository();
    render(<InternalProjectsSurface repository={freshRepository} />);

    expect(freshRepository.load()).toEqual({
      projects: [created],
      selectedProjectId: created?.id ?? null,
    });
    expect(screen.getByTestId('internal-projects-detail')).toHaveTextContent(
      'Annual ADV update'
    );
    expect(screen.getByTestId('internal-project-collaborators')).toHaveTextContent(
      'Sarah Morgan'
    );
  });

  it('does not write anything when the form is invalid', () => {
    const repository = createInternalProjectRepository();
    render(<InternalProjectsSurface repository={repository} />);

    fireEvent.click(screen.getByTestId('internal-projects-empty-create'));
    fireEvent.change(screen.getByTestId('internal-projects-name'), {
      target: { value: 'Missing owner' },
    });
    const saveButton = screen.getByTestId('internal-projects-save');
    expect(saveButton).toBeDisabled();
    fireEvent.click(saveButton);

    expect(localStorage.getItem(INTERNAL_PROJECTS_STORAGE_KEY)).toBeNull();
    expect(repository.load()).toEqual({ projects: [], selectedProjectId: null });
  });

  it('persists milestone progress and the selected project through a restart', () => {
    const repository = createInternalProjectRepository();
    const project = createInternalProject({
      name: 'New associate onboarding',
      category: 'People operations',
      status: 'on_track',
      owner: 'David Kim',
      dueDate: '2026-07-31',
      milestones: ['Finish system access', '30-day check-in'],
      collaborators: ['David Kim', 'Jordan Lee'],
    }, '2026-07-15T12:00:00.000Z');
    repository.save({ projects: [project], selectedProjectId: project.id });

    const first = render(<InternalProjectsSurface repository={repository} />);
    fireEvent.click(screen.getByTestId(`internal-project-milestone-${project.milestones[0]?.id ?? ''}`));
    first.unmount();

    render(<InternalProjectsSurface repository={repository} />);
    expect(screen.getByTestId('internal-projects-detail')).toHaveTextContent('New associate onboarding');
    expect(screen.getByTestId('internal-projects-detail')).toHaveTextContent('1 / 2 milestones complete');
    expect(screen.getByTestId('internal-project-collaborators')).toHaveTextContent('Jordan Lee');
    expect(repository.load().selectedProjectId).toBe(project.id);
    expect(repository.load().projects[0]).not.toHaveProperty('matterId');
  });

  it('rejects malformed nested stored data before rendering can read it', () => {
    const validProject = createInternalProject({
      name: 'Valid project',
      category: 'Operations',
      status: 'planning',
      owner: 'Priya Shah',
      dueDate: null,
      milestones: ['A milestone'],
      collaborators: ['Sarah Morgan'],
    });
    const malformedProjects = [
      { ...validProject, milestones: [{ ...validProject.milestones[0], completed: 'yes' }] },
      { ...validProject, collaborators: ['Sarah Morgan', 42] },
      { ...validProject, summary: { files: 0, notes: 'none', events: 0 } },
      { ...validProject, summary: { files: 0, notes: 0 } },
    ];

    for (const project of malformedProjects) {
      localStorage.setItem(
        INTERNAL_PROJECTS_STORAGE_KEY,
        JSON.stringify({ projects: [project], selectedProjectId: validProject.id })
      );
      const repository = createInternalProjectRepository();
      expect(repository.load()).toEqual({ projects: [], selectedProjectId: null });
    }
  });

  it('declares its route dark through the public flag API', () => {
    expect(internalProjectsSurface).toMatchObject({
      id: 'internal-projects',
      route: 'internal-projects',
      flagId: 'internal-projects',
    });
    expect(isEnabled('internal-projects')).toBe(false);
  });
});
