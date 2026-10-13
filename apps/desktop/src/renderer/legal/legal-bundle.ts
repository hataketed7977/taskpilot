import { isSupportedLocale, type SupportedLocale } from '../i18n/locale';
import { privacyEn } from './en/privacy-v1';
import { termsEn } from './en/terms-v1';
import { privacyZhCn } from './zh-CN/privacy-v1';
import { termsZhCn } from './zh-CN/terms-v1';

export type LegalDocumentKind = 'terms' | 'privacy';
export interface LegalSection { title: string; paragraphs: readonly string[] }
export interface LegalDocumentDefinition {
  kind: LegalDocumentKind;
  title: string;
  version: string;
  effectiveDate: string;
  sections: readonly LegalSection[];
}

export interface LegalBundle {
  version: string;
  locale: SupportedLocale;
  terms: LegalDocumentDefinition;
  privacy: LegalDocumentDefinition;
}

export interface LegalBundleIdentity {
  locale: string;
  legalBundleVersion: string;
  termsVersion: string;
  privacyVersion: string;
}

export type LegalBundleCatalog = Partial<Record<SupportedLocale, Readonly<Record<string, LegalBundle>>>>;

const CURRENT_LEGAL_BUNDLE_VERSION = '2026-09-01';

export const LEGAL_BUNDLE_CATALOG: LegalBundleCatalog = {
  'zh-CN': {
    [CURRENT_LEGAL_BUNDLE_VERSION]: {
      version: CURRENT_LEGAL_BUNDLE_VERSION,
      locale: 'zh-CN',
      terms: termsZhCn,
      privacy: privacyZhCn,
    },
  },
  en: {
    [CURRENT_LEGAL_BUNDLE_VERSION]: {
      version: CURRENT_LEGAL_BUNDLE_VERSION,
      locale: 'en',
      terms: termsEn,
      privacy: privacyEn,
    },
  },
};

export function currentLegalBundle(
  locale: SupportedLocale,
  catalog: LegalBundleCatalog = LEGAL_BUNDLE_CATALOG,
): LegalBundle | undefined {
  return catalog[locale]?.[CURRENT_LEGAL_BUNDLE_VERSION];
}

export function resolveLegalBundle(
  identity: LegalBundleIdentity,
  catalog: LegalBundleCatalog = LEGAL_BUNDLE_CATALOG,
): LegalBundle | undefined {
  if (!isSupportedLocale(identity.locale)) return undefined;
  const bundle = catalog[identity.locale]?.[identity.legalBundleVersion];
  if (!bundle) return undefined;
  return bundle.terms.version === identity.termsVersion && bundle.privacy.version === identity.privacyVersion
    ? bundle
    : undefined;
}

export function legalDocument(bundle: LegalBundle, kind: LegalDocumentKind): LegalDocumentDefinition {
  return bundle[kind];
}

export function formatLegalEffectiveDate(locale: SupportedLocale, effectiveDate: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' })
    .format(new Date(`${effectiveDate}T00:00:00Z`));
}
