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

const scope = resolveAskScope(
  askScopeBuilder.chosenSources('fixture-workspace', fixtureClient, [
    'source-1',
  ]),
  fixtureClient,
  fixtureOwners
);
declare const source: AskSourceDescriptor<FixtureClientRef, FixtureMeetingRef>;
void collectAskSourceCandidates(scope, fixtureOwners);
void askSourceBelongsToScope(scope, source, fixtureOwners);
