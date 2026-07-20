/**
 * MatterHub — per-matter command-center hub.
 *
 * Full-page workspace for a single client: a header with back navigation, a row
 * of sub-tabs (Overview · Documents · Email · Meetings), and the
 * matching panel below. Overview leads with the Client Map (the hero) and a
 * compact Ask box; Documents / Email render THIS client's scoped
 * surfaces in place, so opening a file or reading mail never leaves the client
 * (no orphaned global destinations). History opens the scoped activity feed in
 * a slide-over panel. Those surfaces are passed in as render props from
 * the shell, which owns their handler wiring. Meetings (Wave 3c) is
 * self-contained (ClientMeetingsTab/MeetingEntry read the workspace/matter
 * stores directly), so it's rendered inline rather than via a render prop.
 *
 * Light theme only. Inline styles + CSS vars.
 */

import { useState, useEffect, useCallback, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ClipboardList, Lock, FileText, Mail, Clock, Loader2, Map, Mic, MoreVertical } from 'lucide-react';
import {
  ClientMeetingsTab,
  readActiveMeetingClientBoundary,
  useActiveMeetingClientBoundary,
} from '@/features/meetings';
import { ClientRequestsTab } from '@/features/intake/ClientRequestsTab';
import { isTauri } from '@tauri-apps/api/core';
import { useMatters, useActiveMatterPrivileged, useMatterStore, SAMPLE_MATTER_ID, type ClientMapHubTab } from '@/platform/matter/matterStore';
import { useIntakeStore } from '@/platform/intake/intakeStore';
import { IntakeRelayClient } from '@/platform/intake/IntakeRelayClient';
import { loadIntakeLinkSecret, updateIntakeLinkSecret } from '@/platform/intake/intakeKeychain';
import { deriveAuthToken } from '@/platform/intake/intakeCrypto';
import { regenerateIntakeLink } from '@/platform/intake/intakeLifecycle';
import { createAdvisorIntake } from '@/platform/intake/createIntake';
import { configuredIntakeHost } from '@/platform/intake/advisorIntakeLink';
import type { FormRequest } from '@/platform/intake/types';
import { b64ToBytes } from '@/platform/intake/pageSeal';
import { useFirmStore } from '@/platform/firm/firmStore';
import { createDocusignAuthorizationProvider } from '@/platform/docusignSigning/capabilityClient';
import { registerDocusignEnvelope } from '@/platform/docusignSigning/envelopeRegistration';
import { DirectDocusignAdapter } from '@/platform/docusignSigning/docusignAdapter';
import { DocusignLaunchRelayClient } from '@/platform/docusignSigning/launchRelayClient';
import { startDocusignSignature } from '@/platform/docusignSigning/signatureWorkflow';
import type { PdfCompletionReceipt } from '@/platform/intake/pdfTemplates/templateContract';
import { BRAND } from '@/config/brand';
import { FirmApiClient } from '@/platform/firm/FirmApiClient';
import { publishIntakeKeyToMembers } from '@/platform/intake/intakeKeyShare';
import { createAuditPairId, mustLogAuditPhase } from '@/platform/audit/durableAudit';
import { matterLabel } from '@/platform/rag/matterResolver';
import { useEntityLabel } from '@/platform/hooks/useEntityLabel';
import { Badge, IconButton, QuietStatus, SlidePanel } from '@/ui/kp';
import SurfaceHeader from '@/ui/SurfaceHeader';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu';
import { useClientMap, type ClientMapSyncResult } from '@/features/matters/useClientMap';
import { usePromptDialog } from '@/platform/hooks/usePromptDialog';
import { PromptDialog } from '@/ui/PromptDialog';
import { ClientMapPanel } from '@/features/matters/ClientMapPanel';
import { BeforeYouMeetStrip } from '@/features/meetings/BeforeYouMeetStrip';
import { CrmWriteReviewCard } from '@/features/matters/CrmWriteReviewCard';
import { CrmWritePendingBanner } from '@/features/matters/CrmWritePendingBanner';
import { VoiceprintsCard } from '@/features/matters/VoiceprintsCard';
import { DEFAULT_WELCOME_JOURNEY } from '@/platform/intake/welcomeJourneyDefaults';
import { NEW_HOUSEHOLD_NEXT_STEPS } from '@/features/intake/newHouseholdTemplate';
import { firmMatterIdForIntakeSharing } from './logic/intakeFirmMatter';
import { useClientMapStore } from '@/platform/clientMap/clientMapStore';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';
import { useCrmStore } from '@/platform/connectors/crm/crmStore';
import { answerQuestion, flagForClient } from '@/features/matters/clientMap/guidedInterview';
import { dispatchOpenSource } from '@/features/matters/clientMap/openSource';
import {
  clientMapToDocxBytes,
  exportClientMapPdf,
  suggestClientMapExportName,
} from '@/features/matters/clientMap/exportClientMap';
import { saveFile } from '@/platform/utils/saveFile';
import type { SourceRef } from '@/platform/clientMap/types';
import type { AuditEntry } from '@/platform/types/audit';
import type { Matter } from '@/platform/types/matter';
import type { WorkspaceService } from '@/platform/fs/WorkspaceService';
import { useSelectionPresentation } from '@/platform/client-context';

// ── Props ──────────────────────────────────────────────────────────────────

export interface MatterHubProps {
  matterId: string;
  onBack: () => void;
  onAuditLog?: (entry: Omit<AuditEntry, 'id' | 'timestamp'>) => void;
  /**
   * The scoped per-client surfaces, supplied by the shell (which owns their
   * many handlers). Each is rendered only when its sub-tab is active, so the
   * heavy surface (and its effects) mounts on demand, not on every hub open.
   * Absent (e.g. in isolated component tests) → the sub-tab shows a placeholder.
   *
   * `renderDocuments` is handed THIS hub's exact `matter` (the one resolved from
   * `matterId` below), so the scoped Documents surface reads its `folderPaths` /
   * id from the client actually being rendered — never from a stale outer
   * "active matter" closure in the shell (2026-07-01 re-fix: a stale/mismatched
   * matter was one way a wrong/empty `scopeFolderPaths` reached the scoped tab).
   */
  renderDocuments?: (matter: Matter | null) => ReactNode;
  renderEmail?: () => ReactNode;
  renderActivity?: (options?: { clientMapSectionKey?: string; clientMapSectionTitle?: string }) => ReactNode;
  /**
   * The active WorkspaceService (or null before a workspace is open), passed
   * down from the shell for the self-contained Meetings sub-tab
   * (ClientMeetingsTab/MeetingEntry) — features must not reach for the
   * app-layer singleton themselves, per ARCHITECTURE.md's DAG, so this is
   * threaded as a plain prop rather than imported.
   */
  workspaceService?: WorkspaceService | null;
}

// ── Sub-tabs ───────────────────────────────────────────────────────────────

type HubTab = ClientMapHubTab;

const HUB_TABS: { id: HubTab; Icon: typeof FileText }[] = [
  { id: 'overview', Icon: Map },
  { id: 'onboarding', Icon: ClipboardList },
  { id: 'documents', Icon: FileText },
  { id: 'email', Icon: Mail },
  { id: 'meetings', Icon: Mic },
];

/** Label for a hub sub-tab (literal keys per branch — the i18n extractor
 *  can't trace a key stored in a config-array variable). */
function hubTabLabel(id: HubTab, t: (key: string) => string): string {
  switch (id) {
    case 'overview':
      return t('spine.nav.client-map');
    case 'onboarding':
      return 'Requests';
    case 'documents':
      return t('matter.hub.tab-documents');
    case 'email':
      return t('matter.hub.tab-email');
    case 'meetings':
      return t('matter.hub.tab-meetings');
    case 'activity':
      return t('matter.hub.tab-activity');
  }
}

function formatClientMapUpdated(
  timestamp: string | undefined,
  labels: {
    notUpdatedYet: string;
    updatedRecently: string;
    updatedAt: (date: string) => string;
  },
): string {
  if (!timestamp) return labels.notUpdatedYet;
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) return labels.updatedRecently;
  return labels.updatedAt(d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }));
}

function addDaysIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

const INTAKE_LINK_SECRET_SAVE_ATTEMPTS = 3;

async function saveIntakeLinkSecretWithRetry(intakeId: string, linkSecretB64: string): Promise<boolean> {
  let saveFailures = 0;
  for (let attempt = 0; attempt < INTAKE_LINK_SECRET_SAVE_ATTEMPTS; attempt += 1) {
    try {
      await updateIntakeLinkSecret(intakeId, linkSecretB64);
      return true;
    } catch {
      saveFailures += 1;
    }
  }
  return saveFailures < INTAKE_LINK_SECRET_SAVE_ATTEMPTS;
}

// ── MatterHub ──────────────────────────────────────────────────────────────

export function MatterHub({ matterId, onBack, onAuditLog, renderDocuments, renderEmail, renderActivity, workspaceService }: MatterHubProps) {
  const { t } = useTranslation();
  const selection = useSelectionPresentation();
  const activeMeetingClientBoundary = useActiveMeetingClientBoundary();
  // ── Client Map wiring ────────────────────────────────────────────────────
  // Declare client map hook at component top — must not be inside a condition.
  // autoBuild: a client's Client Map builds automatically the first time the
  // matter is opened (no manual "Open Client Map" step), so connector-created
  // clients a Wealthbox sync added show a populated, cited map — mirroring the
  // at-a-glance auto-run. The sample matter is excluded (its content is canned).
  const clientMap = useClientMap(matterId, {
    ...(onAuditLog ? { onAuditLog } : {}),
    autoBuild: matterId !== SAMPLE_MATTER_ID,
  });
  const { checkForUpdates, generate } = clientMap;
  const workspaceRoot = useWorkspaceStore((s) => s.rootPath);
  const matters = useMatters();
  const matter = matters.find((m) => m.id === matterId) ?? null;
  const updateIntake = useIntakeStore((s) => s.updateIntake);
  const seatToken = useFirmStore((s) => s.seatToken);
  const accessToken = useFirmStore((s) => s.accessToken);
  const advisorId = useFirmStore((s) => s.session?.userId ?? 'advisor');
  const firmSession = useFirmStore((s) => s.session);
  const visibleHubTabs = HUB_TABS;
  const isPrivileged = useActiveMatterPrivileged();
  const entityLabel = useEntityLabel();
  // The per-tab AI-status pill (same as Ask / Workflows) — the single, deduped
  // egress indicator now lives once per surface header, not in the top bar.
  // ── Active sub-tab ─────────────────────────────────────────────────────────
  // Overview (the Client Map) is the default. A client-list quick-action can
  // request a specific sub-tab (the Documents/Email row shortcuts) via the
  // store's one-shot `clientMapHubTab`, so those land on THIS client's scoped
  // sub-tab instead of a global surface.
  const pendingHubTab = useMatterStore((s) => s.clientMapHubTab);
  const setPendingHubTab = useMatterStore((s) => s.setClientMapHubTab);
  const pendingRequestId = useMatterStore((s) => s.clientMapHubRequestId);
  const setPendingRequestId = useMatterStore((s) => s.setClientMapHubRequestId);
  // The initializer above seeds the sub-tab from any pending request on mount.
  // Resetting to Overview when the CLIENT changes is handled by the per-matter
  // key on MatterHub (MattersHome keys it by matterId, so a client switch
  // remounts this whole component fresh) — no reset effect needed here, which
  // also keeps the hub free of cross-client state reuse (matter isolation).
  const [subTab, setSubTab] = useState<HubTab>(() => pendingHubTab === 'activity' ? 'overview' : pendingHubTab ?? 'overview');
  const [isHistoryOpen, setIsHistoryOpen] = useState(() => pendingHubTab === 'activity');
  const [isSyncingClientMap, setIsSyncingClientMap] = useState(false);
  const [exportingClientMap, setExportingClientMap] = useState<'word' | 'pdf' | null>(null);
  const [clientMapSyncResult, setClientMapSyncResult] = useState<ClientMapSyncResult | null>(null);
  const [historySectionFilter, setHistorySectionFilter] = useState<{ key: string; title: string } | null>(null);
  // Direct opens from Client Map/Activity still land inside the Meetings rail.
  // MatterHub only passes the requested meeting down; ClientMeetingsTab owns the
  // master-detail selection so the rail never disappears.
  const [initialSelectedMeeting, setInitialSelectedMeeting] = useState<{ dir: string; folderName: string; startMs?: number } | null>(null);

  const handleSendForSignature = useCallback(async ({ intake, signatureItemId, signerName, signerEmail }: { intake: import('@/platform/intake/intakeStore').IntakeRecord; signatureItemId: string; signerName: string; signerEmail: string }) => {
    if (!workspaceService || !seatToken || !matter?.folderPaths[0] || !intake.requestSlug || !intake.requestItems) throw new Error('A workspace, an active Firm seat, and this request’s local files are required before sending for signature.');
    const signature = intake.requestItems.find((item) => item.item_id === signatureItemId);
    if (!signature || signature.t !== 'signature' || signature.grade !== 'docusign') throw new Error('This request has no reviewed DocuSign signature item.');
    const source = intake.items.find((item) => item.itemId === signature.source_pdf_fill_item_id);
    const completion = source?.pdfCompletion;
    if (!source?.filePath || !completion || !completion.completedAt || !completion.pageVersion) throw new Error('The completed source form and its protected receipt are required before sending.');
    const receipt: PdfCompletionReceipt = { issuedItemId: signature.source_pdf_fill_item_id, templateId: completion.templateId, templateVersion: completion.templateVersion, sourceSha256: completion.sourceSha256, completedSha256: completion.completedSha256, completedAt: completion.completedAt, pageVersion: completion.pageVersion };
    const provider = createDocusignAuthorizationProvider({ intakeId: intake.intakeId, seatToken, accessToken, templateId: completion.templateId });
    const adapter = new DirectDocusignAdapter(provider);
    const relayOptions = { seatToken, ...(accessToken ? { accessToken } : {}) };
    await startDocusignSignature({
      intakeId: intake.intakeId,
      sourceFilePath: source.filePath,
      receipt,
      workspaceService,
      request: { request_id: intake.intakeId, schema_version: 1, matter_id: intake.matterId, kind: intake.kind ?? 'onboarding', items: intake.requestItems },
      signatureItemId,
      requestActive: intake.status === 'active',
      matterFolderPath: matter.folderPaths[0],
      requestSlug: intake.requestSlug,
      signerName,
      signerEmail,
      returnUrl: `${window.location.origin}/docusign-signing-return`,
      adapter,
      launchRelay: new DocusignLaunchRelayClient(relayOptions),
      registerEnvelope: (envelopeId) => registerDocusignEnvelope({ intakeId: intake.intakeId, envelopeId, ...relayOptions }),
    });
  }, [accessToken, matter?.folderPaths, seatToken, workspaceService]);

  // Honor + consume a pending sub-tab request. Reactive on `pendingHubTab` so it
  // handles a quick-action targeting the SAME already-open client (no remount).
  // The setState is deferred out of the effect body (queueMicrotask — the
  // codebase pattern) to avoid cascading-render warnings.
  useEffect(() => {
    if (pendingHubTab) {
      const requested = pendingHubTab;
      queueMicrotask(() => {
        if (requested === 'activity') {
          setIsHistoryOpen(true);
        } else {
          setSubTab(requested);
          if (requested !== 'meetings') setInitialSelectedMeeting(null);
        }
        setPendingHubTab(null);
      });
    }
  }, [pendingHubTab, setPendingHubTab]);

  // Honor a `meeting:<dir>#<ms>` Client Map source click or Activity entry
  // click (Task 11's ref-resolution): land on the Meetings sub-tab with that
  // exact meeting open and seeked, same one-shot pattern as pendingHubTab.
  const pendingMeetingOpen = useMatterStore((s) => s.pendingMeetingOpen);
  const setPendingMeetingOpen = useMatterStore((s) => s.setPendingMeetingOpen);
  useEffect(() => {
    if (pendingMeetingOpen) {
      const req = pendingMeetingOpen;
      queueMicrotask(() => {
        setSubTab('meetings');
        setInitialSelectedMeeting({
          dir: req.meetingDir,
          folderName: req.meetingDir.split('/').pop() ?? req.meetingDir,
          startMs: req.startMs,
        });
        setPendingMeetingOpen(null);
      });
    }
  }, [pendingMeetingOpen, setPendingMeetingOpen]);

  // Once a map exists, re-check for new source material. Covers BOTH a populated
  // map ('ready') AND one that was built empty ('empty') — the latter recovers a
  // map built before its content was indexed (e.g. a client opened before its
  // Wealthbox household synced): when the source fingerprint later changes,
  // checkForUpdates rebuilds and lets safe sourced facts auto-apply to the map.
  // checkForUpdates no-ops when the fingerprint is unchanged, so an empty
  // matter with still no content costs nothing.
  //
  // Guard: the update check calls the desktop-only RAG engine (computeSource-
  // Fingerprint / buildClientMap), which throws outside Tauri. In a plain
  // browser (the web demo + seeded testMode previews) that error would flip a
  // freshly-seeded, cleanly-rendered map to the error state right after first
  // paint — so we skip the check entirely when not in the desktop app.
  useEffect(() => {
    if (!isTauri()) return;
    if (clientMap.status === 'ready' || clientMap.status === 'empty') {
      void checkForUpdates();
    }
  }, [clientMap.status, checkForUpdates]);

  // Live recovery: when a Wealthbox sync FINISHES while this client is already
  // open, re-check for the freshly-indexed CRM source material so an empty/stale
  // Client Map populates in place rather than only on the next reopen.
  // checkForUpdates() no-ops when the source fingerprint is unchanged, so firing
  // on every completion is safe. The effect re-runs only when the sync status
  // transitions (e.g. syncing -> done), so it fires once per completed sync.
  // Same not-in-Tauri guard as above (the sync + engine are desktop-only).
  const crmSyncStatus = useCrmStore((s) => s.progress?.status);
  useEffect(() => {
    if (!isTauri()) return;
    if (crmSyncStatus === 'done') {
      void checkForUpdates();
    }
  }, [crmSyncStatus, checkForUpdates]);

  // In-app prompt dialog (WebView2-safe: native window.prompt is dead in the
  // Tauri Windows build, so Client Map edits/answers go through the in-DOM
  // dialog instead).
  const { prompt, dialogProps: promptDialogProps } = usePromptDialog();

  // Open the EXACT cited source (the specific document, scrolled to the cited
  // spot, or the specific email), not just the general Documents/Email surface.
  const handleOpenSource = useCallback((ref: SourceRef) => {
    dispatchOpenSource(matterId, ref);
  }, [matterId]);

  const makeIntakeRelay = useCallback(() => {
    if (!seatToken) throw new Error('Sign in and activate this machine before changing an onboarding link.');
    return new IntakeRelayClient({ seatToken, accessToken });
  }, [accessToken, seatToken]);

  const handleExtendIntake = useCallback(async (intakeId: string) => {
    const expiresAt = addDaysIso(30);
    await makeIntakeRelay().extendIntake(intakeId, expiresAt);
    updateIntake(intakeId, { expiresAt, status: 'active' });
  }, [makeIntakeRelay, updateIntake]);

  const handleRevokeIntake = useCallback(async (intakeId: string) => {
    await makeIntakeRelay().revokeIntake(intakeId);
    updateIntake(intakeId, { status: 'revoked' });
  }, [makeIntakeRelay, updateIntake]);

  const handleIssueRequest = useCallback(async (request: FormRequest) => {
    if (!matter) throw new Error('This client is no longer available.');
    const firmName = firmSession?.org?.name ?? BRAND.name;
    const clientFirstName = (matter.name || matter.client || 'Client').trim().split(/\s+/u)[0] || 'Client';
    const firmMatterId = firmMatterIdForIntakeSharing(matter);
    await createAdvisorIntake({
      intakeId: request.request_id,
      matterId,
      intakeHost: configuredIntakeHost(),
      expiresAt: addDaysIso(30),
      checklist: request,
      ...(request.blueprint_ref ? {} : { requestTitle: 'Client request' }),
      clientFirstName,
      firm: {
        name: firmName,
        accent: BRAND.colors.accent,
        advisor_name: (firmSession?.email ?? '').split('@')[0] || 'Your advisor',
        advisor_email: firmSession?.email ?? BRAND.urls.supportEmail,
        next_steps: [...NEW_HOUSEHOLD_NEXT_STEPS],
        journey: DEFAULT_WELCOME_JOURNEY,
      },
      relay: makeIntakeRelay(),
      ...(firmSession?.tier === 'practice' && firmSession.activated && firmMatterId
        ? { publishTeamKey: async (intakeId: string) => {
            await publishIntakeKeyToMembers(new FirmApiClient(useFirmStore.getState().tokenSource()), intakeId, firmMatterId, 1, { firmEntitled: true });
          } }
        : {}),
    });
  }, [firmSession, makeIntakeRelay, matter, matterId]);

  const handleRegenerateIntake = useCallback(async (intakeId: string) => {
    const current = useIntakeStore.getState().intakesById[intakeId];
    if (!current?.publicKeyRawB64 || !current.checklistCiphertextB64 || !current.stateCiphertextB64) {
      throw new Error('This link is missing its saved encrypted checklist.');
    }
    const oldSecretB64 = await loadIntakeLinkSecret(intakeId);
    if (!oldSecretB64) throw new Error('This link is missing its saved secret.');
    const regenerated = await regenerateIntakeLink({
      intakeId,
      intakeHost: configuredIntakeHost(),
      publicKeyRaw: b64ToBytes(current.publicKeyRawB64),
      checklistCiphertextB64: current.checklistCiphertextB64,
      stateCiphertextB64: current.stateCiphertextB64,
      oldLinkSecret: b64ToBytes(oldSecretB64),
    });
    const relay = makeIntakeRelay();
    await relay.regenerateIntake(intakeId, {
      token_b64: regenerated.tokenB64,
      checklist_ciphertext_b64: regenerated.checklistCiphertextB64,
      state_ciphertext_b64: regenerated.stateCiphertextB64,
    });
    const savedNewSecret = await saveIntakeLinkSecretWithRetry(intakeId, regenerated.linkSecretB64);
    if (!savedNewSecret) {
      let restoredPreviousLink = false;
      let restoreFailed = false;
      try {
        const oldToken = (await deriveAuthToken(b64ToBytes(oldSecretB64))).tokenB64;
        // W2-COORD-FIX-REGEN-COMPENSATE
        await relay.regenerateIntake(intakeId, {
          token_b64: oldToken,
          checklist_ciphertext_b64: current.checklistCiphertextB64,
          state_ciphertext_b64: current.stateCiphertextB64,
        });
        restoredPreviousLink = true;
      } catch {
        restoreFailed = true;
      }
      if (restoredPreviousLink) {
        throw new Error(
          'The client onboarding link was regenerated on the server, but this device could not save it in secure storage. The previous link was restored and still works. Try regenerate again once secure storage is available.',
        );
      }
      if (restoreFailed) {
        throw new Error(
          `The client onboarding link was regenerated on the server, but this device could not save it in secure storage. ${BRAND.name} could not restore the previous link automatically. Try regenerate again once secure storage is available.`,
        );
      }
      throw new Error(
        'The client onboarding link was regenerated on the server, but this device could not save it in secure storage. Try regenerate again once secure storage is available.',
      );
    }
    updateIntake(intakeId, {
      link: regenerated.link,
      status: 'active',
      checklistCiphertextB64: regenerated.checklistCiphertextB64,
      stateCiphertextB64: regenerated.stateCiphertextB64,
    });
  }, [makeIntakeRelay, updateIntake]);

  const handleShareIntakeWithTeam = useCallback(async (intakeId: string) => {
    const current = useIntakeStore.getState().intakesById[intakeId];
    const firm = useFirmStore.getState();
    if (!current || !firm.session?.activated || firm.session.tier !== 'practice' || !firm.seatToken) {
      throw new Error('Team sharing is available with an active Firm seat.');
    }
    // This action changes who may receive the key. Refuse before the network
    // effect if the durable audit trail is unavailable.
    if (!onAuditLog) throw new Error('Team sharing needs the audit log available first.');
    const pairId = createAuditPairId('intake_key_share');
    const entry = {
      action: 'matter_shared' as const,
      description: 'Shared an intake decryption key with the current firm team.',
      model: undefined,
      inputs: { intakeId, matterId: current.matterId },
      outputs: {},
      userDecision: 'approved' as const,
      metadata: { intakeId, matterId: current.matterId, audit_pair_id: pairId },
    };
    await mustLogAuditPhase(onAuditLog, entry, 'intent', pairId);
    try {
      await publishIntakeKeyToMembers(
        new FirmApiClient(firm.tokenSource()),
        intakeId,
        current.matterId,
        1,
        { firmEntitled: true },
      );
      await mustLogAuditPhase(onAuditLog, entry, 'outcome', pairId);
    } catch (error) {
      await mustLogAuditPhase(onAuditLog, {
        ...entry,
        description: 'Could not share an intake decryption key with the firm team.',
        outputs: { error: error instanceof Error ? error.message : 'unknown' },
      }, 'outcome', pairId);
      throw error;
    }
  }, [onAuditLog]);

  const handleEditItem = useCallback((sectionKey: string, itemId: string) => {
    void (async () => {
      // BUG-105: prefill the prompt with the item's current text so the user can
      // tweak it instead of retyping the whole thing from a blank box.
      const current = useClientMapStore.getState().getMap(matterId);
      const existingText =
        current?.sections.find((sec) => sec.key === sectionKey)?.items.find((it) => it.id === itemId)?.text ?? '';
      const text = await prompt(t('matter.hub.edit-item-prompt'), existingText, {
        title: t('matter.hub.edit-item-title'),
        confirmLabel: t('matter.hub.save-action'),
      });
      if (text !== null && text.trim() !== '') {
        useClientMapStore.getState().editItem(matterId, sectionKey, itemId, text.trim());
      }
    })();
  }, [matterId, prompt, t]);

  const label = matter ? matterLabel(matter) : '';
  // Title = just the client NAMES (drop the "- Household" suffix); the icon +
  // the left nav carry the "this is the Client Map" context. No subtitle under
  // the header (Jameson: no subtext under any tab header).
  const headerTitle = matter
    ? matter.client && matter.client.trim() !== ''
      ? matter.client
      : label
    : '';

  const handleSyncClientMap = useCallback(() => {
    void (async () => {
      if (isSyncingClientMap) {
        setClientMapSyncResult('in_flight');
        return;
      }
      setIsSyncingClientMap(true);
      setClientMapSyncResult(null);
      try {
        const current = useClientMapStore.getState().getMap(matterId);
        let result: ClientMapSyncResult;
        if (!current || current.lastBuiltAt === '') {
          result = await generate();
        } else {
          result = await checkForUpdates();
        }
        setClientMapSyncResult(result);
      } finally {
        setIsSyncingClientMap(false);
      }
    })().catch((error: unknown) => {
      console.error('Failed to sync Client Map:', error);
      setClientMapSyncResult('failed');
      setIsSyncingClientMap(false);
    });
  }, [checkForUpdates, generate, isSyncingClientMap, matterId]);

  useEffect(() => {
    if (clientMapSyncResult !== 'unchanged' && clientMapSyncResult !== 'updated') return undefined;
    const timeout = window.setTimeout(() => { setClientMapSyncResult(null); }, 3000);
    return () => { window.clearTimeout(timeout); };
  }, [clientMapSyncResult]);

  const handleExportClientMapWord = useCallback(() => {
    void (async () => {
      if (exportingClientMap !== null || !clientMap.map) return;
      setExportingClientMap('word');
      try {
        const bytes = await clientMapToDocxBytes(clientMap.map, headerTitle);
        await saveFile(bytes, {
          suggestedName: suggestClientMapExportName(headerTitle),
          types: [
            {
              description: 'Word Documents',
              accept: {
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
              },
            },
          ],
          defaultExtension: 'docx',
        });
      } catch (error) {
        console.error('Failed to export Client Map:', error);
      } finally {
        setExportingClientMap(null);
      }
    })().catch((error: unknown) => {
      console.error('Unexpected Client Map export failure:', error);
      setExportingClientMap(null);
    });
  }, [clientMap.map, exportingClientMap, headerTitle]);

  const handleExportClientMapPdf = useCallback(() => {
    void (async () => {
      if (exportingClientMap !== null || !clientMap.map) return;
      setExportingClientMap('pdf');
      try {
        await exportClientMapPdf(clientMap.map, headerTitle);
      } catch (error) {
        console.error('Failed to export Client Map PDF:', error);
      } finally {
        setExportingClientMap(null);
      }
    })().catch((error: unknown) => {
      console.error('Unexpected Client Map PDF export failure:', error);
      setExportingClientMap(null);
    });
  }, [clientMap.map, exportingClientMap, headerTitle]);

  if (!matter) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          gap: 12,
          fontFamily: 'Satoshi, sans-serif',
          color: 'var(--color-muted-foreground)',
          fontSize: 'var(--kp-font-md)',
        }}
      >
        {t('matter.hub.not-found', { entity: entityLabel.One })}
        <button
          type="button"
          onClick={onBack}
          style={{
            marginTop: 8,
            padding: '6px 14px',
            borderRadius: 'var(--radius-md)',
            fontSize: 'var(--kp-font-sm)',
            fontWeight: 'var(--kp-weight-semibold)',
            border: '1px solid var(--color-border)',
            background: '#fff',
            color: 'var(--kp-navy)',
            cursor: 'pointer',
          }}
        >
          {t('matter.hub.back-to', { entityOther: entityLabel.Other })}
        </button>
      </div>
    );
  }

  const clientMapUpdatedText = formatClientMapUpdated(clientMap.map?.lastBuiltAt, {
    notUpdatedYet: t('matter.hub.not-updated-yet'),
    updatedRecently: t('matter.hub.updated-recently'),
    updatedAt: (date) => t('matter.hub.updated-at', { date }),
  });
  const clientMapHeaderStatus =
    isSyncingClientMap || clientMapSyncResult === 'in_flight'
      ? t('matter.hub.updating')
      : clientMapSyncResult === 'failed'
        ? t('matter.hub.sync-failed')
        : clientMapSyncResult === 'unchanged'
          ? t('matter.hub.no-new-changes')
          : clientMapSyncResult === 'updated'
            ? t('matter.hub.updated-short')
            : '';
  const clientMapHeaderStatusState =
    clientMapSyncResult === 'failed'
      ? 'failure'
      : isSyncingClientMap || clientMapSyncResult === 'in_flight'
        ? 'pending'
        : 'ok';

  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
        background: 'var(--color-background)',
        fontFamily: 'Satoshi, sans-serif',
      }}
    >
      {/* ── A. Header row: [icon][name] on the left; the sub-tabs + the
             guided-interview action on the right (one clean line). ───────── */}
      <div
        style={{
          padding: 'var(--kp-surface-header-pad)',
          borderBottom: '1px solid var(--kp-divider)',
          flexShrink: 0,
        }}
      >
        <SurfaceHeader
          Icon={Map}
          iconColor="var(--kp-accent)"
          title={headerTitle}
          titleActions={
            <div
              data-testid="clientmap-header-icon-group"
              style={{ display: 'flex', alignItems: 'center', gap: 'var(--kp-space-xs)', minWidth: 0 }}
            >
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <IconButton
                    icon={MoreVertical}
                    label={t('matter.hub.client-map-actions')}
                    variant="ghost"
                    size="md"
                    data-testid="clientmap-actions-menu-button"
                  />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-56">
                  <DropdownMenuItem
                    data-testid="clientmap-export-word"
                    disabled={clientMap.map === undefined || exportingClientMap !== null}
                    onClick={handleExportClientMapWord}
                  >
                    {t('matter.hub.export-client-map-docx')}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    data-testid="clientmap-export-pdf"
                    disabled={clientMap.map === undefined || exportingClientMap !== null}
                    onClick={handleExportClientMapPdf}
                  >
                    {t('matter.hub.export-client-map-pdf')}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    data-testid="clientmap-sync-button"
                    disabled={isSyncingClientMap}
                    title={clientMapUpdatedText}
                    onClick={handleSyncClientMap}
                  >
                    {t('matter.hub.sync-all')}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    data-testid="clientmap-last-updated-menu"
                    disabled
                  >
                    {clientMapUpdatedText}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    data-testid="clientmap-history-button"
                    onClick={() => {
                      setHistorySectionFilter(null);
                      setIsHistoryOpen(true);
                    }}
                  >
                    {t('matter.hub.history-title')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <div role="tablist" aria-label={t('matter.hub.sections-aria')} data-testid="hub-subtab-bar" style={{ display: 'flex', alignItems: 'center', gap: 2, minWidth: 0, flexWrap: 'wrap' }}>
                {visibleHubTabs.map(({ id }) => {
                  const active = subTab === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      data-testid={`hub-subtab-${id}`}
                      onClick={() => {
                        setSubTab(id);
                        if (id !== 'meetings') setInitialSelectedMeeting(null);
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        padding: '7px 13px',
                        border: '1px solid transparent',
                        borderRadius: 'var(--radius-md)',
                        background: active ? 'var(--kp-accent-soft)' : 'transparent',
                        color: active ? 'var(--kp-navy)' : 'var(--color-muted-foreground)',
                        fontWeight: active ? 'var(--kp-weight-semibold)' : 'var(--kp-weight-medium)',
                        fontSize: 'var(--kp-font-sm)',
                        fontFamily: 'inherit',
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                        transition: 'background 0.1s',
                      }}
                      onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'var(--kp-accent-softer)'; }}
                      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
                    >
                      {hubTabLabel(id, t)}
                    </button>
                  );
                })}
              </div>
              <span
                data-testid="clientmap-last-updated"
                aria-live="polite"
                style={{
                  whiteSpace: 'nowrap',
                  display: clientMapHeaderStatus === '' ? 'none' : 'inline',
                }}
              >
                {clientMapHeaderStatus !== '' ? (
                  <QuietStatus state={clientMapHeaderStatusState}>{clientMapHeaderStatus}</QuietStatus>
                ) : null}
              </span>
            </div>
          }
          actions={
            (selection.blocked || selection.stale || isPrivileged || matter.privileged || matter.isSample) ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--kp-space-md)' }}>
              {selection.blocked ? (
                <Badge variant="danger" size="sm" data-testid="matter-hub-selection-blocked" aria-label="Client selection blocked">
                  BLOCKED
                </Badge>
              ) : null}
              {selection.stale ? (
                <Badge variant="warning" size="sm" data-testid="matter-hub-selection-stale" aria-label="Client selection updating">
                  Selection updating
                </Badge>
              ) : null}
              {(isPrivileged || matter.privileged) && (
                <span data-testid="hub-isolated-badge">
                  <Badge variant="privilege" size="sm" icon={Lock}>{t('matter.hub.isolated-pill')}</Badge>
                </span>
              )}
              {matter.isSample && (
                <span data-testid="hub-sample-pill">
                  <Badge variant="sample" size="sm">{t('matter.hub.sample-pill')}</Badge>
                </span>
              )}
              {/* F1: the AI-status pill was a passive duplicate of the top-bar
                  egress indicator and could contradict it on one screen. Egress
                  status now lives ONCE, in the top bar. */}
            </div>
            ) : undefined
          }
        />
      </div>

      {/* ── C. Active panel ────────────────────────────────────────────── */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {/* QA finding (P2): CrmWriteReviewCard only ever mounted inside
            Overview — a pending Wealthbox proposal was invisible from
            Documents/Email/Activity. This slim banner surfaces it on every
            OTHER sub-tab and jumps back to Overview (where the full card
            lives) on click. */}
        {subTab !== 'overview' && (
          <CrmWritePendingBanner matterId={matterId} onReviewNow={() => { setSubTab('overview'); setInitialSelectedMeeting(null); }} />
        )}
        {subTab === 'overview' && (
          <div
            data-testid="hub-subtab-panel-overview"
            style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
          >
            <div style={{ padding: '0 var(--kp-gutter)' }}>
              <BeforeYouMeetStrip matterId={matterId} />
            </div>
            {/* Client Map — flat & full-bleed (no card), matching the Ask
                surface: a calm section rail + a breathing reading column, with
                no box-in-a-box nesting. The in-hub Ask box was removed — Ask now
                lives in its own dedicated tab, so the Overview stays calm. */}
            <div
              data-testid="hub-panel-clientmap"
              style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
            >
              <div
                data-testid="hub-panel-clientmap-body"
                style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
              >
                {/* Build states only appear off the happy path. */}
                {(clientMap.status === 'idle' ||
                  clientMap.status === 'generating' ||
                  clientMap.status === 'empty' ||
                  clientMap.status === 'error') && (
                  <div style={{ padding: 'var(--kp-surface-gap) var(--kp-gutter) 0' }}>
                    {(clientMap.status === 'idle' || clientMap.status === 'generating') && (
                      <div
                        data-testid="hub-clientmap-loading"
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          color: 'var(--color-muted-foreground)',
                          fontSize: 'var(--kp-font-xs)',
                        }}
                      >
                        <Loader2
                          className="animate-spin"
                          style={{
                            width: 'var(--kp-icon-sm)',
                            height: 'var(--kp-icon-sm)',
                            strokeWidth: 2,
                          }}
                        />
                        {t('matter.hub.building')}
                      </div>
                    )}

                    {clientMap.status === 'empty' && (
                      <div
                        data-testid="hub-clientmap-empty"
                        style={{ fontSize: 'var(--kp-font-xs)', color: 'var(--color-muted-foreground)' }}
                      >
                        {t('matter.hub.empty-notice')}
                      </div>
                    )}

                    {clientMap.status === 'error' && (
                      <div
                        data-testid="hub-clientmap-error"
                        style={{ fontSize: 'var(--kp-font-xs)', color: 'var(--color-muted-foreground)' }}
                      >
                        {clientMap.errorMessage ?? t('matter.hub.error-notice')}
                      </div>
                    )}
                  </div>
                )}

                {/* Codex review catch: the Wealthbox write-back queue is
                    independent of Client Map readiness — a note sent from the
                    (always-available) shared notes editor must stay reachable
                    for approval/dismiss even while the map itself is empty,
                    still generating, or errored. The card is a no-op render
                    (returns null) when there's nothing queued. */}
                <div style={{ padding: '0 var(--kp-gutter)' }}>
                  <CrmWriteReviewCard matterId={matterId} />
                </div>

                {/* The flat, full-bleed Client Map panel absorbs the questions
                    list, the custom-section composer, and the templates list. */}
                {clientMap.status === 'ready' && clientMap.map !== undefined && (
                  <ClientMapPanel
                    map={clientMap.map}
                    onOpenSource={handleOpenSource}
                    onEditItem={handleEditItem}
                    onAnswerQuestion={(gap) => {
                      void (async () => {
                        const a = await prompt(`${t('matter.hub.answer-prompt')} ${gap.text}`, undefined, {
                          title: t('matter.hub.answer-title'),
                          confirmLabel: t('matter.hub.save-action'),
                        });
                        if (a != null && a.trim() !== '') {
                          answerQuestion(matterId, gap.sectionKey, a.trim(), gap.text);
                        }
                      })();
                    }}
                    onFlagForClient={(gap) => { flagForClient(matterId, gap.text); }}
                    onViewSectionHistory={(sectionKey, sectionTitle) => {
                      setHistorySectionFilter({ key: sectionKey, title: sectionTitle });
                      setIsHistoryOpen(true);
                    }}
                    {...(onAuditLog ? { onAuditLog } : {})}
                  />
                )}
                {workspaceRoot != null && workspaceRoot !== '' && (
                  <div style={{ padding: '0 var(--kp-gutter)' }}>
                    <VoiceprintsCard matterId={matterId} workspaceRoot={workspaceRoot} />
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {subTab === 'documents' && (
          <div data-testid="hub-subtab-panel-documents" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            {renderDocuments ? renderDocuments(matter) : <SubTabUnavailable label={t('matter.hub.tab-documents')} />}
          </div>
        )}

        {subTab === 'onboarding' && (
          <div data-testid="hub-subtab-panel-onboarding" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <ClientRequestsTab
              matterId={matterId}
              clientName={matter.name || matter.client || 'Client'}
              advisorId={advisorId}
              issueRequest={handleIssueRequest}
              activeRequestId={pendingRequestId}
              onActiveRequestConsumed={() => { setPendingRequestId(null); }}
              onExtend={handleExtendIntake}
              onRevoke={handleRevokeIntake}
              onRegenerate={handleRegenerateIntake}
              onShareWithTeam={handleShareIntakeWithTeam}
              {...(workspaceService !== undefined ? { workspaceService } : {})}
              matterFolderPath={matter.folderPaths[0] ?? ''}
              onSendForSignature={handleSendForSignature}
            />
          </div>
        )}

        {subTab === 'email' && (
          <div data-testid="hub-subtab-panel-email" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            {renderEmail ? renderEmail() : <SubTabUnavailable label={t('matter.hub.tab-email')} />}
          </div>
        )}

        {subTab === 'meetings' && (
          <div data-testid="hub-subtab-panel-meetings" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            {activeMeetingClientBoundary?.matterId === matterId ? (
              <ClientMeetingsTab
                clientBoundary={activeMeetingClientBoundary}
                getActiveClientBoundary={readActiveMeetingClientBoundary}
                matterFolder={matter.folderPaths[0] ?? ''}
                workspaceService={workspaceService ?? null}
                {...(initialSelectedMeeting ? { initialSelectedMeeting } : {})}
              />
            ) : null}
          </div>
        )}

      </div>
      <SlidePanel
        open={isHistoryOpen}
        onClose={() => { setIsHistoryOpen(false); }}
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Clock style={{ width: 'var(--kp-icon-lg)', height: 'var(--kp-icon-lg)', color: 'var(--kp-accent)', strokeWidth: 1.75 }} />
            <div style={{ fontSize: 'var(--kp-font-md)', fontWeight: 'var(--kp-weight-bold)', color: 'var(--kp-navy)', lineHeight: 'var(--kp-leading-tight)' }}>
              {historySectionFilter
                ? t('matter.hub.section-history-title', { section: historySectionFilter.title })
                : t('matter.hub.history-title')}
            </div>
          </div>
        }
        width={720}
        closeLabel={t('matter.hub.history-close')}
        data-testid="clientmap-history-panel"
      >
        {renderActivity
          ? renderActivity(historySectionFilter ? {
              clientMapSectionKey: historySectionFilter.key,
              clientMapSectionTitle: historySectionFilter.title,
            } : undefined)
          : <SubTabUnavailable label={t('matter.hub.history-title')} />}
      </SlidePanel>
      <PromptDialog {...promptDialogProps} />
    </div>
  );
}

// ── SubTabUnavailable ────────────────────────────────────────────────────────
// Fallback shown when a scoped surface isn't supplied (isolated component tests
// render MatterHub without the shell's render props). Never seen in the app.
function SubTabUnavailable({ label }: { label: string }) {
  return (
    <div
      data-testid="hub-subtab-unavailable"
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--color-muted-foreground)',
        fontSize: 'var(--kp-font-sm)',
        fontFamily: 'Satoshi, sans-serif',
      }}
    >
      {/* eslint-disable-next-line lantern-i18n/no-hardcoded-string */}
      {label} isn’t available here.
    </div>
  );
}
