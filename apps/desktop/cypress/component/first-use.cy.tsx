import { App } from '../../src/renderer/App';
import type { SessionView, TaskPilotDesktopApi, WorkspaceList } from '../../src/shared/contracts';

const user = { userId: '11111111-1111-4111-8111-111111111111', displayName: 'Ada', email: 'ada@example.com' };
const workspace = { workspaceId: '22222222-2222-4222-8222-222222222222', name: 'Agent Operations', type: 'ORGANIZATION' as const };

function apiFor(session: SessionView = { status: 'signedOut' }, list: WorkspaceList = { items: [], capabilities: { canCreateWorkspace: true } }): TaskPilotDesktopApi {
  return {
    auth: {
      getSessionView: cy.stub().resolves(session), subscribeSessionView: cy.stub().returns(() => undefined), logout: cy.stub().resolves(),
      signInWithPassword: cy.stub().resolves({ status: 'authenticated', currentUser: user }),
      requestLoginCode: cy.stub().resolves({ challengeId: 'challenge', retryAfterSeconds: 30 }), verifyLoginCode: cy.stub().resolves({ status: 'authenticated', currentUser: user }),
      requestRegistrationCode: cy.stub().resolves({ challengeId: 'challenge', retryAfterSeconds: 30 }),
      verifyRegistrationCode: cy.stub().resolves({ flowHandle: 'flow', expiresAt: '2030-01-01T00:00:00Z' }), register: cy.stub().resolves({ status: 'authenticated', currentUser: user }),
      requestPasswordResetCode: cy.stub().resolves({ challengeId: 'challenge', retryAfterSeconds: 30 }),
      verifyPasswordResetCode: cy.stub().resolves({ flowHandle: 'flow', expiresAt: '2030-01-01T00:00:00Z' }), resetPassword: cy.stub().resolves(),
    },
    workspaces: {
      listWorkspaces: cy.stub().resolves(list), createWorkspace: cy.stub().resolves(workspace), restoreActiveWorkspace: cy.stub().resolves({}),
      selectWorkspace: cy.stub().resolves(), clearActiveWorkspace: cy.stub().resolves(),
    },
    projects: { listProjects: cy.stub().resolves({ items: [] }) },
  };
}

describe('Desktop first-use experience', () => {
  it('keeps sign-in and registration distinct and never exposes secrets', () => {
    const api = apiFor();
    cy.mount(<App api={api} />);
    cy.findByRole('heading', { name: '登录 TaskPilot' }).should('be.visible');
    cy.findByLabelText('邮箱').type('ada@example.com');
    cy.findByLabelText('密码').type('not-the-password');
    cy.findByRole('button', { name: /创建 TaskPilot 账号/ }).click();
    cy.findByRole('heading', { name: '创建账号' }).should('be.visible');
    cy.findByLabelText('邮箱').should('have.value', 'ada@example.com');
    cy.get('body').should('not.contain.text', 'not-the-password');
    cy.url().should('not.include', 'ada@example.com').and('not.include', 'not-the-password');
    cy.wrap(api.workspaces.listWorkspaces).should('not.have.been.called');
  });

  it('communicates a non-enumerating login failure and restores keyboard focus order', () => {
    const api = apiFor();
    (api.auth.signInWithPassword as Cypress.Agent<sinon.SinonStub>).rejects(Object.assign(new Error('bad'), { code: 'INVALID_CREDENTIALS' }));
    cy.mount(<App api={api} />);
    cy.findByLabelText('邮箱').type('unknown@example.com');
    cy.press(Cypress.Keyboard.Keys.TAB);
    cy.focused().should('have.attr', 'type', 'password').type('wrong-secret');
    cy.press(Cypress.Keyboard.Keys.TAB);
    cy.press(Cypress.Keyboard.Keys.TAB);
    cy.focused().should('have.attr', 'type', 'submit').click();
    cy.findByRole('alert').should('contain.text', '邮箱或密码不正确');
    cy.findByLabelText('密码').should('have.value', '');
  });

  it('focuses the server-identified field without exposing raw validation detail', () => {
    const api = apiFor();
    (api.auth.signInWithPassword as Cypress.Agent<sinon.SinonStub>).rejects({
      code: 'VALIDATION_FAILED',
      category: 'validation',
      path: 'password',
    });
    cy.mount(<App api={api} />);
    cy.findByLabelText('邮箱').type('ada@example.com');
    cy.findByLabelText('密码').type('short');
    cy.findByRole('button', { name: /^登录$/ }).click();
    cy.findByRole('alert').should('contain.text', '请检查填写的信息');
    cy.findByLabelText('密码').should('be.focused').and('have.value', '');
    cy.get('body').should('not.contain.text', 'short');
  });


  it('blocks mismatched password confirmation locally and focuses the field', () => {
    const api = apiFor();
    cy.mount(<App api={api} />);
    cy.findByRole('button', { name: /创建 TaskPilot 账号/ }).click();
    cy.findByLabelText('邮箱').type('ada@example.com');
    cy.findByRole('button', { name: '发送注册验证码' }).click();
    cy.findByLabelText('6 位验证码').type('123456');
    cy.findByRole('button', { name: '验证邮箱' }).click();
    cy.findByLabelText('姓名').type('Ada');
    cy.findByLabelText('密码').type('correct horse battery staple');
    cy.findByLabelText('确认密码').type('different secret');
    cy.findByRole('checkbox').click();
    cy.findByRole('button', { name: '创建账号' }).click();
    cy.findByRole('alert').should('contain.text', '两次输入的密码不一致');
    cy.findByLabelText('确认密码').should('be.focused').and('have.value', '');
    cy.wrap(api.auth.register).should('not.have.been.called');
  });

  it('recovers from an unknown registration result without retaining secrets', () => {
    const api = apiFor();
    (api.auth.register as Cypress.Agent<sinon.SinonStub>).rejects(Object.assign(new Error('unknown'), { code: 'REGISTRATION_RESULT_UNKNOWN' }));
    cy.mount(<App api={api} />);
    cy.findByRole('button', { name: /创建 TaskPilot 账号/ }).click();
    cy.findByLabelText('邮箱').type('ada@example.com');
    cy.findByRole('button', { name: '发送注册验证码' }).click();
    cy.findByLabelText('6 位验证码').type('123456');
    cy.findByRole('button', { name: '验证邮箱' }).click();
    cy.findByLabelText('姓名').type('Ada');
    cy.findByLabelText('密码').type('a-long-secret-password');
    cy.findByLabelText('确认密码').type('a-long-secret-password');
    cy.findByRole('checkbox').click();
    cy.findByRole('button', { name: '创建账号' }).click();
    cy.findByRole('heading', { name: '登录 TaskPilot' }).should('be.visible');
    cy.findByRole('status').should('contain.text', '账号可能已创建');
    cy.findByLabelText('邮箱').should('have.value', 'ada@example.com');
    cy.findByLabelText('密码').should('have.value', '');
    cy.get('body').should('not.contain.text', '123456').and('not.contain.text', 'a-long-secret-password');
  });

  it('returns expired registration and reset continuations to safe verification entry points', () => {
    const api = apiFor();
    (api.auth.register as Cypress.Agent<sinon.SinonStub>).rejects(Object.assign(new Error('expired'), { code: 'REGISTRATION_CONTEXT_EXPIRED' }));
    (api.auth.resetPassword as Cypress.Agent<sinon.SinonStub>).rejects(Object.assign(new Error('expired'), { code: 'PASSWORD_RESET_CONTEXT_EXPIRED' }));
    cy.mount(<App api={api} />);
    cy.findByRole('button', { name: /创建 TaskPilot 账号/ }).click();
    cy.findByLabelText('邮箱').type('ada@example.com');
    cy.findByRole('button', { name: '发送注册验证码' }).click();
    cy.findByLabelText('6 位验证码').type('123456');
    cy.findByRole('button', { name: '验证邮箱' }).click();
    cy.findByLabelText('姓名').type('Ada');
    cy.findByLabelText('密码').type('registration-secret');
    cy.findByLabelText('确认密码').type('registration-secret');
    cy.findByRole('checkbox').click();
    cy.findByRole('button', { name: '创建账号' }).click();
    cy.findByRole('heading', { name: '创建账号' }).should('be.visible');
    cy.findByRole('status').should('contain.text', '验证已过期');
    cy.findByLabelText('邮箱').should('have.value', 'ada@example.com');
    cy.get('body').should('not.contain.text', 'registration-secret');

    cy.findByRole('button', { name: '返回' }).click();
    cy.findByRole('button', { name: '忘记密码？' }).click();
    cy.findByRole('button', { name: '发送重置验证码' }).click();
    cy.findByLabelText('6 位验证码').type('654321');
    cy.findByRole('button', { name: '继续' }).click();
    cy.findByLabelText('新密码').type('reset-secret');
    cy.findByRole('button', { name: '更新密码' }).click();
    cy.findByRole('heading', { name: '重置密码' }).should('be.visible');
    cy.findByRole('status').should('contain.text', '验证已过期');
    cy.findByLabelText('邮箱').should('have.value', 'ada@example.com');
    cy.get('body').should('not.contain.text', '654321').and('not.contain.text', 'reset-secret');
  });

  it('allows an explicit retry after an offline sign-in failure', () => {
    const api = apiFor();
    (api.auth.signInWithPassword as Cypress.Agent<sinon.SinonStub>)
      .onFirstCall().rejects(Object.assign(new Error('offline'), { code: 'NETWORK_UNAVAILABLE' }))
      .onSecondCall().resolves({ status: 'authenticated', currentUser: user });
    cy.mount(<App api={api} />);
    cy.findByLabelText('邮箱').type('ada@example.com');
    cy.findByLabelText('密码').type('first-secret');
    cy.findByRole('button', { name: /^登录$/ }).click();
    cy.findByRole('alert').should('contain.text', '暂时无法连接');
    cy.findByLabelText('密码').should('have.value', '').type('second-secret');
    cy.findByRole('button', { name: /^登录$/ }).click();
    cy.wrap(api.auth.signInWithPassword).should('have.been.calledTwice');
    cy.findByLabelText('密码').should('have.value', '');
  });

  it('keeps the primary action stable and rejects duplicate sign-in while pending', () => {
    const api = apiFor();
    let resolveSignIn: ((view: SessionView) => void) | undefined;
    (api.auth.signInWithPassword as Cypress.Agent<sinon.SinonStub>).callsFake(() => new Promise<SessionView>((resolve) => {
      resolveSignIn = resolve;
    }));
    cy.mount(<App api={api} />);
    cy.findByLabelText('邮箱').type('ada@example.com');
    cy.findByLabelText('密码').type('pending-secret');
    cy.findByRole('button', { name: /^登录$/ }).then(($button) => {
      const width = $button[0].getBoundingClientRect().width;
      cy.wrap($button).click().should('be.disabled').and('contain.text', '正在登录');
      cy.wrap($button).then(($pendingButton) => {
        expect($pendingButton[0].getBoundingClientRect().width).to.equal(width);
      });
    });
    cy.findByRole('button', { name: '正在登录…' }).click({ force: true });
    cy.wrap(api.auth.signInWithPassword).should('have.been.calledOnce');
    cy.then(() => resolveSignIn?.({ status: 'authenticated', currentUser: user }));
    cy.findByLabelText('密码').should('have.value', '');
  });

  it('hands a successful session to Workspace and returns to authentication after logout', () => {
    const api = apiFor();
    let publishSession: ((view: SessionView) => void) | undefined;
    api.auth.subscribeSessionView = cy.stub().callsFake((listener: (view: SessionView) => void) => {
      publishSession = listener;
      return () => undefined;
    });
    cy.mount(<App api={api} />);
    cy.findByLabelText('邮箱').type('ada@example.com');
    cy.findByLabelText('密码').type('handoff-secret');
    cy.findByRole('button', { name: /^登录$/ }).click();
    cy.wrap(api.auth.signInWithPassword).should('have.been.calledOnce');
    cy.then(() => publishSession?.({ status: 'authenticated', currentUser: user }));
    cy.findByRole('heading', { name: '选择一个 Workspace' }).should('be.visible');
    cy.wrap(api.workspaces.listWorkspaces).should('have.been.calledOnce');
    cy.get('body').should('not.contain.text', 'handoff-secret');
    cy.findByRole('button', { name: '退出' }).click();
    cy.wrap(api.auth.logout).should('have.been.calledOnce');
    cy.then(() => publishSession?.({ status: 'signedOut' }));
    cy.findByRole('heading', { name: '登录 TaskPilot' }).should('be.visible');
    cy.findByLabelText('密码').should('have.value', '');
  });

  it('keeps authentication usable at a narrow effective width and leaves no secrets in browser surfaces', () => {
    const api = apiFor();
    const consoleSpy = cy.spy(console, 'log');
    cy.viewport(480, 640);
    cy.mount(<App api={api} />);
    cy.findByRole('main').should('exist');
    cy.findByRole('heading', { name: '登录 TaskPilot' }).should('be.visible');
    cy.findByLabelText('邮箱').type('ada@example.com');
    cy.findByLabelText('密码').type('surface-secret');
    cy.findByRole('button', { name: /^登录$/ }).click();
    cy.findByLabelText('密码').should('have.value', '');
    cy.document().then((document) => {
      expect(document.documentElement.scrollWidth).to.be.at.most(document.documentElement.clientWidth);
      expect(document.body.textContent).not.to.contain('surface-secret');
    });
    cy.window().then((window) => {
      expect(JSON.stringify(window.localStorage)).not.to.contain('surface-secret');
      expect(JSON.stringify(window.sessionStorage)).not.to.contain('surface-secret');
      expect(window.location.href).not.to.contain('surface-secret');
    });
    cy.wrap(consoleSpy).should('not.have.been.calledWithMatch', 'surface-secret');
  });

  it('enforces login OTP cooldown and renders a safe retry delay', () => {
    const api = apiFor();
    (api.auth.verifyLoginCode as Cypress.Agent<sinon.SinonStub>).rejects(Object.assign(new Error('limited'), { code: 'AUTHENTICATION_RATE_LIMITED', retryAfterSeconds: 45 }));
    cy.clock();
    cy.mount(<App api={api} />);
    cy.findByRole('button', { name: '使用邮箱验证码登录' }).click();
    cy.findByLabelText('邮箱').type('ada@example.com');
    cy.findByRole('button', { name: '发送验证码' }).click();
    cy.findByText('30 秒后可重新发送').should('be.visible');
    cy.findByRole('button', { name: '重新发送验证码' }).should('be.disabled');
    cy.tick(30_000);
    cy.findByRole('button', { name: '重新发送验证码' }).should('be.enabled');
    cy.findByLabelText('6 位验证码').type('123456');
    cy.findByRole('button', { name: /^登录$/ }).click();
    cy.findByRole('alert').should('contain.text', '45 秒后再试');
  });

  it('honors Workspace capability and shows a genuine read-only Project empty state', () => {
    const session: SessionView = { status: 'authenticated', currentUser: user };
    const api = apiFor(session, { items: [workspace], capabilities: { canCreateWorkspace: false, createWorkspaceReasonCode: 'POLICY_RESTRICTED' } });
    api.workspaces.restoreActiveWorkspace = cy.stub().resolves({ workspaceId: workspace.workspaceId });
    cy.mount(<App api={api} />);
    cy.findByRole('heading', { name: '这里还没有可访问的项目' }).should('be.visible');
    cy.findByRole('button', { name: /创建 Project/i }).should('not.exist');
    cy.get('body').should('not.contain.text', 'Create Project').and('not.contain.text', 'canCreateProject');
    cy.wrap(api.projects.listProjects).should('have.been.calledWith', { workspaceId: workspace.workspaceId, cursor: undefined, limit: 50 });
  });

  it('keeps an unknown Workspace create intention stable across retry', () => {
    const session: SessionView = { status: 'authenticated', currentUser: user };
    const api = apiFor(session);
    (api.workspaces.createWorkspace as Cypress.Agent<sinon.SinonStub>)
      .onFirstCall().rejects(Object.assign(new Error('unknown'), { code: 'WORKSPACE_RESULT_UNKNOWN' }))
      .onSecondCall().resolves(workspace);
    cy.mount(<App api={api} />);
    cy.findByLabelText('Workspace 名称').type('Agent Operations');
    cy.findByRole('button', { name: '创建 Workspace' }).click();
    cy.findByRole('button', { name: '重试创建' }).click();
    cy.wrap(api.workspaces.createWorkspace).should('have.been.calledTwice');
    cy.then(() => {
      const stub = api.workspaces.createWorkspace as Cypress.Agent<sinon.SinonStub>;
      expect(stub.firstCall.args[0]).to.deep.equal(stub.secondCall.args[0]);
    });
  });
});
