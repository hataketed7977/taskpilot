import { apiFor, mountApp, project, projectKey, user, workspace } from './app-harness';

describe('Desktop shell experience', () => {
  beforeEach(() => { cy.clearLocalStorage(); });
  it('lands in the Project home and confirms logout before signing out', () => {
    const api = apiFor({ status: 'authenticated', currentUser: user });
    mountApp(api);
    cy.findByRole('heading', { name: '我的项目' }).should('be.visible');
    cy.findByRole('button', { name: '打开账号菜单' }).click();
    cy.findByRole('button', { name: '退出登录' }).click();
    cy.findByRole('dialog', { name: '退出登录？' }).should('be.visible');
    cy.wrap(api.auth.logout).should('not.have.been.called');
    cy.findByRole('button', { name: '取消' }).click();
    cy.findByRole('dialog', { name: '退出登录？' }).should('not.exist');
    cy.wrap(api.auth.logout).should('not.have.been.called');
    cy.findByRole('button', { name: '退出登录' }).click();
    cy.findByRole('dialog', { name: '退出登录？' }).within(() => {
      cy.findByRole('button', { name: '退出登录' }).click();
    });
    cy.wrap(api.auth.logout).should('have.been.calledOnce');
  });

  it('switches the Project shell to English without changing user data or jittering account controls', () => {
    const api = apiFor({ status: 'authenticated', currentUser: user });
    cy.viewport(1280, 800);
    mountApp(api);
    cy.findByRole('heading', { name: '我的项目' }).should('be.visible');
    cy.findByRole('tab', { name: '工作看板' }).should('be.visible');
    cy.findByRole('heading', { name: '待处理' }).should('be.visible');
    cy.findByRole('button', { name: '项目设置' }).click();
    cy.findByRole('heading', { name: '项目设置' }).should('be.visible');
    cy.findByRole('button', { name: '打开账号菜单' }).click();

    cy.findByRole('combobox', { name: '语言' }).then(($select) => {
      const before = $select[0].getBoundingClientRect();
      cy.findByRole('combobox', { name: '语言' }).click();
      cy.findByRole('listbox').should('be.visible');
      cy.get('.account-menu').should('exist');
      cy.get('.account-language .tp-select-trigger').should(($openSelect) => {
        expect($openSelect).to.have.css('outline-style', 'none');
        expect($openSelect).to.have.css('box-shadow', 'none');
      });
      cy.get('body').should('have.css', 'margin-right', '0px');
      cy.document().then((doc) => {
        expect(doc.documentElement.scrollWidth).to.eq(doc.documentElement.clientWidth);
      });
      cy.get('.account-language .tp-select-trigger').then(($trigger) => {
        const bounds = $trigger[0].getBoundingClientRect();
        cy.get('body').click(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2, { force: true });
      });
      cy.get('.account-menu').should('be.visible');
      cy.findByRole('listbox').should('not.exist');
      cy.findByRole('combobox', { name: '语言' }).click();
      cy.findByRole('listbox').should('be.visible');
      cy.get('.settings-header h1').contains('项目设置').click({ force: true });
      cy.get('.account-menu').should('not.exist');
      cy.findByRole('listbox').should('not.exist');
      cy.findByRole('button', { name: '打开账号菜单' }).click();
      cy.findByRole('combobox', { name: '语言' }).click();
      cy.findByRole('option', { name: 'English' }).click();
      cy.findByRole('combobox', { name: 'Language' }).should(($next) => {
        const after = $next[0].getBoundingClientRect();
        expect(after.width).to.equal(before.width);
        expect(Math.abs(after.right - before.right)).to.be.lessThan(0.5);
      });
    });

    cy.findByRole('heading', { name: '我的项目' }).should('not.exist');
    cy.findByRole('heading', { name: 'Project settings' }).should('be.visible');
    cy.findByLabelText('Project name').should('have.value', '我的项目');
    cy.findByRole('button', { name: 'Sign out' }).should(($button) => {
      expect($button.find('.account-menu__logout-icon svg')).to.have.length(1);
      expect($button).to.have.css('color', 'rgb(23, 32, 27)');
      const languageIcon = Cypress.$('.account-language .account-menu__icon')[0].getBoundingClientRect();
      const logoutIcon = $button.find('.account-menu__logout-icon')[0].getBoundingClientRect();
      const languageLabelLeft = Cypress.$('.account-language .account-menu__row-label')[0].getBoundingClientRect().left;
      const logoutLabelLeft = $button.find('.account-menu__logout-label')[0].getBoundingClientRect().left;
      expect(Math.abs((logoutIcon.left + logoutIcon.width / 2) - (languageIcon.left + languageIcon.width / 2))).to.be.at.most(1);
      expect(Math.abs(logoutLabelLeft - languageLabelLeft)).to.be.at.most(1);
    });
    cy.get('.settings-header h1').contains('Project settings').click();
    cy.findByRole('button', { name: 'Sign out' }).should('not.exist');
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
