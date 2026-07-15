import { afterEach, describe, expect, it } from 'vitest';
import {
  readSharedClientContext,
  useClientContextStore,
  type SharedClientIdentity,
} from '@/platform/client-context';

const fosterHousehold = {
  householdId: 'household-foster',
  displayName: 'Foster household',
  primaryPeople: ['Robert Foster', 'Elena Foster'],
} as const;

describe('client context store', () => {
  afterEach(() => {
    useClientContextStore.getState().clearClient();
  });

  it('sets one normalized stable household identity', () => {
    useClientContextStore.getState().setClient({
      householdId: ' household-foster ',
      displayName: ' Foster household ',
      primaryPeople: [' Robert Foster ', 'Elena Foster'],
    });

    expect(useClientContextStore.getState().client).toEqual(fosterHousehold);
  });

  it('clears the household identity', () => {
    useClientContextStore.getState().setClient(fosterHousehold);
    useClientContextStore.getState().clearClient();

    expect(useClientContextStore.getState().client).toBeNull();
  });

  it('lets a narrow adapter follow the current household', () => {
    const adapter = {
      id: 'test',
      derive: (client: SharedClientIdentity | null) =>
        client?.householdId ?? null,
    };
    useClientContextStore.getState().setClient(fosterHousehold);

    expect(readSharedClientContext(adapter)).toBe('household-foster');
  });
});
