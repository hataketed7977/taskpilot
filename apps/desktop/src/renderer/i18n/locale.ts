export const SUPPORTED_LOCALES = ['zh-CN', 'en'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
export const LOCALE_STORAGE_KEY = 'taskpilot.desktop.locale';

export function isSupportedLocale(value: unknown): value is SupportedLocale {
  return typeof value === 'string' && SUPPORTED_LOCALES.includes(value as SupportedLocale);
}

function mappedLocale(language: string): SupportedLocale | undefined {
  const primary = language.trim().split('-')[0]?.toLowerCase();
  if (primary === 'zh') return 'zh-CN';
  if (primary === 'en') return 'en';
  return undefined;
}

export function resolveInitialLocale(stored: unknown, languages: readonly string[]): SupportedLocale {
  if (isSupportedLocale(stored)) return stored;
  for (const language of languages) {
    const mapped = mappedLocale(language);
    if (mapped) return mapped;
  }
  return 'en';
}

export type LocaleStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function readStoredLocale(storage: LocaleStorage): SupportedLocale | undefined {
  try {
    const value = storage.getItem(LOCALE_STORAGE_KEY);
    return isSupportedLocale(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

export function writeStoredLocale(storage: LocaleStorage, locale: SupportedLocale): void {
  try {
    storage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // The in-memory selection remains authoritative for this application run.
  }
}
