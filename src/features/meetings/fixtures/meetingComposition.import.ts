// Consumer-shaped compile proof for the meeting composition seam.
//
// This file stands in for a dependent lane (panels / header actions / insights)
// that lives OUTSIDE the meetings module. It imports the composition contracts
// only from the public `@/features/meetings` doorway — no deep import — and
// contributes through the real registration/weave path. `MeetingEntry` renders
// `getMeetingPanelComposition()`, so a registered contribution reaches the host.
// Registration runs only when a caller invokes the exported installer, so
// merely importing this proof has no global side effect.
import {
  registerMeetingPanel,
  registerMeetingHeaderAction,
  registerMeetingInsight,
  getMeetingPanelComposition,
  getMeetingHeaderActionComposition,
  getMeetingInsightComposition,
  type MeetingPanelComposition,
  type MeetingPanelDescriptor,
  type MeetingPanelContext,
  type MeetingPanelId,
  type MeetingHeaderActionComposition,
  type MeetingHeaderActionDescriptor,
  type MeetingHeaderActionContext,
  type MeetingHeaderActionId,
  type MeetingInsightComposition,
  type MeetingInsightDescriptor,
} from '@/features/meetings';

// A dependent panel contribution. A new id must be declared through the public
// id map by its owner; a fixture asserts the id shape without that augmentation.
const dependentPanel: MeetingPanelDescriptor = {
  id: 'meeting-signals-panel' as MeetingPanelId,
  order: 40,
  labelKey: 'meetings.signals.tab',
  isAvailable: () => true,
  mount: () => null,
};

const dependentAction: MeetingHeaderActionDescriptor = {
  id: 'meeting-visibility-action' as MeetingHeaderActionId,
  order: 40,
  labelKey: 'meetings.visibility.action',
  placement: 'secondary',
  mount: () => null,
};

// Compile proof: an outside dependent registers into the live host composition
// and reads the composed result back. Returns a cleanup that unregisters.
export function installMeetingContributions(
  insight: MeetingInsightDescriptor
): () => void {
  const offPanel = registerMeetingPanel(dependentPanel);
  const offAction = registerMeetingHeaderAction(dependentAction);
  const offInsight = registerMeetingInsight(insight);
  const panels: MeetingPanelComposition = getMeetingPanelComposition();
  const actions: MeetingHeaderActionComposition =
    getMeetingHeaderActionComposition();
  const insights: MeetingInsightComposition = getMeetingInsightComposition();
  void panels;
  void actions;
  void insights;
  return () => {
    offPanel();
    offAction();
    offInsight();
  };
}

export type MeetingCompositionContextProof =
  | MeetingPanelContext
  | MeetingHeaderActionContext;
export type MeetingCompositionImportProof =
  | MeetingPanelDescriptor
  | MeetingHeaderActionDescriptor
  | MeetingInsightDescriptor;
