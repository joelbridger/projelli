import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { BRAND } from './config/brand';
import { LOCAL_AI_NAME } from './config/brandText';
import { localeCatalogs } from './i18nCatalogs';

export const brandInterpolation = {
  productName: BRAND.name,
  productNameShort: BRAND.nameShort,
  productNamePossessive: BRAND.possessive,
  productAiName: BRAND.messaging.redlineAuthor,
  localAiName: LOCAL_AI_NAME,
  domain: BRAND.urls.domain,
  siteUrl: BRAND.urls.site,
  repositoryUrl: BRAND.urls.repository,
  licenseUrl: BRAND.urls.licenseUrl,
  supportUrl: BRAND.urls.supportUrl,
  supportEmail: BRAND.urls.supportEmail,
} as const;

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: localeCatalogs.en },
    es: { translation: localeCatalogs.es },
    de: { translation: localeCatalogs.de },
  },
  lng: 'en',
  fallbackLng: 'en',
  interpolation: {
    escapeValue: false,
    defaultVariables: brandInterpolation,
  },
  returnEmptyString: false,
  saveMissing: import.meta.env.DEV,
});

export default i18n;
