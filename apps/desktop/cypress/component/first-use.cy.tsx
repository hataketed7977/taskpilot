import { App } from '../../src/renderer/App';
import { LocaleProvider } from '../../src/renderer/i18n/locale-context';
import type { BoardResponseKey, BoardView, FederatedAuthFlowView, PersonalWorkspaceView, ProjectResponseKey, ProjectView, SessionView, TaskPilotDesktopApi, WorkItemView } from '../../src/shared/contracts';

const user = { userId: '11111111-1111-4111-8111-111111111111', displayName: 'Ada' };
const waiting: FederatedAuthFlowView = {
  status: 'waiting', flowId: 'opaque-flow', expiresAt: '2030-01-01T00:00:00Z',
};

const workspace: PersonalWorkspaceView = {
  workspaceId: '22222222-2222-4222-8222-222222222222', type: 'PERSONAL', role: 'OWNER',
  createdAt: '2026-10-14T00:00:00Z', updatedAt: '2026-10-14T00:00:00Z',
};
const project: ProjectView = {
  projectId: '33333333-3333-4333-8333-333333333333', workspaceId: workspace.workspaceId,
  name: '我的项目', description: '把重要工作放在这里。', status: 'ACTIVE', version: 0,
  createdAt: '2026-10-14T00:00:00Z', updatedAt: '2026-10-14T00:00:00Z', archivedAt: null,
};
const archivedProject: ProjectView = {
  ...project, projectId: '44444444-4444-4444-8444-444444444444', name: '旧版本', status: 'ARCHIVED', archivedAt: '2026-10-14T01:00:00Z', version: 1,
};
const board: BoardView = {
  boardId: '55555555-5555-4555-8555-555555555555', projectId: project.projectId,
  name: '工作看板', description: '', version: 0,
  createdAt: '2026-10-14T00:00:00Z', updatedAt: '2026-10-14T00:00:00Z',
  columns: [{
    columnId: '66666666-6666-4666-8666-666666666666', name: '待处理', position: 0, version: 0,
    createdAt: '2026-10-14T00:00:00Z', updatedAt: '2026-10-14T00:00:00Z', cards: [],
  }],
};
const boardSummary = { boardId: board.boardId, projectId: board.projectId, name: board.name, description: board.description, version: board.version, createdAt: board.createdAt, updatedAt: board.updatedAt };
const projectKey = (overrides: Partial<ProjectResponseKey> = {}): ProjectResponseKey => ({
  sessionGeneration: 1, userId: user.userId, workspaceId: workspace.workspaceId, ...overrides,
});
const boardKey = (overrides: Partial<BoardResponseKey> = {}): BoardResponseKey => ({
  ...projectKey({ projectId: project.projectId }), boardId: board.boardId, boardGeneration: 0, ...overrides,
});
const workItem = (title: string): WorkItemView => ({
  workItemId: '77777777-7777-4777-8777-777777777777', projectId: project.projectId, title, description: '',
  version: 0, createdAt: board.createdAt, updatedAt: board.updatedAt,
});

function apiFor(session: SessionView = { status: 'signedOut' }): TaskPilotDesktopApi {
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


function mountApp(api: TaskPilotDesktopApi, locale: 'zh-CN' | 'en' = 'zh-CN') {
  cy.mount(<LocaleProvider initialLanguages={[locale]}><App api={api} /></LocaleProvider>);
}

describe('Desktop first-use experience', () => {
  beforeEach(() => { cy.clearLocalStorage(); });
  it('offers only GitHub and cancellation returns directly to sign-in', () => {
    const api = apiFor();
    mountApp(api);
    cy.findByRole('heading', { name: '登录 TaskPilot' }).should('be.visible');
    cy.findByRole('button', { name: '使用 GitHub 登录' }).focus().should('be.focused').click();
    cy.findByRole('heading', { name: '在浏览器中继续' }).should('be.visible');
    cy.findByRole('button', { name: '取消登录' }).click();
    cy.findByRole('heading', { name: '登录 TaskPilot' }).should('be.visible');
    cy.findByRole('button', { name: '重新开始' }).should('not.exist');
    cy.wrap(api.auth.cancelGitHubSignIn).should('have.been.calledOnceWith', { flowId: 'opaque-flow' });
  });

  it('shows a decorative Work Graph at the compact desktop viewport without adding overflow', () => {
    const api = apiFor();
    cy.viewport(960, 640);
    cy.window().then((window) => {
      cy.stub(window, 'matchMedia').callsFake(
        (query) =>
          ({
            matches: query === '(pointer: fine)' || query === '(min-width: 761px)',
            media: query,
            onchange: null,
            addListener: () => undefined,
            removeListener: () => undefined,
            addEventListener: () => undefined,
            removeEventListener: () => undefined,
            dispatchEvent: () => true,
          }) as MediaQueryList,
      );
    });
    mountApp(api);

    cy.get('.brand-panel').should('be.visible');
    cy.get('[data-testid="work-graph-background"]')
      .should('be.visible')
      .and('have.attr', 'aria-hidden', 'true')
      .and('have.attr', 'data-dynamic-feedback', 'enabled')
      .and('have.attr', 'data-flow-mode', 'pointer-trail');
    cy.get('[data-testid="work-graph-trail-cell"][data-visible="true"]').should('have.length', 0);
    cy.wait(180);
    cy.get('[data-testid="work-graph-trail-cell"][data-visible="true"]').should('have.length', 0);
    cy.get('.brand-panel')
      .trigger('pointermove', { clientX: 120, clientY: 220, pointerType: 'mouse' })
      .trigger('pointermove', { clientX: 360, clientY: 300, pointerType: 'mouse' });
    cy.get('[data-testid="work-graph-trail-cell"][data-visible="true"]')
      .should('have.length.greaterThan', 8)
      .then(($cells) => {
        const positions = [...$cells].map((cell) => `${(cell as HTMLElement).style.left}:${(cell as HTMLElement).style.top}`);
        expect(new Set(positions).size).to.be.greaterThan(8);
      });
    cy.get('[data-testid="work-graph-background"]').should(($graph) => {
      expect($graph[0].style.getPropertyValue('--work-graph-active')).to.equal('1');
      expect($graph[0].getAttribute('data-flow-mode')).to.equal('pointer-trail');
    });
    cy.wait(750);
    cy.get('[data-testid="work-graph-trail-cell"][data-visible="true"]').should('have.length', 0);
    cy.findByRole('button', { name: '使用 GitHub 登录' }).should('be.visible');
    cy.document().then((document) => {
      expect(document.documentElement.scrollWidth).to.be.at.most(document.documentElement.clientWidth);
    });
  });

  it('fails closed when GitHub capability is unavailable', () => {
    const api = apiFor();
    (api.auth.getCapabilities as Cypress.Agent<sinon.SinonStub>).resolves({ github: { enabled: false } });
    mountApp(api);
    cy.findByRole('heading', { name: 'GitHub 登录尚未配置' }).should('be.visible');
    cy.findByRole('button', { name: '使用 GitHub 登录' }).should('not.exist');
  });

  it('validates first registration and supports a missing avatar', () => {
    const api = apiFor();
    (api.auth.startGitHubSignIn as Cypress.Agent<sinon.SinonStub>).resolves({
      status: 'registrationRequired', flowId: 'opaque-flow',
      suggestedDisplayName: '', legalBundleVersion: '2026-09-01', termsVersion: 'terms-2026-09-01', privacyVersion: 'privacy-2026-09-01', legalLocales: ['zh-CN', 'en'],
    });
    mountApp(api);
    cy.findByRole('button', { name: '使用 GitHub 登录' }).click();
    cy.findByRole('button', { name: '创建 TaskPilot 账号' }).click();
    cy.findByRole('alert').should('contain.text', '显示名称');
    cy.findByLabelText('显示名称').should('be.focused').type('Ada');
    cy.findByRole('button', { name: '创建 TaskPilot 账号' }).click();
    cy.findByRole('checkbox', { name: /用户协议.*隐私政策/ }).should('be.focused').check();
    cy.findByRole('button', { name: '创建 TaskPilot 账号' }).click();
    cy.wrap(api.auth.completeGitHubRegistration).should('have.been.calledWith', {
      flowId: 'opaque-flow', displayName: 'Ada', useSuggestedAvatar: false,
      legalBundleVersion: '2026-09-01', termsVersion: 'terms-2026-09-01',
      privacyVersion: 'privacy-2026-09-01', locale: 'zh-CN',
    });
  });

  it('reads legal documents in app and preserves the registration draft', () => {
    const api = apiFor();
    (api.auth.startGitHubSignIn as Cypress.Agent<sinon.SinonStub>).resolves({
      status: 'registrationRequired', flowId: 'opaque-flow',
      suggestedDisplayName: 'octocat', legalBundleVersion: '2026-09-01', termsVersion: 'terms-2026-09-01', privacyVersion: 'privacy-2026-09-01', legalLocales: ['zh-CN', 'en'],
    });
    mountApp(api);
    cy.findByRole('button', { name: '使用 GitHub 登录' }).click();
    cy.findByLabelText('显示名称').clear().type('Ada Lovelace');
    cy.contains(/2026-09-01|版本/).should('not.exist');
    cy.findByRole('button', { name: /用户协议/ }).click();
    cy.findByRole('heading', { name: 'TaskPilot 用户协议' }).should('be.visible');
    cy.findByRole('button', { name: /返回账号创建/ }).click();
    cy.findByLabelText('显示名称').should('have.value', 'Ada Lovelace');
    cy.findByRole('button', { name: /隐私政策/ }).click();
    cy.findByRole('heading', { name: 'TaskPilot 隐私政策' }).should('be.visible');
  });

  it('keeps the auth surface usable at narrow width and respects reduced motion', () => {
    const api = apiFor();
    cy.viewport(480, 640);
    mountApp(api);
    cy.findByRole('button', { name: '使用 GitHub 登录' }).should('be.visible');
    cy.get('.brand-panel').should('not.be.visible');
    cy.get('[data-testid="work-graph-background"]')
      .should('not.be.visible')
      .and('have.attr', 'data-dynamic-feedback', 'static');
    cy.document().then((document) => {
      expect(document.documentElement.scrollWidth).to.be.at.most(document.documentElement.clientWidth);
      const sheet = [...document.styleSheets].flatMap((item) => {
        try { return [...item.cssRules].map((rule) => rule.cssText); } catch { return []; }
      }).join(' ');
      expect(sheet).to.contain('prefers-reduced-motion: reduce');
      expect(sheet).to.contain('work-graph__trail-cell');
    });
  });

  it('lands in the Project home and keeps logout reachable', () => {
    const api = apiFor({ status: 'authenticated', currentUser: user });
    mountApp(api);
    cy.findByRole('heading', { name: '我的项目' }).should('be.visible');
    cy.findByRole('button', { name: '打开账号菜单' }).click();
    cy.findByRole('button', { name: '退出登录' }).click();
    cy.wrap(api.auth.logout).should('have.been.calledOnce');
  });

  it('switches waiting and error states to English at the minimum supported viewport without restarting auth', () => {
    const api = apiFor();
    cy.viewport(960, 640);
    mountApp(api);
    cy.findByRole('button', { name: '使用 GitHub 登录' }).click();
    cy.findByRole('heading', { name: '在浏览器中继续' }).should('be.visible');
    cy.findByRole('combobox', { name: '语言' }).focus().click();
    cy.findByRole('option', { name: 'English' }).click();
    cy.findByRole('combobox', { name: 'Language' }).should('be.focused');
    cy.findByRole('heading', { name: 'Continue in your browser' }).should('be.visible');
    cy.findByRole('status').should('contain.text', 'Waiting for you to finish GitHub authorization');
    cy.wrap(api.auth.startGitHubSignIn).should('have.been.calledOnce');
    cy.document().its('documentElement.lang').should('equal', 'en');
  });

  it('keeps the longest English registration content and legal actions reachable at minimum viewport', () => {
    const api = apiFor();
    (api.auth.startGitHubSignIn as Cypress.Agent<sinon.SinonStub>).resolves({
      status: 'registrationRequired', flowId: 'opaque-flow', suggestedDisplayName: 'Ada',
      suggestedAvatarUrl: 'https://avatars.githubusercontent.com/u/1?v=4', legalBundleVersion: '2026-09-01', termsVersion: 'terms-2026-09-01', privacyVersion: 'privacy-2026-09-01', legalLocales: ['zh-CN', 'en'],
    });
    cy.viewport(960, 640);
    mountApp(api, 'en');
    cy.findByRole('button', { name: 'Sign in with GitHub' }).click();
    cy.findByRole('heading', { name: 'Create your TaskPilot account' }).should('be.visible');
    cy.findByRole('checkbox', { name: /Terms of Service.*Privacy Policy/ }).should('be.visible');
    cy.findByRole('button', { name: 'Terms of Service' }).click();
    cy.findByRole('heading', { name: 'TaskPilot Terms of Service' }).should('be.visible');
    cy.findByRole('region', { name: 'Legal document content' }).focus().should('be.focused');
    cy.findByRole('button', { name: '← Back to account creation' }).should('be.visible').click();
    cy.findByRole('button', { name: 'Create TaskPilot account' }).should('be.visible');
    cy.document().then((document) => {
      expect(document.documentElement.scrollWidth).to.be.at.most(document.documentElement.clientWidth);
    });
  });

  it('switches the Project shell to English without changing the user or logging out', () => {
    const api = apiFor({ status: 'authenticated', currentUser: user });
    cy.viewport(1280, 800);
    mountApp(api);
    cy.findByRole('heading', { name: '我的项目' }).should('be.visible');
    cy.findByRole('button', { name: '打开账号菜单' }).click();
    cy.findByRole('combobox', { name: '语言' }).click();
    cy.findByRole('option', { name: 'English' }).click();
    cy.findByRole('heading', { name: '我的项目' }).should('be.visible');
    cy.contains('Signed in with GitHub').should('be.visible');
    cy.findByRole('button', { name: 'Sign out' }).should('be.visible');
    cy.wrap(api.auth.logout).should('not.have.been.called');
  });


  it('keeps the bilingual Project shell and primary action visible at 960 by 640 with long content', () => {
    const api = apiFor({ status: 'authenticated', currentUser: user });
    const longProject = {
      ...project,
      name: 'A deliberately long project name that must wrap without hiding the primary action at minimum window width',
      description: 'A long project description that verifies wrapping, readable hierarchy, and the absence of horizontal overflow in the quiet control desk shell.',
    };
    (api.projects.resolveHome as Cypress.Agent<sinon.SinonStub>).resolves({
      key: projectKey({ projectId: longProject.projectId, status: 'ACTIVE' }), value: { workspace, projects: [longProject], currentProject: longProject },
    });
    cy.viewport(960, 640);
    mountApp(api, 'en');
    cy.findByRole('heading', { name: longProject.name }).should('be.visible');
    cy.findByRole('button', { name: 'Project settings' }).should('be.visible');
    cy.document().then((document) => {
      expect(document.documentElement.scrollWidth).to.be.at.most(document.documentElement.clientWidth);
    });
  });

  it('traps dialog focus, restores it on close, and associates a mutation error', () => {
    const api = apiFor({ status: 'authenticated', currentUser: user });
    (api.projects.create as Cypress.Agent<sinon.SinonStub>).rejects(new Error('offline'));
    cy.viewport(960, 640);
    mountApp(api);
    cy.findByRole('button', { name: '新建项目' }).first().as('createTrigger').click();
    cy.findByRole('dialog').within(() => {
      cy.findByLabelText('项目名称').should('be.focused').type('发布准备');
      cy.findByRole('button', { name: '关闭' }).focus().trigger('keydown', { key: 'Tab', shiftKey: true });
      cy.findByRole('button', { name: '创建项目' }).should('be.focused');
      cy.findByRole('button', { name: '创建项目' }).click();
      cy.findByRole('alert').should('have.attr', 'id', 'project-create-error');
      cy.get('form').should('have.attr', 'aria-describedby', 'project-create-error');
      cy.findByRole('button', { name: '关闭' }).click();
    });
    cy.get('@createTrigger').should('be.focused');
  });

  it('requires the exact Project name in Danger Zone and exposes archived restore', () => {
    const api = apiFor({ status: 'authenticated', currentUser: user });
    mountApp(api);
    cy.findByRole('button', { name: '项目设置' }).click();
    cy.findByRole('button', { name: '永久删除项目' }).click();
    cy.findByRole('button', { name: '永久删除' }).should('be.disabled');
    cy.findByLabelText('输入“我的项目”以确认').type('我的项目');
    cy.findByRole('button', { name: '永久删除' }).should('be.enabled');
    cy.findByRole('button', { name: '关闭' }).click();
    cy.findByRole('button', { name: /返回/ }).click();
    cy.findByRole('button', { name: '已归档项目' }).click();
    cy.findByRole('button', { name: '恢复“旧版本”' }).should('be.visible');
  });

});
