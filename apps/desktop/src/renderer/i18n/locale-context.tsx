import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Resource } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { createRendererI18n } from './i18n';
import { SUPPORTED_LOCALES } from './locale';
import { messageResources } from './messages';
import {
  readStoredLocale,
  resolveInitialLocale,
  writeStoredLocale,
  type LocaleStorage,
  type SupportedLocale,
} from './locale';
import { LocaleContext } from './locale-state';

export function LocaleProvider({ children, initialLanguages, storage, resources = messageResources }: {
  children: ReactNode;
  initialLanguages?: readonly string[];
  storage?: LocaleStorage;
  resources?: Resource;
}) {
  const actualStorage = storage ?? window.localStorage;
  const [initial] = useState(() => resolveInitialLocale(readStoredLocale(actualStorage), initialLanguages ?? navigator.languages));
  const [locale, setLocale] = useState<SupportedLocale>(initial);
  const [i18n] = useState(() => createRendererI18n(initial, resources));
  const previousResources = useRef(resources);

  useEffect(() => { document.documentElement.lang = locale; }, [locale]);

  useEffect(() => {
    if (previousResources.current === resources) return;
    for (const supportedLocale of SUPPORTED_LOCALES) {
      i18n.removeResourceBundle(supportedLocale, 'translation');
      const translation = resources[supportedLocale]?.translation;
      if (translation) i18n.addResourceBundle(supportedLocale, 'translation', translation, true, true);
    }
    previousResources.current = resources;
  }, [i18n, resources]);

  const changeLocale = useCallback(async (next: SupportedLocale) => {
    if (next === locale) return;
    await i18n.changeLanguage(next);
    setLocale(next);
    writeStoredLocale(actualStorage, next);
  }, [actualStorage, i18n, locale]);

  return <LocaleContext.Provider value={{ locale, changeLocale }}><I18nextProvider i18n={i18n}>{children}</I18nextProvider></LocaleContext.Provider>;
}
