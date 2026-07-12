/* eslint-disable lantern-i18n/no-hardcoded-string -- Frozen CRM screen copy needs its translation catalog in a separate product change. */
import { useState } from 'react';
import { ClipboardList, LayoutDashboard } from 'lucide-react';
import { Button } from '@/ui/kp';
import { buildCapacityTriage, dailyWorkReason } from '@/platform/crm/tasks';
import { AskBar, FreshnessBanner, Screen, mutedStyle, panelStyle } from '@/features/crm-home/shared/ui';
import type { CrmHomeRoute } from '@/features/crm-home/routes';
import type { CrmActivity, CrmApproval, CrmFirmMember, CrmFreshnessState, CrmTask } from '@/features/crm-home/types';
import { useCrmHomeSurfaceContext } from '@/features/crm-home/surfaceContext';
import { dailyWorkItems, workHousehold, workLabel, type CrmDailyWorkItem } from '@/features/crm-home/shared/workItems';

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}
export function Today({
  workItems,
  firmMembers,
  approvals,
  activity,
  freshness,
  onNavigate,
  onCompleteWorkItem,
  onDecideApproval,
}: {
  workItems: readonly CrmDailyWorkItem[];
  firmMembers: readonly CrmFirmMember[];
  approvals: readonly CrmApproval[];
  activity: readonly CrmActivity[];
  freshness: CrmFreshnessState;
  onNavigate: (r: CrmHomeRoute) => void;
  onCompleteWorkItem: (item: CrmDailyWorkItem) => void | Promise<void>;
  onDecideApproval: (
    approval: CrmApproval,
    decision: 'approved' | 'rejected'
  ) => void | Promise<void>;
}) {
  const [reviewing, setReviewing] = useState(false);
  const today = todayKey();
  const plan = buildCapacityTriage(
    workItems,
    firmMembers.map((member) => member.userId),
    today
  );
  const open = plan.ranked;
  // Capacity is intentionally derived for this render from the saved active
  // firm directory and open work. It is not a CRM record and is never synced.
  const todayPlan = plan.hasCapacitySignal ? plan.fitsToday : open;
  const suggestedLater = plan.hasCapacitySignal ? plan.suggestedLater : [];
  const pendingApprovals = approvals.filter(
    (approval) => approval.state === 'pending'
  );
  const recentActivity = [...activity]
    .sort((left, right) => right.at.localeCompare(left.at))
    .slice(0, 6);
  return (
    <Screen
      title="Today"
      description="Your morning plan"
      Icon={LayoutDashboard}
      action={
        <Button
          data-testid="crm-today-review"
          iconLeft={ClipboardList}
          onClick={() => {
            setReviewing(true);
          }}
        >
          Review today’s plan
        </Button>
      }
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <AskBar />
        <FreshnessBanner freshness={freshness} />
      </div>
      {open.length === 0 ? (
        <section data-testid="crm-today-first-use" style={panelStyle}>
          <strong>Your firm is ready to set up Today.</strong>
          <p style={mutedStyle}>
            Add tasks or finish your import, and the work that needs attention
            first will appear here.
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button
              data-testid="crm-today-new-task"
              onClick={() => {
                onNavigate('tasks');
              }}
            >
              New task
            </Button>
            <Button
              variant="secondary"
              data-testid="crm-today-open-migration"
              onClick={() => {
                onNavigate('migration');
              }}
            >
              Open migration
            </Button>
          </div>
        </section>
      ) : (
        <section data-testid="crm-today-triage" style={panelStyle}>
          <strong>What needs attention first</strong>
          <p style={mutedStyle}>
            Ordered from your saved tasks and workflow steps. Each item explains
            why it is here.
          </p>
          <div
            data-testid="crm-today-capacity"
            style={{
              margin: '12px 0',
              padding: 10,
              borderRadius: 8,
              background: 'var(--kp-surface-muted)',
            }}
          >
            {plan.hasCapacitySignal ? (
              <>
                <strong data-testid="crm-today-capacity-fit-count">
                  {String(todayPlan.length)} of {String(open.length)} open{' '}
                  {open.length === 1 ? 'item fits' : 'items fit'} today.
                </strong>
                <span style={mutedStyle}>
                  {' '}
                  {suggestedLater.length === 0
                    ? 'Everything open is in today’s plan.'
                    : `${String(suggestedLater.length)} ${suggestedLater.length === 1 ? 'item can' : 'items can'} wait without changing the order.`}
                </span>
              </>
            ) : (
              <span data-testid="crm-today-capacity-missing" style={mutedStyle}>
                Add active team members in Firm setup to see what fits today.
                Until then, this is your full ordered list.
              </span>
            )}
          </div>
          <div data-testid="crm-today-plan">
          {todayPlan.map((item) => (
            <div
              key={item.id}
              data-testid={`crm-today-task-${item.id}`}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 8,
                padding: '10px 0',
                borderTop: '1px solid var(--kp-border)',
              }}
            >
              <span>
                <strong>{item.title}</strong>
                <span style={mutedStyle}>
                  {' '}
                  · {dailyWorkReason(item, today)} · {workLabel(item)}
                  {workHousehold(item) ? ` · ${workHousehold(item)}` : ''}
                </span>
              </span>
              <Button
                size="sm"
                variant="secondary"
                data-testid={`crm-today-complete-${item.id}`}
                onClick={() => {
                  void onCompleteWorkItem(item);
                }}
              >
                Complete
              </Button>
            </div>
          ))}
          </div>
          {suggestedLater.length > 0 && (
            <div data-testid="crm-today-suggested-later" style={{ marginTop: 12 }}>
              <strong>Suggested for later</strong>
              <p style={mutedStyle}>
                These stay saved and open. Today does not move work by itself.
              </p>
              {suggestedLater.map((item) => (
                <div
                  key={item.id}
                  data-testid={`crm-today-later-${item.id}`}
                  style={{
                    padding: '8px 0',
                    borderTop: '1px solid var(--kp-border)',
                  }}
                >
                  <strong>{item.title}</strong>
                  <span style={mutedStyle}>
                    {' '}
                    · {dailyWorkReason(item, today)} · {workLabel(item)}
                    {workHousehold(item) ? ` · ${workHousehold(item)}` : ''}
                  </span>
                </div>
              ))}
            </div>
          )}
          <Button
            variant="secondary"
            data-testid="crm-today-review-inline"
            onClick={() => {
              setReviewing(true);
            }}
          >
            Review this order
          </Button>
        </section>
      )}
      {reviewing && (
        <section
          data-testid="crm-today-review-panel"
          style={{ ...panelStyle, borderColor: 'var(--kp-assured)' }}
        >
          <strong>How Today is ordered</strong>
          <p style={mutedStyle}>
            Work with a date comes first, with overdue work first. Then Lantern
            puts blocked work and high-priority work ahead of other open items.
            It only uses saved CRM records and never moves work by itself.
          </p>
          {open.length === 0 ? (
            <p style={mutedStyle}>
              Add a task or finish your import to start a plan.
            </p>
          ) : (
            todayPlan.map((item) => (
              <div
                key={item.id}
                style={{
                  display: 'flex',
                  gap: 8,
                  justifyContent: 'space-between',
                  padding: '8px 0',
                  borderTop: '1px solid var(--kp-border)',
                }}
              >
                <span>
                  {item.title}
                  <span style={mutedStyle}>
                    {' '}
                    · {dailyWorkReason(item, today)}
                  </span>
                </span>
              </div>
            ))
          )}
        </section>
      )}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 12,
        }}
      >
        <section data-testid="crm-approval-queue" style={panelStyle}>
          <strong>Waiting for you</strong>
          <p style={mutedStyle}>
            {pendingApprovals.length === 0
              ? 'No approvals are waiting.'
              : `${String(pendingApprovals.length)} approval${pendingApprovals.length === 1 ? '' : 's'} waiting.`}
          </p>
          {pendingApprovals.map((approval) => (
            <div
              key={approval.id}
              data-testid={`crm-approval-${approval.id}`}
              style={{
                borderTop: '1px solid var(--kp-border)',
                paddingTop: 8,
                marginTop: 8,
              }}
            >
              <strong>{approval.title}</strong>
              {approval.householdLabel && (
                <span style={mutedStyle}> · {approval.householdLabel}</span>
              )}
              <p style={mutedStyle}>
                {approval.rationale ?? 'Review this proposed change.'}
              </p>
              <Button
                size="sm"
                data-testid={`crm-approval-approve-${approval.id}`}
                onClick={() => {
                  void onDecideApproval(approval, 'approved');
                }}
              >
                Approve
              </Button>
              <Button
                size="sm"
                variant="secondary"
                data-testid={`crm-approval-dismiss-${approval.id}`}
                style={{ marginLeft: 8 }}
                onClick={() => {
                  void onDecideApproval(approval, 'rejected');
                }}
              >
                Dismiss
              </Button>
            </div>
          ))}
          {approvals.some((approval) => approval.state !== 'pending') && (
            <p data-testid="crm-approval-history" style={mutedStyle}>
              Decided proposals stay in history and can be reviewed later.
            </p>
          )}
          <Button
            variant="secondary"
            size="sm"
            data-testid="crm-today-open-propagation"
            onClick={() => {
              onNavigate('propagation');
            }}
          >
            Review workflow updates
          </Button>
        </section>
        <section data-testid="crm-recent-activity" style={panelStyle}>
          <strong>Recent firm activity</strong>
          {recentActivity.length === 0 ? (
            <p style={mutedStyle}>No recorded activity yet.</p>
          ) : (
            recentActivity.map((event) => (
              <p
                key={event.id}
                data-testid={`crm-activity-${event.id}`}
                style={mutedStyle}
              >
                {event.summary} · {new Date(event.at).toLocaleString()}
              </p>
            ))
          )}
        </section>
      </div>
    </Screen>
  );
}

export function TodaySurface() {
  const { adapter, navigate } = useCrmHomeSurfaceContext();
  const workflowWorkItems = adapter.workflowWorkItems ?? [];
  const updateTask = async (task: CrmTask) => { await adapter.actions.updateTask?.(task); };
  return <Today
    workItems={dailyWorkItems(adapter.tasks, workflowWorkItems)}
    firmMembers={adapter.firmMembers ?? []}
    approvals={adapter.approvals ?? []}
    activity={adapter.activity ?? []}
    freshness={adapter.freshness}
    onNavigate={navigate}
    onCompleteWorkItem={async (item) => {
      if (item.kind === 'workflow_step') await adapter.actions.completeWorkflowWorkItem?.(item);
      else await updateTask({ ...item, status: 'done' });
    }}
    onDecideApproval={(approval, decision) => adapter.actions.decideApproval?.(approval, decision)}
  />;
}
