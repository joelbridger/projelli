import { locale as osLocale } from '@tauri-apps/plugin-os';

const SUPPORTED = ['en', 'es', 'de'] as const;
type SupportedLocale = (typeof SUPPORTED)[number];

export async function detectLocale(): Promise<SupportedLocale> {
  try {
    const raw = await osLocale();
    if (!raw) return 'en';
    const lang = raw.split('-')[0]?.toLowerCase() ?? '';
    return (SUPPORTED as readonly string[]).includes(lang)
      ? (lang as SupportedLocale)
      : 'en';
  } catch {
    return 'en';
  }
}
