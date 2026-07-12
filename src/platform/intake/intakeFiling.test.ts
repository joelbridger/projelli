import { describe, expect, it } from 'vitest';
import { intakePdfFormFolder, intakeSignaturesFolder } from './intakeFiling';

describe('signature filing folders', () => {
  it('separates signed documents from the immutable completed form', () => {
    expect(intakePdfFormFolder('/workspace/client', 'w9-form-a1')).toBe('/workspace/client/Requests/w9-form-a1/forms');
    expect(intakeSignaturesFolder('/workspace/client', 'w9-form-a1')).toBe('/workspace/client/Requests/w9-form-a1/signatures');
  });
});
