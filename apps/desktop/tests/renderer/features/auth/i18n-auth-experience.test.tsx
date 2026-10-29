/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../../../src/renderer/app/App';
import { LocaleProvider } from '../../../../src/renderer/i18n/locale-context';
import { boardTestApi } from '../../shared/board-test-api';
import type { FederatedAuthFlowView, SessionView, TaskPilotDesktopApi } from '../../../../src/shared/contracts';

const currentUser = { userId: '11111111-1111-4111-8111-111111111111', displayName: 'Ada' };

const workspace = {
  workspaceId: '22222222-2222-4222-8222-222222222222', type: 'PERSONAL' as const, role: 'OWNER' as const,
  createdAt: '2026-10-14T00:00:00Z', updatedAt: '2026-10-14T00:00:00Z',
};
const project = {
  projectId: '33333333-3333-4333-8333-333333333333', workspaceId: workspace.workspaceId,
  name: '我的项目', description: '', status: 'ACTIVE' as const, version: 0,
  createdAt: '2026-10-14T00:00:00Z', updatedAt: '2026-10-14T00:00:00Z', archivedAt: null,
};
const projectKey = { sessionGeneration: 1, userId: currentUser.userId, workspaceId: workspace.workspaceId, projectId: project.projectId, status: 'ACTIVE' as const };
const waiting: FederatedAuthFlowView = { status: 'waiting', flowId: 'opaque-flow', expiresAt: '2030-01-01T00:00:00Z' };

function apiFor(session: SessionView = { status: 'signedOut' }): TaskPilotDesktopApi {
  return {
    boards: boardTestApi({ sessionGeneration: projectKey.sessionGeneration, userId: projectKey.userId, workspaceId: projectKey.workspaceId, projectId: projectKey.projectId }),
    workspaces: { list: vi.fn().mockResolvedValue({ key: projectKey, value: [workspace] }) },
    projects: {
      resolveHome: vi.fn().mockResolvedValue({ key: projectKey, value: { workspace, projects: [project], currentProject: project } }),
      list: vi.fn(), open: vi.fn(), create: vi.fn(), edit: vi.fn(), archive: vi.fn(), restore: vi.fn(), permanentlyDelete: vi.fn(),
    },
    auth: {
    getCapabilities: vi.fn().mockResolvedValue({ github: { enabled: true } }),
    startGitHubSignIn: vi.fn().mockResolvedValue(waiting),
    continueGitHubSignIn: vi.fn().mockResolvedValue(waiting),
    completeGitHubRegistration: vi.fn(),
    cancelGitHubSignIn: vi.fn().mockResolvedValue(undefined),
    getSessionView: vi.fn().mockResolvedValue(session),
    subscribeSessionView: vi.fn().mockReturnValue(() => undefined),
    logout: vi.fn().mockResolvedValue(undefined),
    },
  };
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
    await operator.click(selector);
    expect(screen.getByRole('option', { name: '简体中文' })).toHaveAttribute('aria-selected', 'true');
    await operator.click(screen.getByRole('option', { name: 'English' }));
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
    await operator.click(screen.getByRole('combobox', { name: '语言' }));
    await operator.click(screen.getByRole('option', { name: 'English' }));
    expect(screen.getByRole('heading', { name: 'Continue in your browser' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Waiting for you to finish GitHub authorization');
    expect(api.auth.startGitHubSignIn).toHaveBeenCalledTimes(1);
    expect(api.auth.continueGitHubSignIn).toHaveBeenCalledTimes(before);
  });

  it('preserves registration form values and avatar choice while clearing only legal consent', async () => {
    const api = apiFor();
    vi.mocked(api.auth.startGitHubSignIn).mockResolvedValue({
      status: 'registrationRequired', flowId: 'opaque-flow', suggestedDisplayName: 'octocat',
      suggestedAvatarUrl: 'https://avatars.githubusercontent.com/u/1?v=4', legalBundleVersion: '2026-09-01', termsVersion: 'terms-2026-09-01', privacyVersion: 'privacy-2026-09-01', legalLocales: ['zh-CN', 'en'],
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
    await operator.click(screen.getByRole('combobox', { name: '语言' }));
    await operator.click(screen.getByRole('option', { name: 'English' }));
    expect(screen.getByLabelText('Display name')).toHaveValue('Ada Lovelace');
    expect(screen.getByRole('checkbox', { name: 'Use GitHub avatar' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Terms of Service.*Privacy Policy/ })).not.toBeChecked();
    expect(avatar).toBeInTheDocument();
  });

  it('offers the selector in an authenticated session without changing user data or session calls', async () => {
    const api = apiFor({ status: 'authenticated', currentUser });
    const operator = userEvent.setup();
    renderApp(api);
    expect(await screen.findByRole('heading', { name: '我的项目' })).toBeInTheDocument();
    await operator.click(screen.getByRole('button', { name: '打开账号菜单' }));
    await operator.click(screen.getByRole('combobox', { name: '语言' }));
    await operator.click(screen.getByRole('option', { name: 'English' }));
    expect(screen.getByRole('heading', { name: '我的项目' })).toBeInTheDocument();
    expect(screen.getByText(/Signed in with GitHub/)).toBeInTheDocument();
    expect(api.auth.getSessionView).toHaveBeenCalledTimes(1);
    expect(api.auth.logout).not.toHaveBeenCalled();
  });

  it('localizes temporarily unavailable alerts and still exposes the selector', async () => {
    const api = apiFor({ status: 'temporarilyUnavailable' });
    const operator = userEvent.setup();
    renderApp(api);
    expect(await screen.findByRole('heading', { name: '暂时无法连接' })).toBeInTheDocument();
    await operator.click(screen.getByRole('combobox', { name: '语言' }));
    await operator.click(screen.getByRole('option', { name: 'English' }));
    expect(screen.getByRole('heading', { name: 'Temporarily unable to connect' })).toBeInTheDocument();
    expect(screen.getByText('Your sign-in information remains safely stored on this device.')).toBeInTheDocument();
  });
});
