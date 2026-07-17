import {
  askScopeBuilder,
  buildAskCitation,
  type AskMeetingArtifactSource,
  resolveAskScope,
} from '@/features/ask';
import {
  fixtureClient,
  fixtureMeeting,
  fixtureOwners,
  type FixtureClientRef,
  type FixtureMeetingRef,
} from './ownerFixture';

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
