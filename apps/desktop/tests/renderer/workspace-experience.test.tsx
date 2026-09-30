// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/renderer/App';
import type { SessionView, TaskPilotDesktopApi, WorkspaceList } from '../../src/shared/contracts';

const user = { userId: '11111111-1111-4111-8111-111111111111', displayName: 'Ada', email: 'ada@example.com' };
const workspace = { workspaceId: '22222222-2222-4222-8222-222222222222', name: 'North Star', type: 'ORGANIZATION' as const };

function apiFor(list: WorkspaceList): TaskPilotDesktopApi {
  const authenticated: SessionView = { status: 'authenticated', currentUser: user };
  return {
    auth: {
      getSessionView: vi.fn().mockResolvedValue(authenticated),
      subscribeSessionView: vi.fn().mockReturnValue(() => undefined),
      logout: vi.fn().mockResolvedValue(undefined),
      signInWithPassword: vi.fn(), requestLoginCode: vi.fn(), verifyLoginCode: vi.fn(),
      requestRegistrationCode: vi.fn(), verifyRegistrationCode: vi.fn(), register: vi.fn(),
      requestPasswordResetCode: vi.fn(), verifyPasswordResetCode: vi.fn(), resetPassword: vi.fn(),
    },
    workspaces: {
      listWorkspaces: vi.fn().mockResolvedValue(list),
      createWorkspace: vi.fn(),
      restoreActiveWorkspace: vi.fn().mockResolvedValue({}),
      selectWorkspace: vi.fn().mockResolvedValue(undefined),
      clearActiveWorkspace: vi.fn().mockResolvedValue(undefined),
    },
    projects: { listProjects: vi.fn().mockResolvedValue({ items: [] }) },
  };
}

afterEach(cleanup);

describe('Workspace onboarding and Project list', () => {
  it('does not expose Workspace creation when the authoritative list capability denies it', async () => {
    const api = apiFor({ items: [], capabilities: { canCreateWorkspace: false, createWorkspaceReasonCode: 'PLAN_LIMIT_REACHED' } });
    render(<App api={api} />);
    expect(await screen.findByRole('heading', { name: '选择一个 Workspace' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '创建 Workspace' })).not.toBeInTheDocument();
    expect(screen.getByText(/Workspace 上限|无法创建新的 Workspace/)).toBeInTheDocument();
  });

  it('keeps the same creationRequestId and input when an unknown outcome is retried', async () => {
    const api = apiFor({ items: [], capabilities: { canCreateWorkspace: true } });
    vi.mocked(api.workspaces.createWorkspace)
      .mockRejectedValueOnce(Object.assign(new Error('unknown'), { code: 'WORKSPACE_RESULT_UNKNOWN' }))
      .mockResolvedValueOnce(workspace);
    render(<App api={api} />);
    const operator = userEvent.setup();
    await operator.type(await screen.findByLabelText('Workspace 名称'), 'North Star');
    await operator.click(screen.getByRole('button', { name: '创建 Workspace' }));
    expect(await screen.findByText(/无法确认 Workspace 是否创建成功/)).toBeInTheDocument();
    await operator.click(screen.getByRole('button', { name: '重试创建' }));
    await waitFor(() => expect(api.workspaces.createWorkspace).toHaveBeenCalledTimes(2));
    const first = vi.mocked(api.workspaces.createWorkspace).mock.calls[0][0];
    const second = vi.mocked(api.workspaces.createWorkspace).mock.calls[1][0];
    expect(first).toEqual(second);
    expect(first.name).toBe('North Star');
  });


  it('rejects a blank Workspace name locally and restores focus', async () => {
    const api = apiFor({ items: [], capabilities: { canCreateWorkspace: true } });
    const operator = userEvent.setup();
    render(<App api={api} />);
    const name = await screen.findByLabelText('Workspace 名称');
    await operator.type(name, '   ');
    await operator.click(screen.getByRole('button', { name: '创建 Workspace' }));
    expect(api.workspaces.createWorkspace).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Workspace 名称不能为空');
    expect(name).toHaveFocus();
  });

  it('offers an explicit retry when the Workspace list is temporarily unavailable', async () => {
    const api = apiFor({ items: [], capabilities: { canCreateWorkspace: true } });
    vi.mocked(api.workspaces.listWorkspaces)
      .mockRejectedValueOnce(Object.assign(new Error('offline'), { code: 'WORKSPACE_TEMPORARILY_UNAVAILABLE' }))
      .mockResolvedValueOnce({ items: [], capabilities: { canCreateWorkspace: true } });
    const operator = userEvent.setup();
    render(<App api={api} />);
    expect(await screen.findByRole('heading', { name: '无法加载 Workspace' })).toBeInTheDocument();
    await operator.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByRole('heading', { name: '选择一个 Workspace' })).toBeInTheDocument();
    expect(api.workspaces.listWorkspaces).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['WORKSPACE_CREATION_NOT_ALLOWED', '当前账号无法创建 Workspace'],
    ['IDEMPOTENCY_KEY_REUSED', '创建信息已改变'],
    ['WORKSPACE_TEMPORARILY_UNAVAILABLE', 'Workspace 暂时无法创建'],
    ['NETWORK_UNAVAILABLE', '暂时无法连接'],
  ])('preserves the entered name for recoverable create error %s', async (code, message) => {
    const api = apiFor({ items: [], capabilities: { canCreateWorkspace: true } });
    vi.mocked(api.workspaces.createWorkspace).mockRejectedValue(Object.assign(new Error('safe'), { code }));
    const operator = userEvent.setup();
    render(<App api={api} />);
    const name = await screen.findByLabelText('Workspace 名称');
    await operator.type(name, 'North Star');
    await operator.click(screen.getByRole('button', { name: '创建 Workspace' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(name).toHaveValue('North Star');
  });

  it('refreshes the authoritative list and hands a successful create to Project loading', async () => {
    const api = apiFor({ items: [], capabilities: { canCreateWorkspace: true } });
    vi.mocked(api.workspaces.listWorkspaces)
      .mockResolvedValueOnce({ items: [], capabilities: { canCreateWorkspace: true } })
      .mockResolvedValueOnce({ items: [workspace], capabilities: { canCreateWorkspace: true } });
    vi.mocked(api.workspaces.createWorkspace).mockResolvedValue(workspace);
    vi.mocked(api.projects.listProjects).mockReturnValue(new Promise(() => undefined));
    const operator = userEvent.setup();
    render(<App api={api} />);
    await operator.type(await screen.findByLabelText('Workspace 名称'), 'North Star');
    await operator.click(screen.getByRole('button', { name: '创建 Workspace' }));
    expect(await screen.findByRole('status')).toHaveTextContent('正在加载项目');
    expect(api.workspaces.listWorkspaces).toHaveBeenCalledTimes(2);
    expect(api.workspaces.selectWorkspace).toHaveBeenCalledWith({ workspaceId: workspace.workspaceId });
  });

  it('shows a real empty Project state without a Project creation CTA or promise', async () => {
    const api = apiFor({ items: [workspace], capabilities: { canCreateWorkspace: true } });
    render(<App api={api} />);
    expect(await screen.findByRole('heading', { name: '这里还没有可访问的项目' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /创建.*项目|Create Project/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/项目创建将在后续版本提供/)).not.toBeInTheDocument();
  });
});
