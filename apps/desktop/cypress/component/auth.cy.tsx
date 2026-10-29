import { apiFor, mountApp } from './app-harness';

describe('Desktop auth experience', () => {
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
      const randomValues = [0, 0, 0.2, 0.5, 0.4, 0.9, 0.6, 0, 0.8, 0.7, 0.99, 0.4];
      let randomIndex = 0;
      cy.stub(window.Math, 'random').callsFake(() => randomValues[randomIndex++ % randomValues.length]);
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
        const firstCell = $cells[0] as HTMLElement;
        expect(window.getComputedStyle(firstCell).width).to.equal('16px');
        expect(window.getComputedStyle(firstCell).height).to.equal('16px');
        expect(new Set([...$cells].map((cell) => (cell as HTMLElement).dataset.tone)).size).to.be.greaterThan(3);
        expect([...$cells].some((cell) => (cell as HTMLElement).dataset.symbol === '')).to.equal(true);
        expect([...$cells].some((cell) => (cell as HTMLElement).dataset.symbol !== '')).to.equal(true);
      });
    cy.get('[data-testid="work-graph-background"]').should(($graph) => {
      expect($graph[0].style.getPropertyValue('--work-graph-active')).to.equal('1');
      expect($graph[0].getAttribute('data-flow-mode')).to.equal('pointer-trail');
    });
    cy.wait(650);
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
});
