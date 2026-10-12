import { createContext, useContext } from 'react';
import type { SupportedLocale } from './locale';

export type LocaleContextValue = {
  locale: SupportedLocale;
  changeLocale(locale: SupportedLocale): Promise<void>;
};

export const LocaleContext = createContext<LocaleContextValue | undefined>(undefined);

export function useLocale(): LocaleContextValue {
  const value = useContext(LocaleContext);
  if (!value) throw new Error('useLocale must be used within LocaleProvider');
  return value;
}
