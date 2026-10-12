/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/renderer/App';
import { LocaleProvider } from '../../src/renderer/i18n/locale-context';
import type { FederatedAuthFlowView, SessionView, TaskPilotDesktopApi } from '../../src/shared/contracts';

const currentUser = { userId: '11111111-1111-4111-8111-111111111111', displayName: 'Ada' };
const waiting: FederatedAuthFlowView = { status: 'waiting', flowId: 'opaque-flow', expiresAt: '2030-01-01T00:00:00Z' };

function apiFor(session: SessionView = { status: 'signedOut' }): TaskPilotDesktopApi {
  return { auth: {
    getCapabilities: vi.fn().mockResolvedValue({ github: { enabled: true } }),
    startGitHubSignIn: vi.fn().mockResolvedValue(waiting),
    continueGitHubSignIn: vi.fn().mockResolvedValue(waiting),
    completeGitHubRegistration: vi.fn(),
    cancelGitHubSignIn: vi.fn().mockResolvedValue(undefined),
    getSessionView: vi.fn().mockResolvedValue(session),
    subscribeSessionView: vi.fn().mockReturnValue(() => undefined),
    logout: vi.fn().mockResolvedValue(undefined),
  } };
}

function renderApp(api: TaskPilotDesktopApi, locale: 'zh-CN' | 'en' = 'zh-CN') {
  return render(<LocaleProvider initialLanguages={[locale]}><App api={api} /></LocaleProvider>);
}

afterEach(() => { cleanup(); window.localStorage.clear(); });

describe('localized authentication and account experience', () => {
  it('switches signed-out copy immediately, updates html lang, keeps focus, and does not reload capabilities', async () => {
    const api = apiFor();
    const operator = userEvent.setup();
    renderApp(api);
    expect(await screen.findByRole('heading', { name: '登录 TaskPilot' })).toBeInTheDocument();
    const selector = screen.getByRole('combobox', { name: '语言' });
    selector.focus();
    await operator.selectOptions(selector, 'en');
    expect(screen.getByRole('heading', { name: 'Sign in to TaskPilot' })).toBeInTheDocument();
    expect(selector).toHaveFocus();
    expect(document.documentElement.lang).toBe('en');
    expect(api.auth.getCapabilities).toHaveBeenCalledTimes(1);
  });

  it('keeps the active waiting flow while translating its status and performs no auth call for the switch', async () => {
    const api = apiFor();
    const operator = userEvent.setup();
    renderApp(api);
    await operator.click(await screen.findByRole('button', { name: '使用 GitHub 登录' }));
    expect(await screen.findByRole('heading', { name: '在浏览器中继续' })).toBeInTheDocument();
    const before = vi.mocked(api.auth.continueGitHubSignIn).mock.calls.length;
    await operator.selectOptions(screen.getByRole('combobox', { name: '语言' }), 'en');
    expect(screen.getByRole('heading', { name: 'Continue in your browser' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Waiting for you to finish GitHub authorization');
    expect(api.auth.startGitHubSignIn).toHaveBeenCalledTimes(1);
    expect(api.auth.continueGitHubSignIn).toHaveBeenCalledTimes(before);
  });

  it('preserves registration form values and avatar choice while clearing only legal consent', async () => {
    const api = apiFor();
    vi.mocked(api.auth.startGitHubSignIn).mockResolvedValue({
      status: 'registrationRequired', flowId: 'opaque-flow', suggestedDisplayName: 'octocat',
      suggestedAvatarUrl: 'https://avatars.githubusercontent.com/u/1?v=4', legalBundleVersion: '2026-09-01',
    });
    const operator = userEvent.setup();
    renderApp(api);
    await operator.click(await screen.findByRole('button', { name: '使用 GitHub 登录' }));
    const name = await screen.findByLabelText('显示名称');
    await operator.clear(name);
    await operator.type(name, 'Ada Lovelace');
    const avatar = screen.getByRole('checkbox', { name: '使用 GitHub 头像' });
    const consent = screen.getByRole('checkbox', { name: /用户协议.*隐私政策/ });
    await operator.click(consent);
    await operator.selectOptions(screen.getByRole('combobox', { name: '语言' }), 'en');
    expect(screen.getByLabelText('Display name')).toHaveValue('Ada Lovelace');
    expect(screen.getByRole('checkbox', { name: 'Use GitHub avatar' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Terms of Service.*Privacy Policy/ })).not.toBeChecked();
    expect(avatar).toBeInTheDocument();
  });

  it('offers the selector in an authenticated session without changing user data or session calls', async () => {
    const api = apiFor({ status: 'authenticated', currentUser });
    const operator = userEvent.setup();
    renderApp(api);
    expect(await screen.findByRole('heading', { name: 'Ada' })).toBeInTheDocument();
    await operator.selectOptions(screen.getByRole('combobox', { name: '语言' }), 'en');
    expect(screen.getByRole('heading', { name: 'Ada' })).toBeInTheDocument();
    expect(screen.getByText(/GitHub sign-in is ready/)).toBeInTheDocument();
    expect(api.auth.getSessionView).toHaveBeenCalledTimes(1);
    expect(api.auth.logout).not.toHaveBeenCalled();
  });

  it('localizes temporarily unavailable alerts and still exposes the selector', async () => {
    const api = apiFor({ status: 'temporarilyUnavailable' });
    const operator = userEvent.setup();
    renderApp(api);
    expect(await screen.findByRole('heading', { name: '暂时无法连接' })).toBeInTheDocument();
    await operator.selectOptions(screen.getByRole('combobox', { name: '语言' }), 'en');
    expect(screen.getByRole('heading', { name: 'Temporarily unable to connect' })).toBeInTheDocument();
    expect(screen.getByText('Your sign-in information remains safely stored on this device.')).toBeInTheDocument();
  });
});
