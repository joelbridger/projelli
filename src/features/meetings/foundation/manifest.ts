export type MeetingFoundationDependentStatus =
  | 'ready'
  | 'integrated-dark'
  | 'coordinator-blocked';

export interface MeetingFoundationDependentManifestEntry {
  readonly consumer: string;
  readonly fixture: string | null;
  readonly status: MeetingFoundationDependentStatus;
  readonly reason?: string;
}

/**
 * Complete Part A dispatch manifest. `ready` means the whole named seam can be
 * imported and used. `integrated-dark` means its real production doorway is
 * registered but remains unavailable behind its feature flag. A partial
 * meeting-side type never makes a consumer ready.
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
      fixture: null,
      status: 'integrated-dark',
      reason:
        'DARK-BUT-INTEGRATED: the real Meetings surface is registered lazily in appSurfaceRegistry and guarded by meetings-shell-v1. The flag remains off until acceptance; the surface is importable and wired, not coordinator-blocked.',
    },
    {
      consumer: 'meeting-spoken-notice',
      fixture: null,
      status: 'coordinator-blocked',
      reason:
        'COORDINATOR: the real meeting header-action host is integrated, but no production spoken-notice descriptor exists and the notice-provider host is deferred until its producer lands; the local evidence record contract alone is not a launch seam.',
    },
    {
      consumer: 'meeting-diarization',
      fixture: null,
      status: 'coordinator-blocked',
      reason:
        'COORDINATOR: the real processed-meeting panel host is integrated, but no production diarization panel descriptor exists and the artifact contribution host is deferred until its producer lands.',
    },
    {
      consumer: 'meeting-notice-evidence',
      fixture: null,
      status: 'coordinator-blocked',
      reason:
        'COORDINATOR: the shell and read model are integrated, but the artifact contribution host is deliberately deferred and the durable audit-writer contract is absent.',
    },
    {
      consumer: 'meeting-keywords',
      fixture: null,
      status: 'integrated-dark',
      reason:
        'DARK-BUT-INTEGRATED: the production insight is registered in MeetingEntry and its Settings descriptor is registered by Settings; meeting-keywords remains off pending acceptance.',
    },
    {
      consumer: 'meeting-talk-time',
      fixture: null,
      status: 'coordinator-blocked',
      reason:
        'COORDINATOR: the real insight and panel hosts are integrated, but no production talk-time descriptor is registered; compatible diarization records alone are not a launch seam.',
    },
    {
      consumer: 'meeting-signals',
      fixture: null,
      status: 'coordinator-blocked',
      reason:
        'COORDINATOR: the real insight host is integrated, but no production signal descriptor is registered and CRM clients still lacks the required ContactRef household-section owner contract.',
    },
    {
      consumer: 'meeting-intelligence-settings',
      fixture: null,
      status: 'integrated-dark',
      reason:
        'DARK-BUT-INTEGRATED: the reactive store and production Settings descriptor are registered through the real settingsModuleRegistry; settings-shell-v1 remains off pending acceptance.',
    },
    {
      consumer: 'meeting-visibility-inheritance',
      fixture: null,
      status: 'coordinator-blocked',
      reason:
        'COORDINATOR: the policy record plus real header and Settings hosts are integrated, but no production visibility descriptor is registered and the P0-M/N enforcement contracts are absent.',
    },
    {
      consumer: 'my-meetings-filter',
      fixture: null,
      status: 'integrated-dark',
      reason:
        'DARK-BUT-INTEGRATED: the real list-tool host renders the built-in My Meetings control from the authoritative firm-session member id inside the meetings-shell-v1 surface.',
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
      status: 'integrated-dark',
      reason:
        'DARK-BUT-INTEGRATED: the real Meetings list frame and registry are mounted by the lazily registered meetings-shell-v1 surface; the production flag remains off pending acceptance.',
    },
    {
      consumer: 'meeting-list-tool-registry',
      fixture: null,
      status: 'integrated-dark',
      reason:
        'DARK-BUT-INTEGRATED: the real list-tool bar is mounted by the lazily registered meetings-shell-v1 surface and reads current-member identity from the firm session; the production flag remains off pending acceptance.',
    },
    {
      consumer: 'meeting-artifact-registry',
      fixture: null,
      status: 'coordinator-blocked',
      reason:
        'COORDINATOR: the shell is integrated, but no production artifact descriptor producer exists. Its detail host is deliberately deferred instead of mounting an empty doorway backed only by a fixture; the artifact writer and client-bound reader remain usable directly.',
    },
    {
      consumer: 'notice-evidence-provider-registry',
      fixture: null,
      status: 'coordinator-blocked',
      reason:
        'COORDINATOR: the shell is integrated, but no production notice-evidence provider exists. Its detail host is deliberately deferred instead of mounting an empty doorway backed only by a fixture; appendNoticeEvidence and NoticeEvidenceReadModel remain usable directly.',
    },
  ];
