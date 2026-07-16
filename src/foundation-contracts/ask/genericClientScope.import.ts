import {
  askScopeBuilder,
  askSourceBelongsToScope,
  bindAskSharedClient,
  collectAskSourceCandidates,
  resolveAskScope,
  type AskSourceDescriptor,
} from '@/features/ask';
import {
  fixtureClient,
  fixtureAccess,
  fixtureOwners,
  type FixtureClientRef,
  type FixtureMeetingRef,
} from './ownerFixture';

// The shared-client owner binds one live access; every use-time doorway reads
// the current client from that binding, never from a caller-supplied value.
bindAskSharedClient(fixtureAccess);

const scope = resolveAskScope(
  askScopeBuilder.chosenSources('fixture-workspace', fixtureClient, [
    'source-1',
  ]),
  fixtureClient,
  fixtureOwners
);
declare const source: AskSourceDescriptor<FixtureClientRef, FixtureMeetingRef>;
void collectAskSourceCandidates(scope);
void askSourceBelongsToScope(scope, source);
