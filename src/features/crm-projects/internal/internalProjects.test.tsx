import '@/features/crm-home/testSetup';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { InternalProjectsSurface } from './InternalProjectsSurface';
import { createInternalProject } from './model';
import { createInternalProjectRepository, INTERNAL_PROJECTS_STORAGE_KEY } from './repository';

describe('internal firm projects', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts with a clear empty state and creates an internal project', () => {
    const repository = createInternalProjectRepository();
    render(<InternalProjectsSurface repository={repository} />);
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
    expect(repository.load().projects[0]).toMatchObject({
      name: 'Annual ADV update',
      status: 'in_progress',
      owner: 'Priya Shah',
      dueDate: '2026-08-12',
      collaborators: ['Priya Shah', 'Sarah Morgan'],
    });
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

  it('rejects malformed saved data instead of inventing a project', () => {
    localStorage.setItem(INTERNAL_PROJECTS_STORAGE_KEY, '{"projects":[{"id":"unsafe"}]}');
    const repository = createInternalProjectRepository();
    expect(repository.load()).toEqual({ projects: [], selectedProjectId: null });
  });
});
