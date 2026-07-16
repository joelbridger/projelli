import {
  askScopeBuilder,
  buildAskCitation,
  type AskMeetingArtifactSource,
  bindAskSharedClient,
  resolveAskScope,
} from '@/features/ask';
import {
  fixtureClient,
  fixtureAccess,
  fixtureMeeting,
  fixtureOwners,
  type FixtureClientRef,
  type FixtureMeetingRef,
} from './ownerFixture';

bindAskSharedClient(fixtureAccess);

const scope = resolveAskScope(
  askScopeBuilder.singleMeeting(
    'fixture-workspace',
    fixtureClient,
    fixtureMeeting
  ),
  fixtureClient,
  fixtureOwners
);
declare const artifact: AskMeetingArtifactSource<
  FixtureClientRef,
  FixtureMeetingRef
>;
void buildAskCitation('claim-1', scope, artifact);
