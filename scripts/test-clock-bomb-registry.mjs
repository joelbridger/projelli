/**
 * scripts/test-clock-bomb-registry.mjs — the ONLY escape hatch for
 * `scripts/check-test-clock-bombs.mjs`.
 *
 * ── WHAT AN ENTRY MEANS ──────────────────────────────────────────────────────
 * "This test file holds a hard-coded FUTURE date and installs no fake clock,
 * and it has been SHOWN not to change verdict when the clock moves."
 * It does NOT mean "someone looked at it and it seemed fine".
 *
 * ── THE EVIDENCE BEHIND THE SEED SET (lane DATE-BOMB-SWEEP-c39, 2026-07-20) ───
 * Every file below was RUN under a whole-`Date` OFFSET clock probe at two
 * future instants and passed at both:
 *
 *     2026-09-04T12:00:00.000Z   428 files -> 428 passed, 0 failed
 *     2031-07-20T12:00:00.000Z   428 files -> 427 passed, 1 failed
 *
 * The single failure at +5 years was `src/platform/flags/expiry.test.ts`, which
 * is NOT in this registry and is a real scheduled failure (the flag registry's
 * earliest expiry, 2026-09-13, brackets it to 2026-09-14).
 *
 * The probe replaced the WHOLE `Date` — `Date.now()` AND the `new Date()`
 * constructor — as an OFFSET, not a frozen constant, with positive controls that
 * THROW on either defect. Both defects were hit for real in this program: a TORN
 * clock (only `Date.now()` patched) manufactured three false bombs for one lane,
 * and a FROZEN clock manufactured two more for this one. A clock probe of any
 * other shape produces confident garbage.
 *
 * ── THE BOUND ON THAT EVIDENCE, STATED RATHER THAN ROUNDED UP ────────────────
 * Two instants are a SAMPLE, not a proof of totality. A fuse that detonates
 * strictly between 2026-09-04 and 2031-07-20 and re-arms before 2031 would pass
 * both samples. Re-run `node scripts/sweep-test-clock-bombs.mjs` to resample.
 *
 * ── ADDING AN ENTRY ──────────────────────────────────────────────────────────
 * Entries are keyed on file AND literal. A NEW future date in an already listed
 * file still fails the check, so nothing here can grandfather a file into
 * permanent silence. Prefer pinning the clock; register only when the date is
 * genuinely inert.
 */

export const REGISTERED_CLOCK_READERS = {
  'src/features/ask/foundation/foundation.test.ts': {
    literals: ['2026-07-31', '2026-08-01'],
    reason: 'Seed set: no clock comparison observed — verdict unchanged under a whole-Date offset probe at 2026-09-04 and 2031-07-20.',
  },
  'src/features/booking/public-page/CalendarBookingPublicPage.test.tsx': {
    literals: ['2026-07-21T00:00:00Z', '2026-07-22T00:00:00Z'],
    reason: 'Seed set: no clock comparison observed — verdict unchanged under a whole-Date offset probe at 2026-09-04 and 2031-07-20.',
  },
  'src/features/calendar-add-event/CalendarAddEventMount.test.tsx': {
    literals: ['2026-08-03T14:00', '2026-08-03T14:00:00Z', '2026-08-03T14:30:00Z', '2026-08-03T15:00'],
    reason: 'Seed set: no clock comparison observed — verdict unchanged under a whole-Date offset probe at 2026-09-04 and 2031-07-20.',
  },
  'src/features/calendar-grid/CalendarGridSurface.test.tsx': {
    literals: ['2026-08-01T00:00:00.000Z', '2026-08-03T00:00:00.000Z', '2026-08-05', '2026-08-05T00:00:00.000Z', '2026-08-05T09:00', '2026-08-05T09:00:00Z', '2026-08-05T09:30:00Z', '2026-08-05T10:00:00Z', '2026-08-05T10:30:00Z', '2026-08-05T11:00:00Z', '2026-08-05T11:30:00Z', '2026-08-05T12:00:00Z', '2026-08-05T13:00:00Z', '2026-08-05T13:30:00Z', '2026-08-05T14:00:00Z', '2026-08-05T15:00:00Z', '2026-08-05T16:00:00Z', '2026-08-06T00:00:00.000Z', '2026-08-10T00:00:00.000Z', '2026-09-01T00:00:00.000Z'],
    reason: 'Seed set: no clock comparison observed — verdict unchanged under a whole-Date offset probe at 2026-09-04 and 2031-07-20.',
  },
  'src/features/calendar/core/availability.test.ts': {
    literals: ['2026-08-03T00:00:00Z', '2026-08-03T07:00:00Z', '2026-08-03T08:00:00Z', '2026-08-03T09:00:00Z', '2026-08-03T09:30:00Z', '2026-08-03T10:00:00Z', '2026-08-03T10:15:00Z', '2026-08-03T10:30:00Z', '2026-08-03T12:00:00Z', '2026-08-04T00:00:00Z'],
    reason: 'Seed set: no clock comparison observed — verdict unchanged under a whole-Date offset probe at 2026-09-04 and 2031-07-20.',
  },
  'src/features/calendar/core/bookingAdapter.test.ts': {
    literals: ['2026-08-03', '2026-08-03T14:00:00Z', '2026-08-03T14:30:00Z'],
    reason: 'Seed set: no clock comparison observed — verdict unchanged under a whole-Date offset probe at 2026-09-04 and 2031-07-20.',
  },
  'src/features/calendar/core/eventStore.test.ts': {
    literals: ['2026-08-03T14:00:00Z', '2026-08-03T14:30:00Z'],
    reason: 'Seed set: no clock comparison observed — verdict unchanged under a whole-Date offset probe at 2026-09-04 and 2031-07-20.',
  },
  'src/features/calendar/core/projectionRegistry.test.ts': {
    literals: ['2026-08-01T00:00:00Z', '2026-08-01T12:00:00Z', '2026-08-01T12:30:00Z', '2026-08-02T00:00:00Z'],
    reason: 'Seed set: no clock comparison observed — verdict unchanged under a whole-Date offset probe at 2026-09-04 and 2031-07-20.',
  },
  'src/features/calendar/core/recurrence.test.ts': {
    literals: ['2027-08-01T00:00:00Z', '2028-01-01T00:00:00Z', '2028-02-29T15:00:00Z', '2028-07-31T00:00:00Z'],
    reason: 'Seed set: no clock comparison observed — verdict unchanged under a whole-Date offset probe at 2026-09-04 and 2031-07-20.',
  },
  'src/features/calendar/core/time.test.ts': {
    literals: ['2028-02-29T14:00:00.123Z'],
    reason: 'Seed set: no clock comparison observed — verdict unchanged under a whole-Date offset probe at 2026-09-04 and 2031-07-20.',
  },
  'src/features/calendar/testing/roundTripCalendarFoundation.test.tsx': {
    literals: ['2026-08-03T14:00:00Z', '2026-08-03T14:30:00Z'],
    reason: 'Seed set: no clock comparison observed — verdict unchanged under a whole-Date offset probe at 2026-09-04 and 2031-07-20.',
  },
  'src/features/crm-clients/ClientsSurface.scopeUpdate.test.tsx': {
    literals: ['2030-01-01'],
    reason: 'Seed set: no clock comparison observed — verdict unchanged under a whole-Date offset probe at 2026-09-04 and 2031-07-20.',
  },
  'src/features/crm-clients/extensions/custom-fields/customFields.test.tsx': {
    literals: ['2026-09-01'],
    reason: 'Seed set: no clock comparison observed — verdict unchanged under a whole-Date offset probe at 2026-09-04 and 2031-07-20.',
  },
  'src/features/crm-clients/extensions/employment/employment.test.tsx': {
    literals: ['2027-03-01'],
    reason: 'Seed set: no clock comparison observed — verdict unchanged under a whole-Date offset probe at 2026-09-04 and 2031-07-20.',
  },
  'src/features/crm-home/shared/liveTaskAdapter.test.ts': {
    literals: ['2026-08-03'],
    reason: 'Seed set: no clock comparison observed — verdict unchanged under a whole-Date offset probe at 2026-09-04 and 2031-07-20.',
  },
  'src/features/crm-projects/internal/internalProjects.test.tsx': {
    literals: ['2026-07-31', '2026-08-12'],
    reason: 'Seed set: no clock comparison observed — verdict unchanged under a whole-Date offset probe at 2026-09-04 and 2031-07-20.',
  },
  'src/features/crm-tasks/Tasks.actionContext.test.tsx': {
    literals: ['2026-08-03'],
    reason: 'Seed set: no clock comparison observed — verdict unchanged under a whole-Date offset probe at 2026-09-04 and 2031-07-20.',
  },
  'src/features/crm-tasks/Tasks.rowActions.live.test.tsx': {
    literals: ['2026-08-03', '2026-08-18T02:00:00.000Z'],
    reason: 'Seed set: no clock comparison observed — verdict unchanged under a whole-Date offset probe at 2026-09-04 and 2031-07-20.',
  },
  'src/features/crm-tasks/Tasks.unifiedList.test.tsx': {
    literals: ['2999-01-01', '2999-03-10'],
    reason: 'Seed set: no clock comparison observed — verdict unchanged under a whole-Date offset probe at 2026-09-04 and 2031-07-20.',
  },
  'src/features/crm-tasks/extensions/capacity-triage/capacityTriage.test.tsx': {
    literals: ['2030-01-01'],
    reason: 'Seed set: no clock comparison observed — verdict unchanged under a whole-Date offset probe at 2026-09-04 and 2031-07-20.',
  },
  'src/features/crm-tasks/extensions/create/TaskCreateTemplate.test.tsx': {
    literals: ['2026-08-03'],
    reason: 'Seed set: no clock comparison observed — verdict unchanged under a whole-Date offset probe at 2026-09-04 and 2031-07-20.',
  },
  'src/features/crm-tasks/extensions/create/createTask.persistence.test.tsx': {
    literals: ['2026-08-03'],
    reason: 'Seed set: no clock comparison observed — verdict unchanged under a whole-Date offset probe at 2026-09-04 and 2031-07-20.',
  },
  'src/features/crm-tasks/extensions/create/createTask.test.ts': {
    literals: ['2026-08-03'],
    reason: 'Seed set: no clock comparison observed — verdict unchanged under a whole-Date offset probe at 2026-09-04 and 2031-07-20.',
  },
  'src/features/crm-tasks/extensions/print/TaskListPrintAction.test.tsx': {
    literals: ['2030-04-12', '2030-04-13'],
    reason: 'Seed set: no clock comparison observed — verdict unchanged under a whole-Date offset probe at 2026-09-04 and 2031-07-20.',
  },
  'src/features/crm-tasks/extensions/templates/TaskTemplateLibrary.test.tsx': {
    literals: ['2026-08-03'],
    reason: 'Seed set: no clock comparison observed — verdict unchanged under a whole-Date offset probe at 2026-09-04 and 2031-07-20.',
  },
  'src/features/crm-tasks/extensions/templates/taskTemplateStore.live.test.tsx': {
    literals: ['2026-08-03', '2026-09-14'],
    reason: 'Seed set: no clock comparison observed — verdict unchanged under a whole-Date offset probe at 2026-09-04 and 2031-07-20.',
  },
  'src/features/crm-tasks/taskRecordStore.live.test.tsx': {
    literals: ['2026-08-03'],
    reason: 'Seed set: no clock comparison observed — verdict unchanged under a whole-Date offset probe at 2026-09-04 and 2031-07-20.',
  },
  'src/features/crm-tasks/taskRecordStore.test.tsx': {
    literals: ['2026-08-03'],
    reason: 'Seed set: no clock comparison observed — verdict unchanged under a whole-Date offset probe at 2026-09-04 and 2031-07-20.',
  },
  'src/features/crm-tasks/taskRemoval.live.test.tsx': {
    literals: ['2026-08-17T12:00:00Z'],
    reason: 'Seed set: no clock comparison observed — verdict unchanged under a whole-Date offset probe at 2026-09-04 and 2031-07-20.',
  },
  'src/features/crm-tasks/testing/roundTripTaskRecord.test.tsx': {
    literals: ['2026-08-03'],
    reason: 'Seed set: no clock comparison observed — verdict unchanged under a whole-Date offset probe at 2026-09-04 and 2031-07-20.',
  },
  'src/features/crm-today/Today.test.tsx': {
    literals: ['2030-01-05'],
    reason: 'Seed set: no clock comparison observed — verdict unchanged under a whole-Date offset probe at 2026-09-04 and 2031-07-20.',
  },
  'src/features/crm-trash/TrashRecoverySurface.test.tsx': {
    literals: ['2099-08-14T12:00:00Z'],
    reason: 'Seed set: no clock comparison observed — verdict unchanged under a whole-Date offset probe at 2026-09-04 and 2031-07-20.',
  },
  'src/features/crm-trash/trashClient.test.ts': {
    literals: ['2026-08-14T12:00:00Z'],
    reason: 'Seed set: no clock comparison observed — verdict unchanged under a whole-Date offset probe at 2026-09-04 and 2031-07-20.',
  },
  'src/features/crm-workflows/workflowStepPersistence.test.ts': {
    literals: ['2027-01-01T00:00:00.000Z'],
    reason: 'Seed set: no clock comparison observed — verdict unchanged under a whole-Date offset probe at 2026-09-04 and 2031-07-20.',
  },
  'src/features/intake/NudgeReviewModal.test.tsx': {
    literals: ['2026-08-09T00:00:00.000Z'],
    reason: 'Seed set: no clock comparison observed — verdict unchanged under a whole-Date offset probe at 2026-09-04 and 2031-07-20.',
  },
  'src/features/intake/OnboardingTab.test.tsx': {
    literals: ['2026-08-09T00:00:00.000Z'],
    reason: 'Seed set: no clock comparison observed — verdict unchanged under a whole-Date offset probe at 2026-09-04 and 2031-07-20.',
  },
  'src/features/intake/__tests__/ClientRequestsTab.test.tsx': {
    literals: ['2026-08-09T00:00:00.000Z'],
    reason: 'Seed set: no clock comparison observed — verdict unchanged under a whole-Date offset probe at 2026-09-04 and 2031-07-20.',
  },
  'src/features/intake/__tests__/EmailReplyQuarantineCard.test.tsx': {
    literals: ['2026-12-01T00:00:00.000Z'],
    reason: 'Seed set: no clock comparison observed — verdict unchanged under a whole-Date offset probe at 2026-09-04 and 2031-07-20.',
  },
  'src/features/intake/__tests__/OnboardingBoard.test.tsx': {
    literals: ['2026-08-09T00:00:00.000Z'],
    reason: 'Seed set: no clock comparison observed — verdict unchanged under a whole-Date offset probe at 2026-09-04 and 2031-07-20.',
  },
  'src/features/intake/__tests__/OnboardingBoardContainer.test.tsx': {
    literals: ['2026-08-09T00:00:00.000Z'],
    reason: 'Seed set: no clock comparison observed — verdict unchanged under a whole-Date offset probe at 2026-09-04 and 2031-07-20.',
  },
  'src/features/intake/__tests__/PdfFillRequestStatus.test.tsx': {
    literals: ['2026-08-09T00:00:00.000Z'],
    reason: 'Seed set: no clock comparison observed — verdict unchanged under a whole-Date offset probe at 2026-09-04 and 2031-07-20.',
  },
  'src/features/intake/__tests__/PhoneWalkthrough.test.tsx': {
    literals: ['2026-08-01T00:00:00.000Z'],
    reason: 'Seed set: no clock comparison observed — verdict unchanged under a whole-Date offset probe at 2026-09-04 and 2031-07-20.',
  },
  'src/features/intake/__tests__/PhoneWalkthroughDocumentExtraction.test.tsx': {
    literals: ['2026-08-01T00:00:00.000Z'],
    reason: 'Seed set: no clock comparison observed — verdict unchanged under a whole-Date offset probe at 2026-09-04 and 2031-07-20.',
  },
  'src/features/intake/__tests__/RequestsBoard.test.tsx': {
    literals: ['2026-08-09T00:00:00.000Z'],
    reason: 'Seed set: no clock comparison observed — verdict unchanged under a whole-Date offset probe at 2026-09-04 and 2031-07-20.',
  },
  'src/features/intake/__tests__/RequestsUiIntegration.test.tsx': {
    literals: ['2026-08-09T00:00:00.000Z'],
    reason: 'Seed set: no clock comparison observed — verdict unchanged under a whole-Date offset probe at 2026-09-04 and 2031-07-20.',
  },
  'src/features/intake/__tests__/linkSignals.test.tsx': {
    literals: ['2026-08-09T00:00:00.000Z'],
    reason: 'Seed set: no clock comparison observed — verdict unchanged under a whole-Date offset probe at 2026-09-04 and 2031-07-20.',
  },
  'src/features/intake/__tests__/nudgeEngine.test.tsx': {
    literals: ['2026-08-09T00:00:00.000Z'],
    reason: 'Seed set: no clock comparison observed — verdict unchanged under a whole-Date offset probe at 2026-09-04 and 2031-07-20.',
  },
  'src/features/intake/__tests__/onboarding-e2e.test.tsx': {
    literals: ['2026-08-09T00:00:00.000Z'],
    reason: 'Seed set: no clock comparison observed — verdict unchanged under a whole-Date offset probe at 2026-09-04 and 2031-07-20.',
  },
  'src/features/meetings/foundation/contract.test.ts': {
    literals: ['2026-07-21', '2026-07-21T09:00:00.000Z', '2026-07-21T10:00:00.000Z', '2026-07-21T10:01:00.000Z', '2026-07-22'],
    reason: 'Seed set: no clock comparison observed — verdict unchanged under a whole-Date offset probe at 2026-09-04 and 2031-07-20.',
  },
  'src/features/meetings/shell/MeetingsShell.realstore-isolation.test.tsx': {
    literals: ['2026-07-30'],
    reason: 'Seed set: no clock comparison observed — verdict unchanged under a whole-Date offset probe at 2026-09-04 and 2031-07-20.',
  },
  'src/platform/crm/tasks/index.test.ts': {
    literals: ['2030-01-01', '2030-01-03', '2030-01-15', '2030-01-31', '2030-03-03'],
    reason: 'Seed set: no clock comparison observed — verdict unchanged under a whole-Date offset probe at 2026-09-04 and 2031-07-20.',
  },
  'src/platform/docusignSigning/capabilityClient.test.ts': {
    literals: ['2026-12-01T00:00:00.000Z'],
    reason: 'Seed set: no clock comparison observed — verdict unchanged under a whole-Date offset probe at 2026-09-04 and 2031-07-20.',
  },
  'src/platform/flags/router.test.tsx': {
    literals: ['2026-08-14'],
    reason: 'Seed set: no clock comparison observed — verdict unchanged under a whole-Date offset probe at 2026-09-04 and 2031-07-20.',
  },
  'src/platform/intake/IntakeRelayClient.test.ts': {
    literals: ['2026-08-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z'],
    reason: 'Seed set: no clock comparison observed — verdict unchanged under a whole-Date offset probe at 2026-09-04 and 2031-07-20.',
  },
  'src/platform/intake/__tests__/docusignSignatureContract.test.ts': {
    literals: ['2026-12-01T00:00:00.000Z'],
    reason: 'Seed set: no clock comparison observed — verdict unchanged under a whole-Date offset probe at 2026-09-04 and 2031-07-20.',
  },
  'src/platform/intake/__tests__/inboxSyncContract.test.ts': {
    literals: ['2026-08-09T00:00:00.000Z'],
    reason: 'Seed set: no clock comparison observed — verdict unchanged under a whole-Date offset probe at 2026-09-04 and 2031-07-20.',
  },
  'src/platform/intake/__tests__/nudgeCadence.test.ts': {
    literals: ['2026-08-09T00:00:00.000Z'],
    reason: 'Seed set: no clock comparison observed — verdict unchanged under a whole-Date offset probe at 2026-09-04 and 2031-07-20.',
  },
  'src/platform/intake/__tests__/pdfFillContract.test.ts': {
    literals: ['2026-12-01T00:00:00.000Z'],
    reason: 'Seed set: no clock comparison observed — verdict unchanged under a whole-Date offset probe at 2026-09-04 and 2031-07-20.',
  },
  'src/platform/intake/__tests__/standingRequestContract.test.ts': {
    literals: ['2026-08-01T00:00:00.000Z'],
    reason: 'Seed set: no clock comparison observed — verdict unchanged under a whole-Date offset probe at 2026-09-04 and 2031-07-20.',
  },
  'src/platform/intake/createIntake.test.ts': {
    literals: ['2026-12-01T00:00:00.000Z'],
    reason: 'Seed set: no clock comparison observed — verdict unchanged under a whole-Date offset probe at 2026-09-04 and 2031-07-20.',
  },
  'src/platform/intake/emailReplyAccept.test.ts': {
    literals: ['2026-08-10T00:00:00.000Z'],
    reason: 'Seed set: no clock comparison observed — verdict unchanged under a whole-Date offset probe at 2026-09-04 and 2031-07-20.',
  },
  'src/platform/intake/emailReplyMatcher.test.ts': {
    literals: ['2026-08-10T12:00:00.000Z'],
    reason: 'Seed set: no clock comparison observed — verdict unchanged under a whole-Date offset probe at 2026-09-04 and 2031-07-20.',
  },
  'src/platform/intake/emailReplyQuarantineManualFile.test.ts': {
    literals: ['2026-12-01T00:00:00.000Z'],
    reason: 'Seed set: no clock comparison observed — verdict unchanged under a whole-Date offset probe at 2026-09-04 and 2031-07-20.',
  },
  'src/platform/intake/factsStore.test.ts': {
    literals: ['2026-08-09T00:00:00.000Z'],
    reason: 'Seed set: no clock comparison observed — verdict unchanged under a whole-Date offset probe at 2026-09-04 and 2031-07-20.',
  },
  'src/platform/intake/intakeStore.test.ts': {
    literals: ['2026-08-01T00:00:00.000Z', '2026-08-09T00:00:00.000Z'],
    reason: 'Seed set: no clock comparison observed — verdict unchanged under a whole-Date offset probe at 2026-09-04 and 2031-07-20.',
  },
  'src/platform/intake/onboardingKpis.test.ts': {
    literals: ['2026-08-01T00:00:00.000Z'],
    reason: 'Seed set: no clock comparison observed — verdict unchanged under a whole-Date offset probe at 2026-09-04 and 2031-07-20.',
  },
  'src/platform/intake/onboardingModel.test.ts': {
    literals: ['2026-08-09T00:00:00.000Z'],
    reason: 'Seed set: no clock comparison observed — verdict unchanged under a whole-Date offset probe at 2026-09-04 and 2031-07-20.',
  },
  'src/platform/intake/useDocumentExtractionIngestion.test.tsx': {
    literals: ['2026-08-01T00:00:00.000Z'],
    reason: 'Seed set: no clock comparison observed — verdict unchanged under a whole-Date offset probe at 2026-09-04 and 2031-07-20.',
  },
  'src/platform/intake/useIntakeInboxSync.test.ts': {
    literals: ['2026-08-09T00:00:00.000Z'],
    reason: 'Seed set: no clock comparison observed — verdict unchanged under a whole-Date offset probe at 2026-09-04 and 2031-07-20.',
  },
  'src/platform/intake/welcomeJourneySeal.test.ts': {
    literals: ['2026-08-09T00:00:00.000Z'],
    reason: 'Seed set: no clock comparison observed — verdict unchanged under a whole-Date offset probe at 2026-09-04 and 2031-07-20.',
  },
  'src/platform/meetingNotesReview/MeetingNotesReview.test.tsx': {
    literals: ['2026-08-01'],
    reason: 'Seed set: no clock comparison observed — verdict unchanged under a whole-Date offset probe at 2026-09-04 and 2031-07-20.',
  },
  'src/platform/meetingNotesReview/notesReviewDelivery.exact.test.ts': {
    literals: ['2026-08-01', '2026-08-05'],
    reason: 'Seed set: no clock comparison observed — verdict unchanged under a whole-Date offset probe at 2026-09-04 and 2031-07-20.',
  },
  'src/ui/NotesReviewPanel.test.tsx': {
    literals: ['2026-08-01', '2026-08-05'],
    reason: 'Seed set: no clock comparison observed — verdict unchanged under a whole-Date offset probe at 2026-09-04 and 2031-07-20.',
  },
  'tests/public-imports/calendar-add-event-roundtrip.test.tsx': {
    literals: ['2026-08-03T14:00:00Z', '2026-08-03T14:30:00Z'],
    reason: 'Seed set: no clock comparison observed — verdict unchanged under a whole-Date offset probe at 2026-09-04 and 2031-07-20.',
  },
  'tests/public-imports/calendar-booking-public-page.roundTrip.test.tsx': {
    literals: ['2026-07-21T00:00:00Z'],
    reason: 'Seed set: no clock comparison observed — verdict unchanged under a whole-Date offset probe at 2026-09-04 and 2031-07-20.',
  },
  'tests/unit/firm/firmEntitlement.test.ts': {
    literals: ['2026-09-01T12:00:00.000Z'],
    reason: 'Seed set: no clock comparison observed — verdict unchanged under a whole-Date offset probe at 2026-09-04 and 2031-07-20.',
  },
  'tests/unit/firm/signInSso.test.ts': {
    literals: ['2026-12-31T00:00:00Z', '2027-06-30T00:00:00Z'],
    reason: 'Seed set: no clock comparison observed — verdict unchanged under a whole-Date offset probe at 2026-09-04 and 2031-07-20.',
  },
  'tests/unit/flags/flag-scripts.test.ts': {
    literals: ['2026-08-01'],
    reason: 'Seed set: no clock comparison observed — verdict unchanged under a whole-Date offset probe at 2026-09-04 and 2031-07-20.',
  },
  'tests/unit/licensing/entitlements.test.ts': {
    literals: ['2026-09-01T12:00:00.000Z'],
    reason: 'Seed set: no clock comparison observed — verdict unchanged under a whole-Date offset probe at 2026-09-04 and 2031-07-20.',
  },
  'tests/unit/meetings/todays-meetings-strip.test.tsx': {
    literals: ['2026-12-31T09:00:00'],
    reason: 'Seed set: no clock comparison observed — verdict unchanged under a whole-Date offset probe at 2026-09-04 and 2031-07-20.',
  },
};
