import { createInstance, type i18n, type Resource } from 'i18next';
import { initReactI18next } from 'react-i18next';
import type { SupportedLocale } from './locale';
import { messageResources } from './messages';

export function createRendererI18n(locale: SupportedLocale, resources: Resource = messageResources): i18n {
  const instance = createInstance();
  void instance.use(initReactI18next).init({
    resources,
    lng: locale,
    fallbackLng: 'en',
    supportedLngs: ['zh-CN', 'en'],
    nonExplicitSupportedLngs: false,
    interpolation: { escapeValue: false },
    initAsync: false,
    returnNull: false,
  });
  return instance;
}
