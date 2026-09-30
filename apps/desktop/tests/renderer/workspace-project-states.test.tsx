// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/renderer/App';
import type { ProjectPage, SessionView, TaskPilotDesktopApi, WorkspaceList } from '../../src/shared/contracts';

const user = { userId: '11111111-1111-4111-8111-111111111111', displayName: 'Ada', email: 'ada@example.com' };
const one = { workspaceId: '22222222-2222-4222-8222-222222222222', name: 'One', type: 'ORGANIZATION' as const };
const two = { workspaceId: '33333333-3333-4333-8333-333333333333', name: 'Two', type: 'ORGANIZATION' as const };
const project = { projectId: '44444444-4444-4444-8444-444444444444', workspaceId: one.workspaceId, name: 'Launch' };
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function apiFor(list: WorkspaceList, restore: string | undefined = undefined): TaskPilotDesktopApi {
  const authenticated: SessionView = { status: 'authenticated', currentUser: user };
  return {
    auth: {
      getSessionView: vi.fn().mockResolvedValue(authenticated), subscribeSessionView: vi.fn().mockReturnValue(() => undefined), logout: vi.fn().mockResolvedValue(undefined),
      signInWithPassword: vi.fn(), requestLoginCode: vi.fn(), verifyLoginCode: vi.fn(), requestRegistrationCode: vi.fn(), verifyRegistrationCode: vi.fn(), register: vi.fn(),
      requestPasswordResetCode: vi.fn(), verifyPasswordResetCode: vi.fn(), resetPassword: vi.fn(),
    },
    workspaces: {
      listWorkspaces: vi.fn().mockResolvedValue(list), createWorkspace: vi.fn(), restoreActiveWorkspace: vi.fn().mockResolvedValue({ workspaceId: restore }),
      selectWorkspace: vi.fn().mockResolvedValue(undefined), clearActiveWorkspace: vi.fn().mockResolvedValue(undefined),
    },
    projects: { listProjects: vi.fn().mockResolvedValue({ items: [] }) },
  };
}
afterEach(cleanup);

describe('active Workspace recovery', () => {
  it('auto-selects the sole Workspace and opens its real Project list', async () => {
    const api = apiFor({ items: [one], capabilities: { canCreateWorkspace: true } });
    render(<App api={api} />);
    expect(await screen.findByRole('heading', { name: '这里还没有可访问的项目' })).toBeInTheDocument();
    expect(api.workspaces.selectWorkspace).toHaveBeenCalledWith({ workspaceId: one.workspaceId });
    expect(api.projects.listProjects).toHaveBeenCalledWith({ workspaceId: one.workspaceId, limit: 50, cursor: undefined });
  });
  it('restores an authorized recent Workspace among many', async () => {
    const api = apiFor({ items: [one, two], capabilities: { canCreateWorkspace: true } }, two.workspaceId);
    render(<App api={api} />);
    await waitFor(() => expect(api.projects.listProjects).toHaveBeenCalledWith({ workspaceId: two.workspaceId, limit: 50, cursor: undefined }));
    expect(screen.getByText('Two')).toBeInTheDocument();
  });
  it('shows the chooser when a remembered Workspace is no longer authorized', async () => {
    const api = apiFor({ items: [one, two], capabilities: { canCreateWorkspace: true } });
    render(<App api={api} />);
    expect(await screen.findByRole('heading', { name: '选择一个 Workspace' })).toBeInTheDocument();
    expect(api.projects.listProjects).not.toHaveBeenCalled();
  });
});

describe('Workspace request scope guards', () => {
  it('discards an old account Workspace list that resolves after the new account list', async () => {
    const oldList = deferred<WorkspaceList>();
    const api = apiFor({ items: [], capabilities: { canCreateWorkspace: true } });
    let publishSession!: (view: SessionView) => void;
    vi.mocked(api.auth.subscribeSessionView).mockImplementation((listener) => { publishSession = listener; return () => undefined; });
    vi.mocked(api.workspaces.listWorkspaces)
      .mockReturnValueOnce(oldList.promise)
      .mockResolvedValue({ items: [two], capabilities: { canCreateWorkspace: true } });
    render(<App api={api} />);
    await waitFor(() => expect(api.workspaces.listWorkspaces).toHaveBeenCalledOnce());

    publishSession({ status: 'authenticated', currentUser: { ...user, userId: '66666666-6666-4666-8666-666666666666', displayName: 'Grace' } });
    expect(await screen.findByText('Two')).toBeInTheDocument();
    oldList.resolve({ items: [one], capabilities: { canCreateWorkspace: true } });
    await Promise.resolve();
    expect(screen.queryByText('One')).not.toBeInTheDocument();
    expect(screen.getByText('Two')).toBeInTheDocument();
  });

  it('isolates an old environment Workspace response when the Desktop API scope changes', async () => {
    const oldList = deferred<WorkspaceList>();
    const oldApi = apiFor({ items: [], capabilities: { canCreateWorkspace: true } });
    vi.mocked(oldApi.workspaces.listWorkspaces).mockReturnValue(oldList.promise);
    const newApi = apiFor({ items: [two], capabilities: { canCreateWorkspace: true } });
    const view = render(<App api={oldApi} />);
    await waitFor(() => expect(oldApi.workspaces.listWorkspaces).toHaveBeenCalledOnce());

    view.rerender(<App api={newApi} />);
    expect(await screen.findByText('Two')).toBeInTheDocument();
    oldList.resolve({ items: [one], capabilities: { canCreateWorkspace: true } });
    await Promise.resolve();
    expect(screen.queryByText('One')).not.toBeInTheDocument();
    expect(screen.getByText('Two')).toBeInTheDocument();
  });
});

describe('Project list state and scope guards', () => {
  it('renders data and paginates once despite duplicate load-more activation', async () => {
    const api = apiFor({ items: [one], capabilities: { canCreateWorkspace: true } });
    vi.mocked(api.projects.listProjects)
      .mockResolvedValueOnce({ items: [project], nextCursor: 'opaque.next' })
      .mockResolvedValueOnce({ items: [{ ...project, projectId: '55555555-5555-4555-8555-555555555555', name: 'Follow-up' }] });
    const operator = userEvent.setup();
    render(<App api={api} />);
    expect(await screen.findByText('Launch')).toBeInTheDocument();
    const more = screen.getByRole('button', { name: '加载更多' });
    await Promise.all([operator.click(more), operator.click(more)]);
    expect(await screen.findByText('Follow-up')).toBeInTheDocument();
    expect(api.projects.listProjects).toHaveBeenCalledTimes(2);
    expect(api.projects.listProjects).toHaveBeenLastCalledWith({ workspaceId: one.workspaceId, cursor: 'opaque.next', limit: 50 });
  });
  it('discards a late Project page after switching back to the Workspace chooser', async () => {
    const pending = deferred<ProjectPage>();
    const api = apiFor({ items: [one, two], capabilities: { canCreateWorkspace: true } }, one.workspaceId);
    vi.mocked(api.projects.listProjects).mockReturnValue(pending.promise);
    const operator = userEvent.setup();
    render(<App api={api} />);
    await operator.click(await screen.findByRole('button', { name: '切换 Workspace' }));
    expect(await screen.findByRole('heading', { name: '选择一个 Workspace' })).toBeInTheDocument();
    pending.resolve({ items: [project] });
    await Promise.resolve();
    expect(screen.queryByText('Launch')).not.toBeInTheDocument();
  });

  it('discards a late Project page from Workspace A after selecting Workspace B', async () => {
    const pendingA = deferred<ProjectPage>();
    const api = apiFor({ items: [one, two], capabilities: { canCreateWorkspace: true } }, one.workspaceId);
    vi.mocked(api.projects.listProjects)
      .mockReturnValueOnce(pendingA.promise)
      .mockResolvedValueOnce({ items: [{ ...project, projectId: '55555555-5555-4555-8555-555555555555', workspaceId: two.workspaceId, name: 'Workspace B project' }] });
    const operator = userEvent.setup();
    render(<App api={api} />);
    await operator.click(await screen.findByRole('button', { name: '切换 Workspace' }));
    await operator.click(screen.getByRole('button', { name: /Two/ }));
    expect(await screen.findByText('Workspace B project')).toBeInTheDocument();
    pendingA.resolve({ items: [project] });
    await Promise.resolve();
    expect(screen.queryByText('Launch')).not.toBeInTheDocument();
  });

  it('clears the old account Project state before loading the new account scope', async () => {
    const api = apiFor({ items: [one], capabilities: { canCreateWorkspace: true } });
    let publishSession!: (view: SessionView) => void;
    vi.mocked(api.auth.subscribeSessionView).mockImplementation((listener) => { publishSession = listener; return () => undefined; });
    const nextPage = deferred<ProjectPage>();
    vi.mocked(api.projects.listProjects)
      .mockResolvedValueOnce({ items: [project] })
      .mockReturnValueOnce(nextPage.promise);
    render(<App api={api} />);
    expect(await screen.findByText('Launch')).toBeInTheDocument();

    publishSession({ status: 'authenticated', currentUser: { ...user, userId: '66666666-6666-4666-8666-666666666666', displayName: 'Grace' } });

    expect(await screen.findByRole('status')).toHaveTextContent('正在加载');
    expect(screen.queryByText('Launch')).not.toBeInTheDocument();
    await waitFor(() => expect(api.projects.listProjects).toHaveBeenCalledTimes(2));
    nextPage.resolve({ items: [] });
  });

  it('shows a recoverable state for invalid Project list input', async () => {
    const api = apiFor({ items: [one], capabilities: { canCreateWorkspace: true } });
    vi.mocked(api.projects.listProjects).mockRejectedValue(Object.assign(new Error('invalid'), { code: 'VALIDATION_FAILED' }));
    render(<App api={api} />);
    expect(await screen.findByRole('heading', { name: '无法加载项目' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('请检查填写的信息');
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument();
  });

  it('clears an invalid active Workspace and reloads the authoritative list on 404', async () => {
    const api = apiFor({ items: [one], capabilities: { canCreateWorkspace: true } });
    vi.mocked(api.projects.listProjects).mockRejectedValue(Object.assign(new Error('gone'), { code: 'WORKSPACE_NOT_FOUND' }));
    render(<App api={api} />);
    await waitFor(() => expect(api.workspaces.clearActiveWorkspace).toHaveBeenCalledOnce());
    expect(api.workspaces.listWorkspaces).toHaveBeenCalledTimes(2);
  });
  it('shows a safe retry state for temporary failures', async () => {
    const api = apiFor({ items: [one], capabilities: { canCreateWorkspace: true } });
    vi.mocked(api.projects.listProjects).mockRejectedValue(Object.assign(new Error('down'), { code: 'PROJECTS_TEMPORARILY_UNAVAILABLE' }));
    render(<App api={api} />);
    expect(await screen.findByRole('heading', { name: '无法加载项目' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument();
  });
});
