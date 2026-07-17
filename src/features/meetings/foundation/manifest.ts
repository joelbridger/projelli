export type MeetingFoundationDependentStatus = 'ready' | 'coordinator-blocked';

export interface MeetingFoundationDependentManifestEntry {
  readonly consumer: string;
  readonly fixture: string | null;
  readonly status: MeetingFoundationDependentStatus;
  readonly reason?: string;
}

/**
 * Complete Part A dispatch manifest. `ready` means the whole named seam can be
 * imported and used. A partial meeting-side type never makes a consumer ready.
 */
export const meetingFoundationDependentManifest: readonly MeetingFoundationDependentManifestEntry[] =
  [
    {
      consumer: 'meetings-core-records',
      fixture: 'meetingsShell.import.ts',
      status: 'ready',
    },
    {
      consumer: 'notice-evidence-read-model',
      fixture: 'noticeEvidence.import.ts',
      status: 'ready',
    },
    {
      consumer: 'ask-across-meetings',
      fixture: 'askAcrossMeetings.import.ts',
      status: 'ready',
    },
    {
      consumer: 'meetings-shell-v1',
      fixture:
        '../../../foundation-contracts/meetings-population/meetingsPopulation.import.ts',
      status: 'ready',
    },
    {
      consumer: 'meeting-spoken-notice',
      fixture: null,
      status: 'coordinator-blocked',
      reason:
        'COORDINATOR: the approved base has no real meeting header-action or notice-provider host; the local evidence record contract alone is not a launch seam.',
    },
    {
      consumer: 'meeting-diarization',
      fixture: null,
      status: 'coordinator-blocked',
      reason:
        'COORDINATOR: the approved base has no real artifact contribution host or stable processed-meeting panel host.',
    },
    {
      consumer: 'meeting-notice-evidence',
      fixture: null,
      status: 'coordinator-blocked',
      reason:
        'COORDINATOR: the read model is ready, but the required artifact contribution host and durable audit-writer contract are absent.',
    },
    {
      consumer: 'meeting-keywords',
      fixture: null,
      status: 'coordinator-blocked',
      reason:
        'COORDINATOR: the approved base lacks the real insight host and SettingsModuleDescriptor/settingsModuleRegistry owner contract.',
    },
    {
      consumer: 'meeting-talk-time',
      fixture: null,
      status: 'coordinator-blocked',
      reason:
        'COORDINATOR: the approved base lacks stable real insight/panel hosts; compatible diarization records alone are not a launch seam.',
    },
    {
      consumer: 'meeting-signals',
      fixture: null,
      status: 'coordinator-blocked',
      reason:
        'COORDINATOR: CRM clients does not export the required ContactRef household-section owner contract, and the real insight host is absent.',
    },
    {
      consumer: 'meeting-intelligence-settings',
      fixture: null,
      status: 'coordinator-blocked',
      reason:
        'COORDINATOR: the reactive store is ready, but Settings does not export the required SettingsModuleDescriptor/settingsModuleRegistry owner contract.',
    },
    {
      consumer: 'meeting-visibility-inheritance',
      fixture: null,
      status: 'coordinator-blocked',
      reason:
        'COORDINATOR: the policy record is ready, but the real header/Settings hosts and the P0-M/N enforcement contracts are absent.',
    },
    {
      consumer: 'my-meetings-filter',
      fixture: null,
      status: 'coordinator-blocked',
      reason:
        'COORDINATOR: the approved base has no real meeting-list-tool host or authoritative current-member identity seam.',
    },
    {
      consumer: 'crm-client-meetings-tab',
      fixture: null,
      status: 'coordinator-blocked',
      reason:
        'COORDINATOR: CRM clients does not export the required householdTabRegistry descriptor/context contract or exact ContactRef identity.',
    },
    {
      consumer: 'crm-client-meeting-prep-tab',
      fixture: null,
      status: 'coordinator-blocked',
      reason:
        'COORDINATOR: CRM clients does not export the required householdTabRegistry descriptor/context contract or exact ContactRef identity.',
    },
    {
      consumer: 'meeting-panel-registry',
      fixture: 'meetingComposition.import.ts',
      status: 'ready',
    },
    {
      consumer: 'meeting-header-action-registry',
      fixture: 'meetingComposition.import.ts',
      status: 'ready',
    },
    {
      consumer: 'meeting-insight-registry',
      fixture: 'meetingComposition.import.ts',
      status: 'ready',
    },
    {
      consumer: 'meeting-list-registry',
      fixture: null,
      status: 'coordinator-blocked',
      reason:
        'COORDINATOR: the Meetings list frame (Upcoming/Past/Actions/Templates/Automations) is owned by meetings-shell-v1, which is blocked — src/app/shell/registry exports no public appSurfaceRegistry/AppSurfaceRouter doorway at base. No empty registry was invented.',
    },
    {
      consumer: 'meeting-list-tool-registry',
      fixture: null,
      status: 'coordinator-blocked',
      reason:
        'COORDINATOR: the My Meetings list-tool bar is owned by meetings-shell-v1, blocked on the absent public appSurfaceRegistry doorway and an authoritative current-member identity seam. No empty registry was invented.',
    },
    {
      consumer: 'meeting-artifact-registry',
      fixture: null,
      status: 'coordinator-blocked',
      reason:
        'COORDINATOR: the processed-meeting panel slot that would host artifact contributions is owned by meetings-shell-v1 (blocked); the artifact writer and client-bound reader remain usable directly. No empty registry was invented.',
    },
    {
      consumer: 'notice-evidence-provider-registry',
      fixture: null,
      status: 'coordinator-blocked',
      reason:
        'COORDINATOR: the notice-evidence provider host lives in meetings-shell-v1 (blocked on the absent public appSurfaceRegistry doorway); the appendNoticeEvidence writer and NoticeEvidenceReadModel remain usable directly. No empty registry was invented.',
    },
  ];
