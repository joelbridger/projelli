import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { BRAND } from './config/brand';
import { LOCAL_AI_NAME } from './config/brandText';
import en from './locales/en.json';
import es from './locales/es.json';
import de from './locales/de.json';

export const brandInterpolation = {
  productName: BRAND.name,
  productNameShort: BRAND.nameShort,
  productNamePossessive: BRAND.possessive,
  productAiName: BRAND.messaging.redlineAuthor,
  localAiName: LOCAL_AI_NAME,
} as const;

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    es: { translation: es },
    de: { translation: de },
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
