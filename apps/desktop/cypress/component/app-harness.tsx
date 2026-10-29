import { App } from '../../src/renderer/app/App';
import { LocaleProvider } from '../../src/renderer/i18n/locale-context';
import type { BoardResponseKey, BoardView, FederatedAuthFlowView, PersonalWorkspaceView, ProjectResponseKey, ProjectView, SessionView, TaskPilotDesktopApi, WorkItemView } from '../../src/shared/contracts';

export const user = { userId: '11111111-1111-4111-8111-111111111111', displayName: 'Ada' };
const waiting: FederatedAuthFlowView = {
  status: 'waiting', flowId: 'opaque-flow', expiresAt: '2030-01-01T00:00:00Z',
};

export const workspace: PersonalWorkspaceView = {
  workspaceId: '22222222-2222-4222-8222-222222222222', type: 'PERSONAL', role: 'OWNER',
  createdAt: '2026-10-14T00:00:00Z', updatedAt: '2026-10-14T00:00:00Z',
};
export const project: ProjectView = {
  projectId: '33333333-3333-4333-8333-333333333333', workspaceId: workspace.workspaceId,
  name: '我的项目', description: '把重要工作放在这里。', status: 'ACTIVE', version: 0,
  createdAt: '2026-10-14T00:00:00Z', updatedAt: '2026-10-14T00:00:00Z', archivedAt: null,
};
export const archivedProject: ProjectView = {
  ...project, projectId: '44444444-4444-4444-8444-444444444444', name: '旧版本', status: 'ARCHIVED', archivedAt: '2026-10-14T01:00:00Z', version: 1,
};
export const board: BoardView = {
  boardId: '55555555-5555-4555-8555-555555555555', projectId: project.projectId,
  name: '工作看板', description: '', version: 0,
  createdAt: '2026-10-14T00:00:00Z', updatedAt: '2026-10-14T00:00:00Z',
  columns: [{
    columnId: '66666666-6666-4666-8666-666666666666', name: '待处理', position: 0, version: 0,
    createdAt: '2026-10-14T00:00:00Z', updatedAt: '2026-10-14T00:00:00Z', cards: [],
  }],
};
export const boardSummary = { boardId: board.boardId, projectId: board.projectId, name: board.name, description: board.description, version: board.version, createdAt: board.createdAt, updatedAt: board.updatedAt };
export const projectKey = (overrides: Partial<ProjectResponseKey> = {}): ProjectResponseKey => ({
  sessionGeneration: 1, userId: user.userId, workspaceId: workspace.workspaceId, ...overrides,
});
export const boardKey = (overrides: Partial<BoardResponseKey> = {}): BoardResponseKey => ({
  ...projectKey({ projectId: project.projectId }), boardId: board.boardId, boardGeneration: 0, ...overrides,
});
const workItem = (title: string): WorkItemView => ({
  workItemId: '77777777-7777-4777-8777-777777777777', projectId: project.projectId, title, description: '',
  version: 0, createdAt: board.createdAt, updatedAt: board.updatedAt,
});

export function apiFor(session: SessionView = { status: 'signedOut' }): TaskPilotDesktopApi {
  return {
    auth: {
      getCapabilities: cy.stub().resolves({ github: { enabled: true } }),
      startGitHubSignIn: cy.stub().resolves(waiting),
      continueGitHubSignIn: cy.stub().resolves(waiting),
      completeGitHubRegistration: cy.stub().resolves({ status: 'authenticated', currentUser: user }),
      cancelGitHubSignIn: cy.stub().resolves(),
      getSessionView: cy.stub().resolves(session),
      subscribeSessionView: cy.stub().returns(() => undefined),
      logout: cy.stub().resolves(),
    },
    workspaces: { list: cy.stub().resolves({ key: projectKey(), value: [workspace] }) },
    projects: {
      resolveHome: cy.stub().resolves({ key: projectKey({ projectId: project.projectId, status: 'ACTIVE' }), value: { workspace, projects: [project], currentProject: project } }),
      list: cy.stub().resolves({ key: projectKey({ status: 'ARCHIVED' }), value: { items: [archivedProject], nextCursor: null } }),
      open: cy.stub().resolves({ key: projectKey({ projectId: project.projectId }), value: project }),
      create: cy.stub().resolves({ key: projectKey({ projectId: project.projectId }), value: project }),
      edit: cy.stub().resolves({ key: projectKey({ projectId: project.projectId }), value: project }),
      archive: cy.stub().resolves({ key: projectKey({ projectId: project.projectId }), value: { ...project, status: 'ARCHIVED' } }),
      restore: cy.stub().resolves({ key: projectKey({ projectId: archivedProject.projectId }), value: { ...archivedProject, status: 'ACTIVE', archivedAt: null } }),
      permanentlyDelete: cy.stub().resolves({ key: projectKey({ projectId: project.projectId }), value: undefined }),
    },
    boards: {
      resolveHome: cy.stub().resolves({ key: boardKey(), value: { boards: [boardSummary], currentBoard: board } }),
      list: cy.stub().resolves({ key: boardKey(), value: [boardSummary] }),
      open: cy.stub().resolves({ key: boardKey(), value: board }),
      create: cy.stub().resolves({ key: boardKey(), value: board }),
      edit: cy.stub().resolves({ key: boardKey(), value: board }),
      createColumn: cy.stub().resolves({ key: boardKey(), value: board }),
      editColumn: cy.stub().resolves({ key: boardKey(), value: board }),
      reorderColumns: cy.stub().resolves({ key: boardKey(), value: board }),
      deleteColumn: cy.stub().resolves({ key: boardKey(), value: undefined }),
      createWorkItem: cy.stub().resolves({ key: boardKey(), value: { workItem: workItem('新工作项'), board } }),
      openWorkItem: cy.stub().resolves({ key: boardKey(), value: workItem('新工作项') }),
      editWorkItem: cy.stub().resolves({ key: boardKey(), value: workItem('更新后的工作项') }),
      moveCard: cy.stub().resolves({ key: boardKey(), value: board }),
    },
  };
}


export function mountApp(api: TaskPilotDesktopApi, locale: 'zh-CN' | 'en' = 'zh-CN') {
  cy.mount(<LocaleProvider initialLanguages={[locale]}><App api={api} /></LocaleProvider>);
}
