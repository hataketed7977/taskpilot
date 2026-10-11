import { privacyZhCn } from './zh-CN/privacy-v1';
import { termsZhCn } from './zh-CN/terms-v1';

export type LegalLocale = 'zh-CN';
export type LegalDocumentKind = 'terms' | 'privacy';
export interface LegalSection { title: string; paragraphs: readonly string[] }
export interface LegalDocumentDefinition {
  kind: LegalDocumentKind;
  title: string;
  version: string;
  effectiveDate: string;
  sections: readonly LegalSection[];
}

export const CURRENT_LEGAL_BUNDLE = {
  version: '2026-09-01',
  locale: 'zh-CN',
  terms: termsZhCn,
  privacy: privacyZhCn,
} as const;

export function legalDocument(kind: LegalDocumentKind): LegalDocumentDefinition {
  return CURRENT_LEGAL_BUNDLE[kind];
}
