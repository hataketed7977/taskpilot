/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useTranslation } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';
import { createRendererI18n } from '../../src/renderer/i18n/i18n';
import { LocaleProvider } from '../../src/renderer/i18n/locale-context';
import { useLocale } from '../../src/renderer/i18n/locale-state';
import {
  LOCALE_STORAGE_KEY,
  readStoredLocale,
  resolveInitialLocale,
  writeStoredLocale,
} from '../../src/renderer/i18n/locale';
import { messageResources } from '../../src/renderer/i18n/messages';

function keys(value: object, prefix = ''): string[] {
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof child === 'object' && child !== null ? keys(child as object, path) : [path];
  });
}

describe('Desktop internationalization core', () => {
  it.each([
    { languages: ['fr-FR', 'zh-CN'], expected: 'zh-CN' },
    { languages: ['en-US', 'zh-CN'], expected: 'en' },
    { languages: ['fr-FR'], expected: 'en' },
    { languages: ['ZH-Hant-TW'], expected: 'zh-CN' },
  ] as const)('resolves $languages to $expected', ({ languages, expected }) => {
    expect(resolveInitialLocale(undefined, languages)).toBe(expected);
  });

  it('prefers a valid stored locale and ignores invalid values', () => {
    expect(resolveInitialLocale('en', ['zh-CN'])).toBe('en');
    expect(resolveInitialLocale('invalid', ['zh-CN'])).toBe('zh-CN');
  });

  it('contains the same message keys in both locales and falls back to English', async () => {
    expect(keys(messageResources.en.translation).sort()).toEqual(keys(messageResources['zh-CN'].translation).sort());
    const i18n = createRendererI18n('zh-CN', {
      en: { translation: { fallbackProbe: 'English fallback' } },
      'zh-CN': { translation: {} },
    });
    expect(i18n.t('fallbackProbe')).toBe('English fallback');
  });

  it('preserves interpolated user content while React owns output escaping', () => {
    const i18n = createRendererI18n('en');

    expect(i18n.t('registration.avatarInitials', { initials: '<A&' })).toBe('Avatar initials: <A&');
  });

  it('updates a mounted provider when development replaces its message resources', async () => {
    function Probe() {
      const { t } = useTranslation();
      return <span>{t('project.loadErrorSignOut')}</span>;
    }

    const missing = {
      en: { translation: {} },
      'zh-CN': { translation: {} },
    };
    const updated = {
      en: { translation: { project: { loadErrorSignOut: 'Sign out and return' } } },
      'zh-CN': { translation: { project: { loadErrorSignOut: '退出并返回登录' } } },
    };
    const view = render(<LocaleProvider initialLanguages={['zh-CN']} resources={missing}><Probe /></LocaleProvider>);
    expect(screen.getByText('project.loadErrorSignOut')).toBeInTheDocument();

    view.rerender(<LocaleProvider initialLanguages={['zh-CN']} resources={updated}><Probe /></LocaleProvider>);

    expect(await screen.findByText('退出并返回登录')).toBeInTheDocument();
  });

  it('survives storage read and write failures', () => {
    const storage = {
      getItem: vi.fn(() => { throw new DOMException('blocked'); }),
      setItem: vi.fn(() => { throw new DOMException('quota'); }),
    };
    expect(readStoredLocale(storage)).toBeUndefined();
    expect(() => writeStoredLocale(storage, 'en')).not.toThrow();
  });

  it('persists a switch, updates html lang and keeps focus', async () => {
    window.localStorage.clear();
    function Probe() {
      const { locale, changeLocale } = useLocale();
      const { t } = useTranslation();
      return <button type="button" onClick={() => void changeLocale(locale === 'en' ? 'zh-CN' : 'en')}>{t('language.current')}</button>;
    }
    render(<LocaleProvider initialLanguages={['en-US']}><Probe /></LocaleProvider>);
    const operator = userEvent.setup();
    const button = screen.getByRole('button', { name: 'English' });
    button.focus();
    await operator.click(button);
    expect(screen.getByRole('button', { name: '简体中文' })).toHaveFocus();
    expect(document.documentElement.lang).toBe('zh-CN');
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('zh-CN');
  });
});
