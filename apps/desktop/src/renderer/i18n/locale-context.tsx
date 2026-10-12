import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { createRendererI18n } from './i18n';
import {
  readStoredLocale,
  resolveInitialLocale,
  writeStoredLocale,
  type LocaleStorage,
  type SupportedLocale,
} from './locale';
import { LocaleContext } from './locale-state';

export function LocaleProvider({ children, initialLanguages, storage }: {
  children: ReactNode;
  initialLanguages?: readonly string[];
  storage?: LocaleStorage;
}) {
  const actualStorage = storage ?? window.localStorage;
  const [initial] = useState(() => resolveInitialLocale(readStoredLocale(actualStorage), initialLanguages ?? navigator.languages));
  const [locale, setLocale] = useState<SupportedLocale>(initial);
  const [i18n] = useState(() => createRendererI18n(initial));

  useEffect(() => { document.documentElement.lang = locale; }, [locale]);

  const changeLocale = useCallback(async (next: SupportedLocale) => {
    if (next === locale) return;
    await i18n.changeLanguage(next);
    setLocale(next);
    writeStoredLocale(actualStorage, next);
  }, [actualStorage, i18n, locale]);

  return <LocaleContext.Provider value={{ locale, changeLocale }}><I18nextProvider i18n={i18n}>{children}</I18nextProvider></LocaleContext.Provider>;
}
