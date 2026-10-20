/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/renderer/App';
import { LocaleProvider } from '../../src/renderer/i18n/locale-context';
import { boardTestApi } from './board-test-api';
import { useLocale } from '../../src/renderer/i18n/locale-state';
import {
  LEGAL_BUNDLE_CATALOG,
  currentLegalBundle,
  formatLegalEffectiveDate,
  resolveLegalBundle,
  type LegalBundleCatalog,
} from '../../src/renderer/legal/legal-bundle';
import type { SessionView, TaskPilotDesktopApi } from '../../src/shared/contracts';

function signedOutApi(): TaskPilotDesktopApi {
  const signedOut: SessionView = { status: 'signedOut' };
  return {
    boards: boardTestApi({ sessionGeneration: 1, userId: '11111111-1111-4111-8111-111111111111', workspaceId: '22222222-2222-4222-8222-222222222222', projectId: '33333333-3333-4333-8333-333333333333' }),
    workspaces: { list: vi.fn() },
    projects: {
      resolveHome: vi.fn().mockImplementation(() => new Promise(() => undefined)),
      list: vi.fn(), open: vi.fn(), create: vi.fn(), edit: vi.fn(), archive: vi.fn(), restore: vi.fn(), permanentlyDelete: vi.fn(),
    },
    auth: {
      getCapabilities: vi.fn().mockResolvedValue({ github: { enabled: true } }),
      startGitHubSignIn: vi.fn().mockResolvedValue({
        status: 'registrationRequired',
        flowId: 'opaque-flow',
        suggestedDisplayName: 'octocat',
        suggestedAvatarUrl: 'https://avatars.githubusercontent.com/u/1?v=4',
        legalBundleVersion: '2026-09-01',
        termsVersion: 'terms-2026-09-01',
        privacyVersion: 'privacy-2026-09-01',
        legalLocales: ['zh-CN', 'en'],
      }),
      continueGitHubSignIn: vi.fn(),
      completeGitHubRegistration: vi.fn().mockResolvedValue({
        status: 'authenticated',
        currentUser: { userId: '11111111-1111-4111-8111-111111111111', displayName: 'Ada' },
      }),
      cancelGitHubSignIn: vi.fn().mockResolvedValue(undefined),
      getSessionView: vi.fn().mockResolvedValue(signedOut),
      subscribeSessionView: vi.fn().mockReturnValue(() => undefined),
      logout: vi.fn().mockResolvedValue(undefined),
    },
  };
}

function LocaleSwitchProbe() {
  const { locale, changeLocale } = useLocale();
  return <button type="button" onClick={() => void changeLocale(locale === 'zh-CN' ? 'en' : 'zh-CN')}>switch locale</button>;
}

afterEach(() => { cleanup(); window.localStorage.clear(); });

describe('Desktop legal bundle catalog', () => {
  it.each(['zh-CN', 'en'] as const)('resolves the exact current legal quartet for %s', (locale) => {
    const current = currentLegalBundle(locale);
    expect(current).toBeDefined();
    expect(resolveLegalBundle({
      locale,
      legalBundleVersion: '2026-09-01',
      termsVersion: 'terms-2026-09-01',
      privacyVersion: 'privacy-2026-09-01',
    })).toBe(current);
    expect(current?.locale).toBe(locale);
  });

  it('formats the same UTC effective date with the requested locale', () => {
    expect(formatLegalEffectiveDate('zh-CN', '2026-09-01')).toBe('2026年9月1日');
    expect(formatLegalEffectiveDate('en', '2026-09-01')).toBe('September 1, 2026');
  });

  it.each([
    { locale: 'fr', legalBundleVersion: '2026-09-01', termsVersion: 'terms-2026-09-01', privacyVersion: 'privacy-2026-09-01' },
    { locale: 'en', legalBundleVersion: 'wrong', termsVersion: 'terms-2026-09-01', privacyVersion: 'privacy-2026-09-01' },
    { locale: 'en', legalBundleVersion: '2026-09-01', termsVersion: 'wrong', privacyVersion: 'privacy-2026-09-01' },
    { locale: 'en', legalBundleVersion: '2026-09-01', termsVersion: 'terms-2026-09-01', privacyVersion: 'wrong' },
  ])('fails closed for an unknown legal quartet', (identity) => {
    expect(resolveLegalBundle(identity)).toBeUndefined();
  });

  it('does not fall back across locales when a legal resource is missing', () => {
    const missingEnglish = { 'zh-CN': LEGAL_BUNDLE_CATALOG['zh-CN'] } as LegalBundleCatalog;
    expect(currentLegalBundle('en', missingEnglish)).toBeUndefined();
    expect(resolveLegalBundle({
      locale: 'en',
      legalBundleVersion: '2026-09-01',
      termsVersion: 'terms-2026-09-01',
      privacyVersion: 'privacy-2026-09-01',
    }, missingEnglish)).toBeUndefined();
  });

  it('keeps registration profile choices but clears consent and submits the newly displayed quartet after a locale switch', async () => {
    const api = signedOutApi();
    const operator = userEvent.setup();
    render(
      <LocaleProvider initialLanguages={['zh-CN']}>
        <LocaleSwitchProbe />
        <App api={api} />
      </LocaleProvider>,
    );

    await operator.click(await screen.findByRole('button', { name: '使用 GitHub 登录' }));
    const name = await screen.findByLabelText('显示名称');
    await operator.clear(name);
    await operator.type(name, 'Ada Lovelace');
    const avatar = screen.getByRole('checkbox', { name: '使用 GitHub 头像' });
    await operator.click(avatar);
    const consent = screen.getByRole('checkbox', { name: /用户协议.*隐私政策/ });
    await operator.click(consent);
    expect(consent).toBeChecked();

    await operator.click(screen.getByRole('button', { name: 'switch locale' }));

    expect(screen.getByDisplayValue('Ada Lovelace')).toBeInTheDocument();
    expect(avatar).not.toBeChecked();
    expect(consent).not.toBeChecked();
    await operator.click(consent);
    await operator.click(screen.getByRole('button', { name: 'Create TaskPilot account' }));
    expect(api.auth.completeGitHubRegistration).toHaveBeenCalledWith(expect.objectContaining({
      displayName: 'Ada Lovelace',
      useSuggestedAvatar: false,
      locale: 'en',
      legalBundleVersion: '2026-09-01',
      termsVersion: 'terms-2026-09-01',
      privacyVersion: 'privacy-2026-09-01',
    }));
  });
});
