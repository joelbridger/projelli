import { describe, expect, it } from 'vitest';
import * as AskPublic from '@/features/ask';
import {
  askScopeBuilder,
  resolveAskScope,
  sealAskOpenPath,
  type AskClientSnapshot,
  type AskSourceDescriptor,
} from '@/features/ask';
import {
  fixtureClient,
  fixtureOwners,
  type FixtureClientRef,
  type FixtureMeetingRef,
} from './ownerFixture';

const RAW_TOKEN = 'client-a-secret-open-token';
// This is the hostile cast the public intake must reject. It can satisfy TypeScript
// only by erasing the private brand, and it has no runtime provenance seal.
const forgedClient = fixtureClient as unknown as AskClientSnapshot<FixtureClientRef>;
const sourceA: AskSourceDescriptor<FixtureClientRef, FixtureMeetingRef> = {
  sourceId: 'consumer-source-a',
  kind: 'document',
  workspaceId: 'fixture-workspace',
  client: forgedClient,
  label: 'Client A plan',
  availability: 'available',
  citationOpenPath: sealAskOpenPath({ kind: 'document', token: RAW_TOKEN }),
};

const scopeA = () =>
  resolveAskScope(
    askScopeBuilder.chosenSources('fixture-workspace', forgedClient, [
      sourceA.sourceId,
    ]),
    forgedClient,
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

  it('reproduces the verifier probe: a consumer cannot restore client A from a cast', () => {
    // The cast-forged authority is rejected before an ordinary consumer can even
    // create a client scope. No public function can mint a replacement for it.
    expect(scopeA).toThrow('minted by the shared-client owner');

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
    // Its cast-forged client can never enter a scope, so this sealed opener has
    // no publicly reachable authority path.
    expect(scopeA).toThrow('minted by the shared-client owner');
  });
});
