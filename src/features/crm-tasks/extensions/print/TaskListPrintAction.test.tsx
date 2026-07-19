import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CrmTask, CrmWorkflowWorkItem } from '@/features/crm-home';
import {
  mountTaskActions,
  taskActionRegistry,
} from '../../taskExtensionRegistry';

const task: CrmTask = Object.freeze({
  id: 'task-review',
  title: 'Review <img src=x onerror="steal()"> plan',
  assigneeUserId: 'advisor-1',
  assigneeLabel: 'Avery <script>steal()</script>',
  status: 'open',
  priority: 'high',
  dueAt: '2030-04-12',
  dueLabel: 'Apr 12, 2030',
  dueTime: '09:30',
  tagIds: Object.freeze(['tag:review']),
});

const workflowWorkItem: CrmWorkflowWorkItem = Object.freeze({
  id: 'workflow-prepare',
  instanceId: 'workflow-1',
  stepId: 'prepare',
  title: 'Prepare review packet',
  workflowLabel: 'Review packet',
  householdId: 'household-1',
  householdLabel: 'Morgan household',
  assigneeUserId: null,
  status: 'in_progress',
  priority: 'normal',
  dueAt: '2030-04-13',
  tagIds: Object.freeze(['tag:workflow']),
});

interface PrintPopup {
  iframe: HTMLIFrameElement;
  popup: Window;
  focus: ReturnType<typeof vi.fn>;
  print: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

const popups: PrintPopup[] = [];

function createPrintPopup(): PrintPopup {
  const iframe = document.createElement('iframe');
  document.body.appendChild(iframe);
  const popup = iframe.contentWindow;
  if (!popup) throw new Error('Expected an iframe print window.');
  const focus = vi.fn();
  const print = vi.fn();
  const close = vi.fn();
  Object.defineProperties(popup, {
    focus: { configurable: true, value: focus },
    print: { configurable: true, value: print },
    close: { configurable: true, value: close },
  });
  const result = { iframe, popup, focus, print, close };
  popups.push(result);
  return result;
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const { iframe } of popups.splice(0)) iframe.remove();
});

function renderRegisteredAction(
  tasks: readonly CrmTask[] = [task],
  workflowWorkItems: readonly CrmWorkflowWorkItem[] = [workflowWorkItem]
) {
  return render(
    <>
      {mountTaskActions({
        tasks,
        workflowWorkItems,
        compatibilityMount: <span data-testid="private-toolbar-content" />,
      })}
    </>
  );
}

describe('task list print action', () => {
  it('mounts exactly once from the real registry and prints only the supplied mixed list on the direct click', () => {
    const popup = createPrintPopup();
    const open = vi.spyOn(window, 'open').mockReturnValue(popup.popup);
    const tasks = Object.freeze([task]);
    const workflowWorkItems = Object.freeze([workflowWorkItem]);
    const before = JSON.stringify({ tasks, workflowWorkItems });

    renderRegisteredAction(tasks, workflowWorkItems);

    expect(
      taskActionRegistry.filter(
        (descriptor) => descriptor.id === 'task-list-print.toolbar'
      )
    ).toHaveLength(1);
    const button = screen.getByRole('button', { name: 'Print task list' });
    fireEvent.click(button);

    expect(open).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledWith(
      'about:blank',
      '_blank',
      'width=900,height=700,menubar=no,toolbar=no,location=no,status=no'
    );
    expect(popup.focus).toHaveBeenCalledOnce();
    expect(popup.print).toHaveBeenCalledOnce();
    expect(popup.popup.document.title).toBe('Current task list');
    expect(popup.popup.document.body).toHaveTextContent('2 supplied records');
    expect(popup.popup.document.body).toHaveTextContent(task.title);
    expect(popup.popup.document.body).toHaveTextContent('Task');
    expect(popup.popup.document.body).toHaveTextContent('Open');
    expect(popup.popup.document.body).toHaveTextContent(
      task.assigneeLabel ?? ''
    );
    expect(popup.popup.document.body).toHaveTextContent(
      'Apr 12, 2030 at 09:30'
    );
    expect(popup.popup.document.body).toHaveTextContent(workflowWorkItem.title);
    expect(popup.popup.document.body).toHaveTextContent('Workflow step');
    expect(popup.popup.document.body).toHaveTextContent('In progress');
    expect(popup.popup.document.body).toHaveTextContent('Unassigned');
    expect(popup.popup.document.body).toHaveTextContent('2030-04-13');
    expect(
      popup.popup.document.querySelector(
        '[data-testid="private-toolbar-content"]'
      )
    ).toBeNull();
    expect(popup.popup.document.querySelector('img, script')).toBeNull();
    expect(JSON.stringify({ tasks, workflowWorkItems })).toBe(before);
    expect(tasks[0]).toBe(task);
    expect(workflowWorkItems[0]).toBe(workflowWorkItem);
  });

  it('prints the truthful zero-count empty state', () => {
    const popup = createPrintPopup();
    vi.spyOn(window, 'open').mockReturnValue(popup.popup);

    renderRegisteredAction([], []);
    fireEvent.click(screen.getByRole('button', { name: 'Print task list' }));

    expect(popup.print).toHaveBeenCalledOnce();
    expect(popup.popup.document.body).toHaveTextContent('0 supplied records');
    expect(popup.popup.document.body).toHaveTextContent(
      'No tasks or workflow steps were supplied for this list.'
    );
    expect(popup.popup.document.querySelector('ol')).toBeNull();
  });

  it('shows an honest visible error when the popup is blocked', () => {
    vi.spyOn(window, 'open').mockReturnValue(null);

    renderRegisteredAction();
    fireEvent.click(screen.getByRole('button', { name: 'Print task list' }));

    expect(screen.getByRole('alert')).toHaveTextContent(
      'The print window could not open. Allow popups and try again.'
    );
  });

  it('shows the popup-blocked error instead of throwing when opening the popup throws', () => {
    vi.spyOn(window, 'open').mockImplementation(() => {
      throw new Error('Popup unavailable');
    });

    renderRegisteredAction();
    expect(() =>
      fireEvent.click(screen.getByRole('button', { name: 'Print task list' }))
    ).not.toThrow();

    expect(screen.getByRole('alert')).toHaveTextContent(
      'The print window could not open. Allow popups and try again.'
    );
  });

  it('shows an honest visible error and closes the popup when printing fails', () => {
    const popup = createPrintPopup();
    popup.print.mockImplementation(() => {
      throw new Error('Print unavailable');
    });
    vi.spyOn(window, 'open').mockReturnValue(popup.popup);

    renderRegisteredAction();
    fireEvent.click(screen.getByRole('button', { name: 'Print task list' }));

    expect(screen.getByRole('alert')).toHaveTextContent(
      'The print dialog could not open. Try again.'
    );
    expect(popup.close).toHaveBeenCalledOnce();
  });
});
