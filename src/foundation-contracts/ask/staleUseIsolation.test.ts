import { describe, expect, it } from 'vitest';
import * as AskPublic from '@/features/ask';
import {
  askScopeBuilder,
  askSourceBelongsToScope,
  buildAskCitation,
  collectAskSourceCandidates,
  resolveAskScope,
  sealAskOpenPath,
  type AskSourceDescriptor,
} from '@/features/ask';
import {
  fixtureClient,
  fixtureOwners,
  type FixtureClientRef,
  type FixtureMeetingRef,
} from './ownerFixture';

const RAW_TOKEN = 'client-a-secret-open-token';
const sourceA: AskSourceDescriptor<FixtureClientRef, FixtureMeetingRef> = {
  sourceId: 'consumer-source-a',
  kind: 'document',
  workspaceId: 'fixture-workspace',
  client: fixtureClient,
  label: 'Client A plan',
  availability: 'available',
  citationOpenPath: sealAskOpenPath({ kind: 'document', token: RAW_TOKEN }),
};

const scopeA = () =>
  resolveAskScope(
    askScopeBuilder.chosenSources('fixture-workspace', fixtureClient, [
      sourceA.sourceId,
    ]),
    fixtureClient,
    fixtureOwners
  );

// A throwaway "ordinary consumer" that imports ONLY @/features/ask. It must have
// no way to bind, replace, or freeze the shared-client reader, and no way to
// read a source's raw opener token.
describe('Ask public surface: an ordinary consumer cannot own the shared client', () => {
  it('exposes no binder/owner capability that could set or replace the client reader', () => {
    const surface = AskPublic as Record<string, unknown>;
    // The verifier's probe reached for these on @/features/ask. They must be gone.
    expect(surface['bindAskSharedClient']).toBeUndefined();
    expect(surface['askSharedClientIsBound']).toBeUndefined();
    expect(surface['createAskSharedClientOwner']).toBeUndefined();
    expect(surface['readOwnerBoundAccess']).toBeUndefined();
    // Nothing on the public surface installs a bare access as the current client.
    const bindLike = Object.keys(surface).filter((n) => /bind|owner/i.test(n));
    expect(bindLike).toEqual([]);
  });

  it('reproduces the verifier probe: a consumer cannot restore client A; client-scoped doorways fail closed', () => {
    const scope = scopeA();
    // No owner is (or can be) established from the public surface, so every
    // client-scoped doorway fails closed. There is NO exported function the probe
    // could call to install `() => clientA` and make these return A's data.
    expect(askSourceBelongsToScope(scope, sourceA)).toBe(false);
    expect(() => collectAskSourceCandidates(scope)).toThrow('is not bound');

    // The verifier's exact move — call the public binder with a frozen A reader —
    // is not expressible: the binder does not exist on the public surface.
    const surface = AskPublic as Record<string, unknown>;
    expect(typeof surface['bindAskSharedClient']).not.toBe('function');
  });

  it('never exposes a source raw opener token as a plain field', () => {
    // A consumer holding a source cannot read the actionable token off it.
    expect(
      (sourceA.citationOpenPath as unknown as Record<string, unknown>)['token']
    ).toBeUndefined();
    expect(JSON.stringify(sourceA.citationOpenPath)).not.toContain(RAW_TOKEN);
    // The only path to the token is a use-time-guarded resolver reached through a
    // citation; building the citation itself fails closed (no owner established),
    // so the opener is doubly unreachable for a consumer.
    expect(() => buildAskCitation('c', scopeA(), sourceA)).toThrow(
      'outside the resolved scope'
    );
  });
});
