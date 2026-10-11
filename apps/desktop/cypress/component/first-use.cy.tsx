import { App } from '../../src/renderer/App';
import type { FederatedAuthFlowView, SessionView, TaskPilotDesktopApi } from '../../src/shared/contracts';

const user = { userId: '11111111-1111-4111-8111-111111111111', displayName: 'Ada' };
const waiting: FederatedAuthFlowView = {
  status: 'waiting', flowId: 'opaque-flow', expiresAt: '2030-01-01T00:00:00Z',
};

function apiFor(session: SessionView = { status: 'signedOut' }): TaskPilotDesktopApi {
  return { auth: {
    getCapabilities: cy.stub().resolves({ github: { enabled: true } }),
    startGitHubSignIn: cy.stub().resolves(waiting),
    continueGitHubSignIn: cy.stub().resolves(waiting),
    completeGitHubRegistration: cy.stub().resolves({ status: 'authenticated', currentUser: user }),
    cancelGitHubSignIn: cy.stub().resolves(),
    getSessionView: cy.stub().resolves(session),
    subscribeSessionView: cy.stub().returns(() => undefined),
    logout: cy.stub().resolves(),
  } };
}

describe('Desktop first-use experience', () => {
  it('offers only GitHub and cancellation returns directly to sign-in', () => {
    const api = apiFor();
    cy.mount(<App api={api} />);
    cy.findByRole('heading', { name: '登录 TaskPilot' }).should('be.visible');
    cy.findByRole('button', { name: '使用 GitHub 登录' }).focus().should('be.focused').click();
    cy.findByRole('heading', { name: '在浏览器中继续' }).should('be.visible');
    cy.findByRole('button', { name: '取消登录' }).click();
    cy.findByRole('heading', { name: '登录 TaskPilot' }).should('be.visible');
    cy.findByRole('button', { name: '重新开始' }).should('not.exist');
    cy.wrap(api.auth.cancelGitHubSignIn).should('have.been.calledOnceWith', { flowId: 'opaque-flow' });
  });

  it('fails closed when GitHub capability is unavailable', () => {
    const api = apiFor();
    (api.auth.getCapabilities as Cypress.Agent<sinon.SinonStub>).resolves({ github: { enabled: false } });
    cy.mount(<App api={api} />);
    cy.findByRole('heading', { name: 'GitHub 登录尚未配置' }).should('be.visible');
    cy.findByRole('button', { name: '使用 GitHub 登录' }).should('not.exist');
  });

  it('validates first registration and supports a missing avatar', () => {
    const api = apiFor();
    (api.auth.startGitHubSignIn as Cypress.Agent<sinon.SinonStub>).resolves({
      status: 'registrationRequired', flowId: 'opaque-flow',
      suggestedDisplayName: '', legalBundleVersion: '2026-09-01',
    });
    cy.mount(<App api={api} />);
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
      suggestedDisplayName: 'octocat', legalBundleVersion: '2026-09-01',
    });
    cy.mount(<App api={api} />);
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
    cy.mount(<App api={api} />);
    cy.findByRole('button', { name: '使用 GitHub 登录' }).should('be.visible');
    cy.document().then((document) => {
      expect(document.documentElement.scrollWidth).to.be.at.most(document.documentElement.clientWidth);
      const sheet = [...document.styleSheets].flatMap((item) => {
        try { return [...item.cssRules].map((rule) => rule.cssText); } catch { return []; }
      }).join(' ');
      expect(sheet).to.contain('prefers-reduced-motion: reduce');
    });
  });

  it('shows the authenticated account and preserves logout', () => {
    const api = apiFor({ status: 'authenticated', currentUser: user });
    cy.mount(<App api={api} />);
    cy.findByRole('heading', { name: 'Ada' }).should('be.visible');
    cy.findByRole('button', { name: '退出登录' }).click();
    cy.wrap(api.auth.logout).should('have.been.calledOnce');
  });
});
