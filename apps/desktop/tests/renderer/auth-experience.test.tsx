// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/renderer/App';
import { LocaleProvider } from '../../src/renderer/i18n/locale-context';
import type { FederatedAuthFlowView, SessionView, TaskPilotDesktopApi } from '../../src/shared/contracts';

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
type RegistrationRequiredView = Extract<FederatedAuthFlowView, { status: 'registrationRequired' }>;
const registrationRequired = (overrides: Partial<RegistrationRequiredView> = {}): RegistrationRequiredView => ({
  status: 'registrationRequired',
  flowId: 'opaque-flow',
  suggestedDisplayName: 'Ada',
  legalBundleVersion: '2026-09-01',
  termsVersion: 'terms-2026-09-01',
  privacyVersion: 'privacy-2026-09-01',
  legalLocales: ['zh-CN', 'en'],
  ...overrides,
});

function renderApp(api: TaskPilotDesktopApi) {
  return render(<LocaleProvider initialLanguages={['zh-CN']}><App api={api} /></LocaleProvider>);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function signedOutApi(): TaskPilotDesktopApi {
  const signedOut: SessionView = { status: 'signedOut' };
  return {
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
      getSessionView: vi.fn().mockResolvedValue(signedOut),
      subscribeSessionView: vi.fn().mockReturnValue(() => undefined),
      logout: vi.fn().mockResolvedValue(undefined),
    },
  };
}

afterEach(() => { cleanup(); window.localStorage.clear(); vi.useRealTimers(); });

describe('GitHub authentication UX', () => {
  it('shows one GitHub entry with a keyboard skip target and no email fallback', async () => {
    const api = signedOutApi();
    renderApp(api);

    expect(await screen.findByRole('heading', { name: '登录 TaskPilot' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '跳到主要内容' })).toHaveAttribute('href', '#main-content');
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main-content');
    expect(screen.getByRole('button', { name: '使用 GitHub 登录' })).toBeEnabled();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/邮箱|密码|验证码/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /邮箱|密码|验证码|找回密码/ })).not.toBeInTheDocument();
  });

  it('fails closed when GitHub capability is unavailable and can retry capability discovery', async () => {
    const api = signedOutApi();
    vi.mocked(api.auth.getCapabilities)
      .mockResolvedValueOnce({ github: { enabled: false } })
      .mockResolvedValueOnce({ github: { enabled: true } });
    const operator = userEvent.setup();
    renderApp(api);

    expect(await screen.findByRole('heading', { name: 'GitHub 登录尚未配置' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '使用 GitHub 登录' })).not.toBeInTheDocument();
    await operator.click(screen.getByRole('button', { name: '重新检查' }));
    expect(await screen.findByRole('button', { name: '使用 GitHub 登录' })).toBeEnabled();
    expect(api.auth.getCapabilities).toHaveBeenCalledTimes(2);
  });

  it('announces browser opening and rejects duplicate activation', async () => {
    const api = signedOutApi();
    const result = deferred<FederatedAuthFlowView>();
    vi.mocked(api.auth.startGitHubSignIn).mockReturnValue(result.promise);
    const operator = userEvent.setup();
    renderApp(api);

    const start = await screen.findByRole('button', { name: '使用 GitHub 登录' });
    await operator.click(start);
    await operator.click(start);
    expect(screen.getByRole('button', { name: '正在打开 GitHub…' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('正在打开系统浏览器');
    expect(api.auth.startGitHubSignIn).toHaveBeenCalledTimes(1);
    result.resolve(waiting);
    expect(await screen.findByRole('heading', { name: '在浏览器中继续' })).toBeInTheDocument();
  });

  it('shows the authenticated account after GitHub login', async () => {
    const api = signedOutApi();
    vi.mocked(api.auth.startGitHubSignIn).mockResolvedValue({ status: 'authenticated', currentUser });
    const operator = userEvent.setup();
    renderApp(api);

    await operator.click(await screen.findByRole('button', { name: '使用 GitHub 登录' }));
    expect(await screen.findByRole('heading', { name: '我的项目' })).toBeInTheDocument();
    await operator.click(screen.getByRole('button', { name: '打开账号菜单' }));
    expect(screen.getByRole('button', { name: '退出登录' })).toBeEnabled();
  });

  it('logs out through the capability and returns to the sign-in view', async () => {
    const api = signedOutApi();
    let publishSession: ((view: SessionView) => void) | undefined;
    vi.mocked(api.auth.getSessionView).mockResolvedValue({ status: 'authenticated', currentUser });
    vi.mocked(api.auth.subscribeSessionView).mockImplementation((listener) => {
      publishSession = listener;
      return () => undefined;
    });
    vi.mocked(api.auth.logout).mockImplementation(async () => {
      publishSession?.({ status: 'signedOut' });
    });
    const operator = userEvent.setup();
    renderApp(api);

    await screen.findByRole('heading', { name: '我的项目' });
    await operator.click(screen.getByRole('button', { name: '打开账号菜单' }));
    await operator.click(screen.getByRole('button', { name: '退出登录' }));

    expect(api.auth.logout).toHaveBeenCalledOnce();
    expect(await screen.findByRole('heading', { name: '登录 TaskPilot' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '我的项目' })).not.toBeInTheDocument();
  });

  it('polls the same opaque flow, announces completion waiting, and stops after denial', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const api = signedOutApi();
    vi.mocked(api.auth.continueGitHubSignIn)
      .mockResolvedValueOnce({ status: 'completionRequired', flowId: 'opaque-flow', expiresAt: '2030-01-01T00:00:00Z' })
      .mockResolvedValueOnce({ status: 'denied', flowId: 'opaque-flow' });
    const operator = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderApp(api);
    await operator.click(await screen.findByRole('button', { name: '使用 GitHub 登录' }));

    await act(() => vi.advanceTimersByTimeAsync(1_100));
    expect(api.auth.continueGitHubSignIn).toHaveBeenCalledWith({ flowId: 'opaque-flow' });
    expect(screen.getByRole('status')).toHaveTextContent('等待浏览器安全完成');
    await act(() => vi.advanceTimersByTimeAsync(1_100));
    expect(await screen.findByRole('heading', { name: '未完成 GitHub 授权' })).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(3_000));
    expect(api.auth.continueGitHubSignIn).toHaveBeenCalledTimes(2);
  });

  it('validates nickname and terms, focuses server fields, and rejects duplicate registration', async () => {
    const api = signedOutApi();
    const registration: FederatedAuthFlowView = {
      status: 'registrationRequired', flowId: 'opaque-flow', suggestedDisplayName: 'octocat',
      suggestedAvatarUrl: 'https://avatars.githubusercontent.com/u/1?v=4', legalBundleVersion: '2026-09-01', termsVersion: 'terms-2026-09-01', privacyVersion: 'privacy-2026-09-01', legalLocales: ['zh-CN', 'en'],
    };
    vi.mocked(api.auth.startGitHubSignIn).mockResolvedValue(registration);
    const completed = deferred<FederatedAuthFlowView>();
    vi.mocked(api.auth.completeGitHubRegistration).mockReturnValue(completed.promise);
    const operator = userEvent.setup();
    renderApp(api);
    await operator.click(await screen.findByRole('button', { name: '使用 GitHub 登录' }));

    const name = await screen.findByLabelText('显示名称');
    await operator.clear(name);
    await operator.click(screen.getByRole('button', { name: '创建 TaskPilot 账号' }));
    expect(screen.getByRole('alert')).toHaveTextContent('请输入显示名称');
    expect(name).toHaveFocus();
    await operator.type(name, 'Ada');
    await operator.click(screen.getByRole('button', { name: '创建 TaskPilot 账号' }));
    const terms = screen.getByRole('checkbox', { name: /我已阅读并同意《用户协议》，并确认已阅读《隐私政策》/ });
    expect(screen.getByRole('alert')).toHaveTextContent('请先阅读并同意用户协议');
    expect(terms).toHaveFocus();
    await operator.click(terms);
    const submit = screen.getByRole('button', { name: '创建 TaskPilot 账号' });
    await operator.click(submit);
    await operator.click(submit);
    expect(screen.getByRole('button', { name: '正在创建账号…' })).toBeDisabled();
    expect(api.auth.completeGitHubRegistration).toHaveBeenCalledTimes(1);
    expect(api.auth.completeGitHubRegistration).toHaveBeenCalledWith({
      flowId: 'opaque-flow', displayName: 'Ada', useSuggestedAvatar: true, legalBundleVersion: '2026-09-01', termsVersion: 'terms-2026-09-01', privacyVersion: 'privacy-2026-09-01', locale: 'zh-CN',
    });
    completed.resolve({ status: 'authenticated', currentUser });
    expect(await screen.findByRole('heading', { name: '我的项目' })).toBeInTheDocument();
  });

  it('keeps first registration concise while preserving the optional GitHub avatar choice', async () => {
    const api = signedOutApi();
    vi.mocked(api.auth.startGitHubSignIn).mockResolvedValue({
      status: 'registrationRequired', flowId: 'opaque-flow', suggestedDisplayName: 'octocat',
      suggestedAvatarUrl: 'https://avatars.githubusercontent.com/u/1?v=4', legalBundleVersion: '2026-09-01', termsVersion: 'terms-2026-09-01', privacyVersion: 'privacy-2026-09-01', legalLocales: ['zh-CN', 'en'],
    });
    const operator = userEvent.setup();
    renderApp(api);
    await operator.click(await screen.findByRole('button', { name: '使用 GitHub 登录' }));

    expect(await screen.findByRole('heading', { name: '创建 TaskPilot 账号' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: '使用 GitHub 头像' })).toBeChecked();
    expect(document.querySelector('.profile-avatar')).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(screen.queryByText('GitHub 身份已验证。确认公开资料后即可继续。')).not.toBeInTheDocument();
    expect(screen.queryByText(/账号设置|头像链接|公开头像/)).not.toBeInTheDocument();
  });

  it('opens both legal documents without exposing the bundle id or losing the registration draft', async () => {
    const api = signedOutApi();
    vi.mocked(api.auth.startGitHubSignIn).mockResolvedValue({
      status: 'registrationRequired', flowId: 'opaque-flow', suggestedDisplayName: 'octocat', legalBundleVersion: '2026-09-01', termsVersion: 'terms-2026-09-01', privacyVersion: 'privacy-2026-09-01', legalLocales: ['zh-CN', 'en'],
    });
    const operator = userEvent.setup();
    renderApp(api);
    await operator.click(await screen.findByRole('button', { name: '使用 GitHub 登录' }));

    const name = await screen.findByLabelText('显示名称');
    await operator.clear(name);
    await operator.type(name, 'Ada Lovelace');
    const checkbox = screen.getByRole('checkbox', { name: '我已阅读并同意《用户协议》，并确认已阅读《隐私政策》' });
    expect(screen.queryByText(/2026-09-01|版本/)).not.toBeInTheDocument();
    expect(checkbox).not.toBeChecked();

    await operator.click(screen.getByRole('button', { name: /用户协议/ }));
    expect(screen.getByRole('heading', { name: 'TaskPilot 用户协议' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Agent 与 AI 输出/ })).toBeInTheDocument();
    await operator.click(screen.getByRole('button', { name: /返回账号创建/ }));
    expect(screen.getByLabelText('显示名称')).toHaveValue('Ada Lovelace');
    expect(screen.getByRole('checkbox', { name: /用户协议.*隐私政策/ })).not.toBeChecked();

    await operator.click(screen.getByRole('button', { name: /隐私政策/ }));
    expect(screen.getByRole('heading', { name: 'TaskPilot 隐私政策' })).toBeInTheDocument();
    expect(screen.getByText(/GitHub 的持久数字标识/)).toBeInTheDocument();
    expect(screen.getByText(/来源网络和安装标识/)).toBeInTheDocument();
    await operator.click(screen.getByRole('button', { name: /返回账号创建/ }));
    expect(screen.getByLabelText('显示名称')).toHaveValue('Ada Lovelace');
  });

  it('restores keyboard focus to the legal-document link after returning to registration', async () => {
    const api = signedOutApi();
    vi.mocked(api.auth.startGitHubSignIn).mockResolvedValue({
      status: 'registrationRequired', flowId: 'opaque-flow', suggestedDisplayName: 'Ada', legalBundleVersion: '2026-09-01', termsVersion: 'terms-2026-09-01', privacyVersion: 'privacy-2026-09-01', legalLocales: ['zh-CN', 'en'],
    });
    const operator = userEvent.setup();
    renderApp(api);
    await operator.click(await screen.findByRole('button', { name: '使用 GitHub 登录' }));

    await operator.click(screen.getByRole('button', { name: '《用户协议》' }));
    expect(await screen.findByRole('heading', { name: 'TaskPilot 用户协议' })).toBeInTheDocument();
    await operator.click(screen.getByRole('button', { name: '← 返回账号创建' }));

    expect(await screen.findByRole('heading', { name: '创建 TaskPilot 账号' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '《用户协议》' })).toHaveFocus();
  });

  it('fails closed when the server requires an unknown legal bundle', async () => {
    const api = signedOutApi();
    vi.mocked(api.auth.startGitHubSignIn).mockResolvedValue({
      status: 'registrationRequired', flowId: 'opaque-flow', suggestedDisplayName: 'Ada', legalBundleVersion: 'future-bundle', termsVersion: 'terms-2026-09-01', privacyVersion: 'privacy-2026-09-01', legalLocales: ['zh-CN', 'en'],
    });
    const operator = userEvent.setup();
    renderApp(api);
    await operator.click(await screen.findByRole('button', { name: '使用 GitHub 登录' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('当前协议已更新，请更新 TaskPilot 后继续');
    expect(screen.getByRole('checkbox', { name: /用户协议.*隐私政策/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: '创建 TaskPilot 账号' })).toBeDisabled();
    expect(api.auth.completeGitHubRegistration).not.toHaveBeenCalled();
  });

  it.each([
    ['termsVersion', 'future-terms'],
    ['privacyVersion', 'future-privacy'],
    ['legalLocales', ['en']],
  ])('fails closed when the server legal requirement mismatches %s', async (field, value) => {
    const api = signedOutApi();
    vi.mocked(api.auth.startGitHubSignIn).mockResolvedValue(registrationRequired({ [field]: value }));
    const operator = userEvent.setup();
    renderApp(api);
    await operator.click(await screen.findByRole('button', { name: '使用 GitHub 登录' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('当前协议已更新，请更新 TaskPilot 后继续');
    expect(screen.getByRole('checkbox', { name: /用户协议.*隐私政策/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: '创建 TaskPilot 账号' })).toBeDisabled();
    expect(api.auth.completeGitHubRegistration).not.toHaveBeenCalled();
  });

  it('fails closed in registration when the server rejects a stale legal bundle', async () => {
    const api = signedOutApi();
    vi.mocked(api.auth.startGitHubSignIn).mockResolvedValue(registrationRequired());
    vi.mocked(api.auth.completeGitHubRegistration).mockRejectedValue({
      code: 'LEGAL_BUNDLE_REJECTED', category: 'conflict', path: 'legalBundleVersion', message: 'raw server detail',
    });
    const operator = userEvent.setup();
    renderApp(api);
    await operator.click(await screen.findByRole('button', { name: '使用 GitHub 登录' }));
    const name = await screen.findByLabelText('显示名称');
    await operator.clear(name);
    await operator.type(name, 'Ada Draft');
    await operator.click(screen.getByRole('checkbox', { name: /用户协议.*隐私政策/ }));
    await operator.click(screen.getByRole('button', { name: '创建 TaskPilot 账号' }));

    expect(await screen.findByRole('heading', { name: '创建 TaskPilot 账号' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('当前协议已更新，请更新 TaskPilot 后继续');
    expect(screen.getByLabelText('显示名称')).toHaveValue('Ada Draft');
    expect(screen.getByRole('checkbox', { name: /用户协议.*隐私政策/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: '创建 TaskPilot 账号' })).toBeDisabled();
    expect(screen.queryByRole('heading', { name: '无法完成 GitHub 登录' })).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('raw server detail');
  });

  it('allows registration without an avatar and does not render a broken image choice', async () => {
    const api = signedOutApi();
    vi.mocked(api.auth.startGitHubSignIn).mockResolvedValue({
      status: 'registrationRequired', flowId: 'opaque-flow', suggestedDisplayName: 'Ada', legalBundleVersion: '2026-09-01', termsVersion: 'terms-2026-09-01', privacyVersion: 'privacy-2026-09-01', legalLocales: ['zh-CN', 'en'],
    });
    const operator = userEvent.setup();
    renderApp(api);
    await operator.click(await screen.findByRole('button', { name: '使用 GitHub 登录' }));

    expect(await screen.findByRole('heading', { name: '创建 TaskPilot 账号' })).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /GitHub 头像/ })).not.toBeInTheDocument();
  });

  it('cancels first registration and returns to login methods without an extra restart step', async () => {
    const api = signedOutApi();
    vi.mocked(api.auth.startGitHubSignIn).mockResolvedValue({
      status: 'registrationRequired', flowId: 'opaque-flow', suggestedDisplayName: 'Andy Zhang', legalBundleVersion: '2026-09-01', termsVersion: 'terms-2026-09-01', privacyVersion: 'privacy-2026-09-01', legalLocales: ['zh-CN', 'en'],
    });
    const operator = userEvent.setup();
    renderApp(api);
    await operator.click(await screen.findByRole('button', { name: '使用 GitHub 登录' }));

    expect(await screen.findByLabelText('头像缩写：AZ')).toHaveTextContent('AZ');
    expect(screen.queryByLabelText(/头像缩写：TP/)).not.toBeInTheDocument();
    await operator.click(screen.getByRole('button', { name: '← 返回登录方式' }));

    expect(api.auth.cancelGitHubSignIn).toHaveBeenCalledOnce();
    expect(api.auth.cancelGitHubSignIn).toHaveBeenCalledWith({ flowId: 'opaque-flow' });
    expect(await screen.findByRole('heading', { name: '登录 TaskPilot' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '重新开始' })).not.toBeInTheDocument();
  });

  it('cancels a waiting flow and returns directly to the initial sign-in view', async () => {
    const api = signedOutApi();
    const operator = userEvent.setup();
    renderApp(api);
    await operator.click(await screen.findByRole('button', { name: '使用 GitHub 登录' }));
    await operator.click(await screen.findByRole('button', { name: '取消登录' }));

    expect(api.auth.cancelGitHubSignIn).toHaveBeenCalledWith({ flowId: 'opaque-flow' });
    expect(await screen.findByRole('heading', { name: '登录 TaskPilot' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '使用 GitHub 登录' })).toBeEnabled();
    expect(screen.queryByRole('heading', { name: '已取消 GitHub 登录' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '重新开始' })).not.toBeInTheDocument();
  });

  it.each([
    ['denied', '未完成 GitHub 授权'],
    ['expired', '登录请求已过期'],
    ['resultUnavailable', '登录结果已失效'],
  ] as const)('maps %s to a stable recoverable state', async (status, heading) => {
    const api = signedOutApi();
    vi.mocked(api.auth.startGitHubSignIn).mockResolvedValue({ status, flowId: 'opaque-flow' });
    const operator = userEvent.setup();
    renderApp(api);
    await operator.click(await screen.findByRole('button', { name: '使用 GitHub 登录' }));
    expect(await screen.findByRole('heading', { name: heading })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重新开始' })).toBeEnabled();
  });

  it('maps a lost server-side login context to an expired flow that can restart cleanly', async () => {
    const api = signedOutApi();
    vi.mocked(api.auth.continueGitHubSignIn).mockRejectedValueOnce({
      code: 'FEDERATED_LOGIN_CONTEXT_INVALID', category: 'conflict',
    });
    const operator = userEvent.setup();
    renderApp(api);
    await operator.click(await screen.findByRole('button', { name: '使用 GitHub 登录' }));

    expect(await screen.findByRole('heading', { name: '登录请求已过期' }, { timeout: 2_000 })).toBeInTheDocument();
    await operator.click(screen.getByRole('button', { name: '重新开始' }));

    expect(await screen.findByRole('heading', { name: '登录 TaskPilot' })).toBeInTheDocument();
  });

  it('maps offline and unknown failures by machine fields without exposing messages', async () => {
    const api = signedOutApi();
    vi.mocked(api.auth.startGitHubSignIn).mockRejectedValueOnce({
      code: 'NETWORK_UNAVAILABLE', category: 'temporary', message: 'raw provider detail',
    }).mockRejectedValueOnce({
      code: 'UNEXPECTED_DESKTOP_ERROR', category: 'unknown', message: 'provider-secret-value',
    });
    const operator = userEvent.setup();
    renderApp(api);
    await operator.click(await screen.findByRole('button', { name: '使用 GitHub 登录' }));
    expect(await screen.findByRole('heading', { name: '暂时无法连接' })).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('raw provider detail');
    await operator.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByRole('heading', { name: '无法完成 GitHub 登录' })).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('provider-secret-value');
  });

  it('associates a server validation path with the display-name field', async () => {
    const api = signedOutApi();
    vi.mocked(api.auth.startGitHubSignIn).mockResolvedValue({
      status: 'registrationRequired', flowId: 'opaque-flow', suggestedDisplayName: 'Ada', legalBundleVersion: '2026-09-01', termsVersion: 'terms-2026-09-01', privacyVersion: 'privacy-2026-09-01', legalLocales: ['zh-CN', 'en'],
    });
    vi.mocked(api.auth.completeGitHubRegistration).mockRejectedValue({ code: 'VALIDATION_FAILED', category: 'validation', path: 'displayName' });
    const operator = userEvent.setup();
    renderApp(api);
    await operator.click(await screen.findByRole('button', { name: '使用 GitHub 登录' }));
    await operator.click(await screen.findByRole('checkbox', { name: /我已阅读并同意《用户协议》，并确认已阅读《隐私政策》/ }));
    await operator.click(screen.getByRole('button', { name: '创建 TaskPilot 账号' }));

    const error = await screen.findByRole('alert');
    const name = screen.getByLabelText('显示名称');
    expect(name).toHaveFocus();
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(name).toHaveAttribute('aria-describedby', error.id);
  });
});
