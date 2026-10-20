// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/renderer/App';
import { LocaleProvider } from '../../src/renderer/i18n/locale-context';
import { boardTestApi } from './board-test-api';
import type {
  KeyedResponse,
  PersonalWorkspaceView,
  ProjectHomeView,
  ProjectPage,
  ProjectResponseKey,
  ProjectView,
  SessionView,
  TaskPilotDesktopApi,
} from '../../src/shared/contracts';

const user = { userId: '11111111-1111-4111-8111-111111111111', displayName: 'Ada' };
const workspace: PersonalWorkspaceView = {
  workspaceId: '22222222-2222-4222-8222-222222222222',
  type: 'PERSONAL', role: 'OWNER', createdAt: '2026-10-14T00:00:00Z', updatedAt: '2026-10-14T00:00:00Z',
};
const firstProject: ProjectView = {
  projectId: '33333333-3333-4333-8333-333333333333', workspaceId: workspace.workspaceId,
  name: '我的项目', description: '把重要工作放在这里。', status: 'ACTIVE', version: 0,
  createdAt: '2026-10-14T00:00:00Z', updatedAt: '2026-10-14T00:00:00Z', archivedAt: null,
};
const secondProject: ProjectView = {
  ...firstProject, projectId: '44444444-4444-4444-8444-444444444444', name: '发布准备', description: '',
};
const thirdProject: ProjectView = {
  ...firstProject, projectId: '66666666-6666-4666-8666-666666666666', name: '客户反馈', description: '',
};
const archivedProject: ProjectView = {
  ...firstProject, projectId: '55555555-5555-4555-8555-555555555555', name: '旧版本', status: 'ARCHIVED', archivedAt: '2026-10-14T01:00:00Z', version: 1,
};

const key = (overrides: Partial<ProjectResponseKey> = {}): ProjectResponseKey => ({
  sessionGeneration: 7, userId: user.userId, workspaceId: workspace.workspaceId, ...overrides,
});
const keyed = <T,>(value: T, overrides?: Partial<ProjectResponseKey>): KeyedResponse<T> => ({ key: key(overrides), value });
const home = (projects = [firstProject, secondProject, thirdProject], currentProject: ProjectView | null = firstProject): ProjectHomeView => ({
  workspace, projects, ...(currentProject ? { currentProject } : {}),
});

function authenticatedApi(overrides: Partial<TaskPilotDesktopApi['projects']> = {}) {
  let listener: ((view: SessionView) => void) | undefined;
  const api: TaskPilotDesktopApi = {
    boards: boardTestApi({ sessionGeneration: 7, userId: user.userId, workspaceId: workspace.workspaceId, projectId: firstProject.projectId }),
    auth: {
      getCapabilities: vi.fn().mockResolvedValue({ github: { enabled: true } }), startGitHubSignIn: vi.fn(), continueGitHubSignIn: vi.fn(),
      completeGitHubRegistration: vi.fn(), cancelGitHubSignIn: vi.fn(),
      getSessionView: vi.fn().mockResolvedValue({ status: 'authenticated', currentUser: user }),
      subscribeSessionView: vi.fn((next) => { listener = next; return () => { listener = undefined; }; }),
      logout: vi.fn().mockResolvedValue(undefined),
    },
    workspaces: { list: vi.fn().mockResolvedValue(keyed([workspace])) },
    projects: {
      resolveHome: vi.fn().mockResolvedValue(keyed(home(), { projectId: firstProject.projectId, status: 'ACTIVE' })),
      list: vi.fn().mockResolvedValue(keyed({ items: [archivedProject], nextCursor: null } satisfies ProjectPage, { status: 'ARCHIVED' })),
      open: vi.fn().mockImplementation(({ projectId }) => Promise.resolve(keyed(
        projectId === secondProject.projectId ? secondProject : firstProject, { projectId },
      ))),
      create: vi.fn().mockResolvedValue(keyed(secondProject, { projectId: secondProject.projectId })),
      edit: vi.fn().mockImplementation((input) => Promise.resolve(keyed({
        ...(input.projectId === archivedProject.projectId ? archivedProject : firstProject),
        name: input.name, description: input.description ?? '', version: 2,
      }, { projectId: input.projectId }))),
      archive: vi.fn().mockResolvedValue(keyed({ ...firstProject, status: 'ARCHIVED', archivedAt: '2026-10-14T02:00:00Z', version: 1 }, { projectId: firstProject.projectId })),
      restore: vi.fn().mockResolvedValue(keyed({ ...archivedProject, status: 'ACTIVE', archivedAt: null, version: 2 }, { projectId: archivedProject.projectId })),
      permanentlyDelete: vi.fn().mockResolvedValue(keyed(undefined, { projectId: firstProject.projectId })),
      ...overrides,
    },
  };
  return { api, emitSession: (view: SessionView) => listener?.(view) };
}

function renderApp(api: TaskPilotDesktopApi, locale: 'zh-CN' | 'en' = 'zh-CN') {
  return render(<LocaleProvider initialLanguages={[locale]}><App api={api} /></LocaleProvider>);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

afterEach(() => { cleanup(); window.localStorage.clear(); });

describe('personal Workspace Project home', () => {
  it('lands directly in the selected Project without fake product data', async () => {
    const { api } = authenticatedApi();
    renderApp(api);

    expect(await screen.findByRole('heading', { name: '我的项目' })).toBeInTheDocument();
    expect(screen.getAllByText('个人空间')).not.toHaveLength(0);
    expect(screen.getByText('把重要工作放在这里。')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '新建项目' })).toEqual(expect.arrayContaining([expect.not.objectContaining({ disabled: true })]));
    expect(screen.queryByText(/团队空间|邀请成员|工作项指标|Agent 指标/)).not.toBeInTheDocument();
  });

  it('creates a Project with one request id and edits its real fields', async () => {
    const { api } = authenticatedApi();
    vi.mocked(api.projects.resolveHome).mockResolvedValue(keyed(home([firstProject], firstProject), { projectId: firstProject.projectId, status: 'ACTIVE' }));
    const operator = userEvent.setup();
    renderApp(api);

    await operator.click(await screen.findByRole('button', { name: '新建项目' }));
    await operator.type(screen.getByLabelText('项目名称'), '发布准备');
    await operator.type(screen.getByLabelText('项目描述（可选）'), '发布前检查');
    await operator.click(screen.getByRole('button', { name: '创建项目' }));
    expect(api.projects.create).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: workspace.workspaceId, name: '发布准备', description: '发布前检查', requestId: expect.any(String),
    }));

    await operator.click(await screen.findByRole('button', { name: '项目设置' }));
    const name = screen.getByLabelText('项目名称');
    await operator.clear(name);
    await operator.type(name, '发布上线');
    await operator.click(screen.getByRole('button', { name: '保存更改' }));
    expect(api.projects.edit).toHaveBeenCalledWith(expect.objectContaining({
      projectId: secondProject.projectId, expectedVersion: secondProject.version, name: '发布上线',
    }));
    expect(await screen.findByRole('heading', { name: '发布上线' })).toBeInTheDocument();
  });

  it('archives the current Project, falls back, and restores an archived Project without selecting it', async () => {
    const { api } = authenticatedApi();
    vi.mocked(api.projects.resolveHome)
      .mockResolvedValueOnce(keyed(home(), { projectId: firstProject.projectId, status: 'ACTIVE' }))
      .mockResolvedValueOnce(keyed(home([secondProject], secondProject), { projectId: secondProject.projectId, status: 'ACTIVE' }))
      .mockResolvedValueOnce(keyed(home([secondProject, { ...archivedProject, status: 'ACTIVE', archivedAt: null }], secondProject), { projectId: secondProject.projectId, status: 'ACTIVE' }));
    const operator = userEvent.setup();
    renderApp(api);

    await operator.click(await screen.findByRole('button', { name: '项目设置' }));
    await operator.click(screen.getByRole('button', { name: '归档项目' }));
    expect(await screen.findByRole('heading', { name: '发布准备' })).toBeInTheDocument();

    await operator.click(screen.getByRole('button', { name: '已归档项目' }));
    expect(await screen.findByRole('heading', { name: '已归档项目' })).toBeInTheDocument();
    await operator.click(screen.getByRole('button', { name: '恢复“旧版本”' }));
    expect(api.projects.restore).toHaveBeenCalledWith(expect.objectContaining({ projectId: archivedProject.projectId, expectedVersion: 1 }));
    expect(screen.getByText('当前项目：发布准备')).toBeInTheDocument();
  });

  it('loads every archived Project page before presenting the archive', async () => {
    const laterArchivedProject: ProjectView = {
      ...archivedProject,
      projectId: '66666666-6666-4666-8666-666666666666',
      name: '更早版本',
    };
    const { api } = authenticatedApi();
    vi.mocked(api.projects.list)
      .mockResolvedValueOnce(keyed({ items: [archivedProject], nextCursor: 'next-archived-page' }, { status: 'ARCHIVED' }))
      .mockResolvedValueOnce(keyed({ items: [laterArchivedProject], nextCursor: null }, { status: 'ARCHIVED' }));
    const operator = userEvent.setup();
    renderApp(api);

    await operator.click(await screen.findByRole('button', { name: '已归档项目' }));

    expect(await screen.findByText('旧版本')).toBeInTheDocument();
    expect(screen.getByText('更早版本')).toBeInTheDocument();
    expect(api.projects.list).toHaveBeenNthCalledWith(2, {
      workspaceId: workspace.workspaceId, status: 'ARCHIVED', limit: 50, cursor: 'next-archived-page',
    });
  });

  it('requires the exact current name before permanently deleting the last Project', async () => {
    const { api } = authenticatedApi();
    vi.mocked(api.projects.resolveHome)
      .mockResolvedValueOnce(keyed(home([firstProject], firstProject), { projectId: firstProject.projectId, status: 'ACTIVE' }))
      .mockResolvedValueOnce(keyed(home([], null), { status: 'ACTIVE' }));
    const operator = userEvent.setup();
    renderApp(api);

    await operator.click(await screen.findByRole('button', { name: '项目设置' }));
    await operator.click(screen.getByRole('button', { name: '永久删除项目' }));
    const confirm = screen.getByLabelText('输入“我的项目”以确认');
    expect(screen.getByRole('button', { name: '永久删除' })).toBeDisabled();
    await operator.type(confirm, '我的项目');
    await operator.click(screen.getByRole('button', { name: '永久删除' }));

    expect(api.projects.permanentlyDelete).toHaveBeenCalledWith({
      workspaceId: workspace.workspaceId, projectId: firstProject.projectId,
      expectedVersion: firstProject.version, confirmationName: firstProject.name,
    });
    expect(await screen.findByRole('heading', { name: '还没有项目' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '新建项目' })).toEqual(expect.arrayContaining([expect.not.objectContaining({ disabled: true })]));
  });

  it('shows a retryable load error instead of an empty state', async () => {
    const { api } = authenticatedApi();
    vi.mocked(api.projects.resolveHome)
      .mockRejectedValueOnce({ code: 'PROJECTS_TEMPORARILY_UNAVAILABLE', category: 'temporary', recovery: 'RETRY' })
      .mockResolvedValueOnce(keyed(home(), { projectId: firstProject.projectId, status: 'ACTIVE' }));
    const operator = userEvent.setup();
    renderApp(api);

    expect(await screen.findByRole('alert')).toHaveTextContent('暂时无法加载项目');
    expect(screen.queryByRole('heading', { name: '还没有项目' })).not.toBeInTheDocument();
    await operator.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByRole('heading', { name: '我的项目' })).toBeInTheDocument();
  });

  it('keeps retry and sign-out recovery available when Project loading continues to fail', async () => {
    const { api, emitSession } = authenticatedApi();
    vi.mocked(api.projects.resolveHome).mockRejectedValue({
      code: 'PROJECTS_TEMPORARILY_UNAVAILABLE', category: 'temporary', recovery: 'RETRY',
    });
    vi.mocked(api.auth.logout).mockImplementation(async () => emitSession({ status: 'signedOut' }));
    const operator = userEvent.setup();
    renderApp(api);

    expect(await screen.findByRole('button', { name: '退出并返回登录' })).toBeEnabled();
    await operator.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByRole('button', { name: '退出并返回登录' })).toBeEnabled();
    await operator.click(screen.getByRole('button', { name: '退出并返回登录' }));
    expect(api.auth.logout).toHaveBeenCalledOnce();
    expect(await screen.findByRole('heading', { name: '登录 TaskPilot' })).toBeInTheDocument();
  });

  it('drops a response from another session generation and clears protected content on sign-out', async () => {
    const stale = deferred<KeyedResponse<ProjectView>>();
    const { api, emitSession } = authenticatedApi({ open: vi.fn().mockReturnValue(stale.promise) });
    const operator = userEvent.setup();
    renderApp(api);

    await operator.click(await screen.findByRole('button', { name: '发布准备' }));
    stale.resolve(keyed(secondProject, { sessionGeneration: 8, projectId: secondProject.projectId }));
    await waitFor(() => expect(screen.getByRole('heading', { name: '我的项目' })).toBeInTheDocument());
    expect(screen.queryByRole('heading', { name: '发布准备' })).not.toBeInTheDocument();

    emitSession({ status: 'signedOut' });
    expect(await screen.findByRole('heading', { name: '登录 TaskPilot' })).toBeInTheDocument();
    expect(screen.queryByText('把重要工作放在这里。')).not.toBeInTheDocument();
  });


  it('keeps the latest Project selection when open responses arrive out of order', async () => {
    const second = deferred<KeyedResponse<ProjectView>>();
    const third = deferred<KeyedResponse<ProjectView>>();
    const { api } = authenticatedApi({ open: vi.fn(({ projectId }) => projectId === secondProject.projectId ? second.promise : third.promise) });
    const operator = userEvent.setup();
    renderApp(api);

    await operator.click(await screen.findByRole('button', { name: '发布准备' }));
    await operator.click(screen.getByRole('button', { name: '客户反馈' }));
    third.resolve(keyed(thirdProject, { projectId: thirdProject.projectId }));
    expect(await screen.findByRole('heading', { name: '客户反馈' })).toBeInTheDocument();

    second.resolve(keyed(secondProject, { projectId: secondProject.projectId }));
    await waitFor(() => expect(screen.getByRole('heading', { name: '客户反馈' })).toBeInTheDocument());
    expect(screen.queryByRole('heading', { name: '发布准备' })).not.toBeInTheDocument();
  });

  it('keeps the latest archived list when requests arrive out of order', async () => {
    const older = deferred<KeyedResponse<ProjectPage>>();
    const latest = deferred<KeyedResponse<ProjectPage>>();
    const latestArchived = { ...archivedProject, projectId: '77777777-7777-4777-8777-777777777777', name: '最新归档结果' };
    const { api } = authenticatedApi({ list: vi.fn().mockReturnValueOnce(older.promise).mockReturnValueOnce(latest.promise) });
    const operator = userEvent.setup();
    renderApp(api);

    const archivedButton = await screen.findByRole('button', { name: '已归档项目' });
    await operator.click(archivedButton);
    await operator.click(archivedButton);
    latest.resolve(keyed({ items: [latestArchived], nextCursor: null }, { status: 'ARCHIVED' }));
    expect(await screen.findByText('最新归档结果')).toBeInTheDocument();

    older.resolve(keyed({ items: [archivedProject], nextCursor: null }, { status: 'ARCHIVED' }));
    await waitFor(() => expect(screen.getByText('最新归档结果')).toBeInTheDocument());
    expect(screen.queryByText('旧版本')).not.toBeInTheDocument();
  });

  it('reuses a create request id only while the normalized payload is unchanged', async () => {
    const { api } = authenticatedApi({ create: vi.fn().mockRejectedValue(new Error('response lost')) });
    const operator = userEvent.setup();
    renderApp(api);

    await operator.click((await screen.findAllByRole('button', { name: '新建项目' }))[0]!);
    const name = screen.getByLabelText('项目名称');
    await operator.type(name, '发布准备');
    await operator.click(screen.getByRole('button', { name: '创建项目' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    const firstId = vi.mocked(api.projects.create).mock.calls[0]![0].requestId;

    await operator.clear(name);
    await operator.type(name, '  发布准备  ');
    await operator.click(screen.getByRole('button', { name: '创建项目' }));
    await waitFor(() => expect(api.projects.create).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.projects.create).mock.calls[1]![0]).toMatchObject({
      requestId: firstId, name: '发布准备', description: '',
    });

    await operator.type(name, 'v2');
    await operator.click(screen.getByRole('button', { name: '创建项目' }));
    await waitFor(() => expect(api.projects.create).toHaveBeenCalledTimes(3));
    expect(vi.mocked(api.projects.create).mock.calls[2]![0].requestId).not.toBe(firstId);
  });

  it('validates Project field limits by Unicode code point and reports overflow accessibly', async () => {
    const { api } = authenticatedApi();
    const operator = userEvent.setup();
    renderApp(api);

    await operator.click((await screen.findAllByRole('button', { name: '新建项目' }))[0]!);
    const name = screen.getByLabelText('项目名称');
    expect(name).not.toHaveAttribute('maxlength');
    fireEvent.change(name, { target: { value: '😀'.repeat(200) } });
    expect(name).toHaveValue('😀'.repeat(200));
    expect(screen.getByRole('button', { name: '创建项目' })).toBeEnabled();

    fireEvent.change(name, { target: { value: '😀'.repeat(201) } });
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(await screen.findByRole('alert')).toHaveTextContent('项目名称最多 200 个字符');
    expect(screen.getByRole('button', { name: '创建项目' })).toBeDisabled();

    fireEvent.change(name, { target: { value: '可用项目' } });
    const description = screen.getByLabelText('项目描述（可选）');
    expect(description).not.toHaveAttribute('maxlength');
    fireEvent.change(description, { target: { value: '😀'.repeat(2001) } });
    expect(description).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('项目描述最多 2000 个字符');
    expect(screen.getByRole('button', { name: '创建项目' })).toBeDisabled();
  });

  it('keeps the archived list visible and reports a restore failure', async () => {
    const { api } = authenticatedApi({ restore: vi.fn().mockRejectedValue(new Error('offline')) });
    const operator = userEvent.setup();
    renderApp(api);

    await operator.click(await screen.findByRole('button', { name: '已归档项目' }));
    await operator.click(await screen.findByRole('button', { name: '恢复“旧版本”' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('未能恢复项目，请重试');
    expect(screen.getByText('旧版本')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '恢复“旧版本”' })).toBeEnabled();
  });

  it('keeps language and logout reachable from the account menu', async () => {
    const { api } = authenticatedApi();
    const operator = userEvent.setup();
    renderApp(api);

    await operator.click(await screen.findByRole('button', { name: '打开账号菜单' }));
    await operator.click(screen.getByRole('combobox', { name: '语言' }));
    await operator.click(screen.getByRole('option', { name: 'English' }));
    expect(screen.getAllByText('Personal space')).not.toHaveLength(0);
    await operator.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(api.auth.logout).toHaveBeenCalledOnce();
  });
});
