import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MoreHorizontal } from 'lucide-react';
import { useFlag } from '@/platform/flags';
import { Button, Card, Dropdown, IconButton } from '@/ui/kp';
import type { CrmPerson } from '@/features/crm-clients';
import type { HouseholdTabSurfaceProps } from '@/features/crm-clients/tabRegistry';

type MemberRailProps = Pick<
  HouseholdTabSurfaceProps,
  'household' | 'clientBoundary' | 'actions'
>;

function householdRef(
  household: MemberRailProps['household'],
  matterId: string | undefined
) {
  return {
    kind: 'household',
    id: household.id,
    ...(matterId ? { matterId } : {}),
    label: household.name,
  };
}

function memberRef(member: CrmPerson, matterId: string | undefined) {
  return {
    kind: 'person',
    id: member.id,
    ...(matterId ? { matterId } : {}),
    label: member.name,
  };
}

function primaryEmail(member: CrmPerson) {
  return (
    member.emails?.find((email) => email.primary)?.address ??
    member.emails?.[0]?.address
  );
}

/**
 * This outer guard deliberately owns only the feature flag. The enabled child
 * is the first place member state is read, so a dark flag has no member-data
 * read, selector, effect, or load side effect.
 */
export function MemberRailTab(props: MemberRailProps) {
  const enabled = useFlag('record-member-kebab');
  if (!enabled) return null;
  return <EnabledMemberRail {...props} />;
}

function EnabledMemberRail({ household, clientBoundary, actions }: MemberRailProps) {
  const { t } = useTranslation();
  const [openMemberId, setOpenMemberId] = useState<string | null>(null);
  const members = household.members;

  return (
    <aside data-testid="crm-household-member-rail">
      <Card variant="raised" style={{ display: 'grid', gap: 12 }}>
        <div>
          <h2 style={{ margin: 0 }}>{t('memberRail.title')}</h2>
          <p style={{ margin: '4px 0 0', color: 'var(--color-slate-500)' }}>
            {t('memberRail.helper', { count: members.length })}
          </p>
        </div>
        {members.length ? (
          <div style={{ display: 'grid' }}>
            {members.map((member) => {
              const email = primaryEmail(member);
              const isOpen = openMemberId === member.id;
              return (
                <div
                  key={member.id}
                  data-testid={`crm-household-member-${member.id}`}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'minmax(0, 1fr) auto',
                    gap: 8,
                    alignItems: 'start',
                    padding: '10px 0',
                    borderBottom: '1px solid var(--kp-border)',
                  }}
                >
                  <div>
                    <strong>{member.name}</strong>
                    <div
                      style={{
                        color: 'var(--color-slate-600)',
                        fontSize: 13,
                        marginTop: 2,
                      }}
                    >
                      {member.householdRole ?? t('memberRail.member')}
                      {email ? ` · ${email}` : ''}
                    </div>
                  </div>
                  <div style={{ position: 'relative' }}>
                    <IconButton
                      icon={MoreHorizontal}
                      label={t('memberRail.options', { name: member.name })}
                      data-testid={`crm-household-member-kebab-${member.id}`}
                      onClick={() => {
                        setOpenMemberId((current) =>
                          current === member.id ? null : member.id
                        );
                      }}
                    />
                    {isOpen ? (
                      <Dropdown
                        data-testid={`crm-household-member-menu-${member.id}`}
                        style={{
                          position: 'absolute',
                          right: 0,
                          top: 'calc(100% + 4px)',
                          zIndex: 1,
                          minWidth: 190,
                          padding: 8,
                        }}
                      >
                        <div style={{ display: 'grid', gap: 6 }}>
                          <Button
                            size="sm"
                            variant="secondary"
                            data-testid={`crm-household-member-review-${member.id}`}
                            onClick={() => {
                              actions?.onReviewRecipient?.(member.id);
                              setOpenMemberId(null);
                            }}
                          >
                            {t('memberRail.actions.review')}
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            data-testid={`crm-household-member-email-${member.id}`}
                            onClick={() => {
                              const matterId = clientBoundary?.matterId;
                              const householdContext = householdRef(household, matterId);
                              actions?.onDraftEmail?.({
                                kind: 'open_mail_surface',
                                householdRef: householdContext,
                                contextRefs: [
                                  householdContext,
                                  memberRef(member, matterId),
                                ],
                                source: 'crm_household',
                              });
                              setOpenMemberId(null);
                            }}
                          >
                            {t('memberRail.actions.email')}
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            data-testid={`crm-household-member-task-${member.id}`}
                            onClick={() => {
                              const matterId = clientBoundary?.matterId;
                              const householdContext = householdRef(household, matterId);
                              actions?.onAdd?.({
                                kind: 'task',
                                householdRef: householdContext,
                                contextRefs: [
                                  householdContext,
                                  memberRef(member, matterId),
                                ],
                              });
                              setOpenMemberId(null);
                            }}
                          >
                            {t('memberRail.actions.task')}
                          </Button>
                        </div>
                      </Dropdown>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p data-testid="crm-household-member-rail-empty" style={{ margin: 0 }}>
            {t('memberRail.empty')}
          </p>
        )}
      </Card>
    </aside>
  );
}
