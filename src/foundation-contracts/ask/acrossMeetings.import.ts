import {
  askScopeBuilder,
  buildAskCitation,
  type AskMeetingArtifactSource,
  resolveAskScope,
} from '@/features/ask';

const scope = resolveAskScope(
  askScopeBuilder.singleMeeting('fixture-workspace', {
    id: 'meeting-1',
    matterId: 'matter-1',
  })
);
declare const artifact: AskMeetingArtifactSource;
void buildAskCitation('claim-1', scope, artifact);
