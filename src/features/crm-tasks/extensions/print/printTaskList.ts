import type { TFunction } from 'i18next';
import type { TaskActionContext } from '@/features/crm-tasks';

type PrintableTaskContext = Pick<
  TaskActionContext,
  'tasks' | 'workflowWorkItems'
>;

type PrintableItem =
  | PrintableTaskContext['tasks'][number]
  | PrintableTaskContext['workflowWorkItems'][number];

export type TaskListPrintResult =
  | { ok: true; recordCount: number }
  | { ok: false; reason: 'popup-blocked' | 'print-failed' };

const PRINT_WINDOW_FEATURES =
  'width=900,height=700,menubar=no,toolbar=no,location=no,status=no';

const PRINT_COLOR_TOKENS = [
  '--kp-surface-card',
  '--kp-print-foreground',
  '--kp-print-heading-rule',
  '--kp-tag-slate',
  '--kp-print-list-rule',
] as const;

const PRINT_CSS = `
  @page { size: letter; margin: 0.7in; }
  *, *::before, *::after { box-sizing: border-box; }
  html, body { background: var(--kp-surface-card); color: var(--kp-print-foreground); }
  body { font-family: Arial, sans-serif; font-size: 10.5pt; line-height: 1.45; margin: 0; }
  h1 { border-bottom: 2px solid var(--kp-print-heading-rule); font-size: 20pt; margin: 0 0 8pt; padding-bottom: 8pt; }
  .summary { color: var(--kp-tag-slate); margin: 0 0 18pt; }
  ol { margin: 0; padding-left: 22pt; }
  li { break-inside: avoid; border-bottom: 1px solid var(--kp-print-list-rule); margin: 0 0 12pt; padding: 0 0 12pt 2pt; }
  h2 { font-size: 12pt; margin: 0 0 4pt; }
  .kind { color: var(--kp-tag-slate); font-size: 9pt; font-weight: 700; margin: 0 0 5pt; text-transform: uppercase; }
  dl { display: grid; grid-template-columns: 72pt 1fr; margin: 0; row-gap: 2pt; }
  dt { color: var(--kp-tag-slate); font-weight: 700; }
  dd { margin: 0; overflow-wrap: anywhere; }
  .empty { border: 1px solid var(--kp-print-heading-rule); border-radius: 6pt; color: var(--kp-tag-slate); padding: 14pt; }
`.trim();

/**
 * A popup starts with a fresh document, so copy the app theme's resolved print
 * colours into it before using the shared token names in PRINT_CSS.
 */
function createPrintCss(tokenSourceDocument: Document): string {
  const sourceWindow = tokenSourceDocument.defaultView;
  const sourceStyles = sourceWindow
    ? sourceWindow.getComputedStyle(tokenSourceDocument.documentElement)
    : null;
  const tokenDefinitions = PRINT_COLOR_TOKENS.flatMap((token) => {
    const value = sourceStyles?.getPropertyValue(token).trim();
    return value ? [`${token}: ${value};`] : [];
  }).join('');

  return `:root { ${tokenDefinitions} }\n${PRINT_CSS}`;
}

function isWorkflowWorkItem(
  item: PrintableItem
): item is PrintableTaskContext['workflowWorkItems'][number] {
  return 'instanceId' in item;
}

function statusLabel(item: PrintableItem, t: TFunction): string {
  switch (item.status) {
    case 'open':
      return t('taskListPrint.status.open');
    case 'in_progress':
      return t('taskListPrint.status.inProgress');
    case 'blocked':
      return t('taskListPrint.status.blocked');
    case 'done':
      return t('taskListPrint.status.done');
    case 'cancelled':
      return t('taskListPrint.status.cancelled');
  }
}

function assigneeLabel(item: PrintableItem, t: TFunction): string {
  return (
    item.assigneeLabel?.trim() ||
    item.assigneeUserId?.trim() ||
    t('taskListPrint.unassigned')
  );
}

function dueLabel(item: PrintableItem, t: TFunction): string {
  const suppliedDue = isWorkflowWorkItem(item)
    ? item.dueAt?.trim()
    : item.dueLabel?.trim() || item.dueAt?.trim();
  if (!suppliedDue) return t('taskListPrint.noDueDate');
  if (!isWorkflowWorkItem(item) && item.dueTime?.trim()) {
    return t('taskListPrint.dueAtTime', {
      due: suppliedDue,
      time: item.dueTime.trim(),
    });
  }
  return suppliedDue;
}

function appendTextElement(
  document: Document,
  parent: Node,
  tagName: string,
  text: string,
  className?: string
): HTMLElement {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  element.textContent = text;
  parent.appendChild(element);
  return element;
}

function appendFact(
  document: Document,
  list: HTMLDListElement,
  label: string,
  value: string
): void {
  appendTextElement(document, list, 'dt', label);
  appendTextElement(document, list, 'dd', value);
}

/**
 * Builds the print page with DOM nodes and textContent only. Supplied task data
 * is never parsed as markup and cannot become executable print-window content.
 */
export function populateTaskListPrintDocument(
  document: Document,
  context: PrintableTaskContext,
  t: TFunction,
  language: string,
  tokenSourceDocument: Document = document
): number {
  const items: readonly PrintableItem[] = [
    ...context.tasks,
    ...context.workflowWorkItems,
  ];

  document.head.replaceChildren();
  document.body.replaceChildren();
  document.documentElement.lang = language;

  const charset = document.createElement('meta');
  charset.setAttribute('charset', 'UTF-8');
  document.head.appendChild(charset);
  appendTextElement(
    document,
    document.head,
    'title',
    t('taskListPrint.documentTitle')
  );
  appendTextElement(
    document,
    document.head,
    'style',
    createPrintCss(tokenSourceDocument)
  );

  appendTextElement(document, document.body, 'h1', t('taskListPrint.heading'));
  appendTextElement(
    document,
    document.body,
    'p',
    t('taskListPrint.recordCount', { count: items.length }),
    'summary'
  );

  if (items.length === 0) {
    appendTextElement(
      document,
      document.body,
      'p',
      t('taskListPrint.empty'),
      'empty'
    );
    return 0;
  }

  const list = document.createElement('ol');
  document.body.appendChild(list);
  for (const item of items) {
    const row = document.createElement('li');
    list.appendChild(row);
    appendTextElement(document, row, 'h2', item.title);
    appendTextElement(
      document,
      row,
      'p',
      isWorkflowWorkItem(item)
        ? t('taskListPrint.kind.workflowStep')
        : t('taskListPrint.kind.task'),
      'kind'
    );
    const facts = document.createElement('dl');
    row.appendChild(facts);
    appendFact(
      document,
      facts,
      t('taskListPrint.label.status'),
      statusLabel(item, t)
    );
    appendFact(
      document,
      facts,
      t('taskListPrint.label.assignee'),
      assigneeLabel(item, t)
    );
    appendFact(
      document,
      facts,
      t('taskListPrint.label.due'),
      dueLabel(item, t)
    );
  }

  return items.length;
}

/** Opens and prints synchronously so window.open remains inside the user click. */
export function printSuppliedTaskList(
  context: PrintableTaskContext,
  t: TFunction,
  language: string,
  openWindow: () => Window | null = () =>
    window.open('about:blank', '_blank', PRINT_WINDOW_FEATURES)
): TaskListPrintResult {
  let printWindow: Window | null;
  try {
    printWindow = openWindow();
  } catch {
    return { ok: false, reason: 'popup-blocked' };
  }
  if (!printWindow) return { ok: false, reason: 'popup-blocked' };

  try {
    const recordCount = populateTaskListPrintDocument(
      printWindow.document,
      context,
      t,
      language,
      window.document
    );
    printWindow.focus();
    printWindow.print();
    return { ok: true, recordCount };
  } catch {
    try {
      printWindow.close();
    } catch {
      return { ok: false, reason: 'print-failed' };
    }
    return { ok: false, reason: 'print-failed' };
  }
}
