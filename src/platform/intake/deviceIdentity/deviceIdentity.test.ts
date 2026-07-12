import { describe, expect, it } from 'vitest';

import { classifyDeviceIdentity } from './deviceIdentity';

describe('classifyDeviceIdentity', () => {
  it('trusts the first verified client-page marker for a new intake', () => {
    expect(classifyDeviceIdentity('first-browser', [])).toBe('first_trusted_device');
  });

  it('recognizes a later submission from the trusted browser', () => {
    expect(classifyDeviceIdentity('first-browser', ['first-browser'])).toBe('known_device');
  });

  it('flags a different browser after the first device is trusted', () => {
    expect(classifyDeviceIdentity('second-browser', ['first-browser'])).toBe('new_device');
  });
});
