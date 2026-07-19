import { useState } from 'react';
import { Printer } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TaskActionContext } from '@/features/crm-tasks';
import { Button } from '@/ui/kp';
import { printSuppliedTaskList } from './printTaskList';

type PrintError = 'popup-blocked' | 'print-failed' | null;

export function TaskListPrintAction({
  tasks,
  workflowWorkItems,
}: TaskActionContext) {
  const { i18n, t } = useTranslation();
  const [error, setError] = useState<PrintError>(null);

  return (
    <div data-testid="crm-task-list-print">
      <Button
        data-testid="crm-task-list-print-button"
        iconLeft={Printer}
        onClick={() => {
          setError(null);
          const result = printSuppliedTaskList(
            { tasks, workflowWorkItems },
            t,
            i18n.resolvedLanguage ?? i18n.language
          );
          if (!result.ok) setError(result.reason);
        }}
        size="sm"
        variant="secondary"
      >
        {t('taskListPrint.action')}
      </Button>
      {error ? (
        <p data-testid="crm-task-list-print-error" role="alert">
          {error === 'popup-blocked'
            ? t('taskListPrint.error.popup-blocked')
            : t('taskListPrint.error.print-failed')}
        </p>
      ) : null}
    </div>
  );
}
