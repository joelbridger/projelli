import { describe, expect, it } from 'vitest';
import i18n, { brandInterpolation } from '@/i18n';
import { BRAND } from '@/config/brand';
import { brandText, brandValue, LOCAL_AI_NAME } from '@/config/brandText';
import { enCatalog as en } from '@/i18nCatalogs';

function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') {
    out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectStrings(item, out));
    return out;
  }
  if (value && typeof value === 'object') {
    Object.values(value).forEach((item) => collectStrings(item, out));
  }
  return out;
}

describe('brand i18n placeholders', () => {
  it('keeps the product name out of English translation literals', () => {
    const visibleStrings = collectStrings(en);

    expect(visibleStrings.join('\n')).not.toMatch(/\bLantern(?:'s|’s)?\b/);
  });

  it('fills product-name placeholders from the brand config', () => {
    expect(brandInterpolation.productName).toBe(BRAND.name);
    expect(i18n.t('onboarding.first-run.welcome.title')).toBe(`Welcome to ${BRAND.name}`);
    expect(i18n.t('local-ai-settings.title')).toBe(LOCAL_AI_NAME);
  });

  it('brands long-form non-i18n copy from the same config', () => {
    expect(brandText('Lantern, Lantern AI, and Lantern Local AI')).toBe(
      `${BRAND.name}, ${BRAND.messaging.redlineAuthor}, and ${LOCAL_AI_NAME}`,
    );
  });

  it('brands nested copy collections from the same config', () => {
    expect(brandValue({ label: 'Lantern AI', items: ['Lantern Local AI'] })).toEqual({
      label: BRAND.messaging.redlineAuthor,
      items: [LOCAL_AI_NAME],
    });
  });
});
