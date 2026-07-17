import {
  askScopeBuilder,
  askSourceBelongsToScope,
  collectAskSourceCandidates,
  resolveAskScope,
  type AskSourceDescriptor,
} from '@/features/ask';
import {
  fixtureClient,
  fixtureOwners,
  type FixtureClientRef,
  type FixtureMeetingRef,
} from './ownerFixture';

// A consumer of @/features/ask cannot bind or replace the shared-client reader:
// the owner binding is off-barrel. These doorways compile and, at runtime, fail
// closed until the real shared-client owner establishes the binding.
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
