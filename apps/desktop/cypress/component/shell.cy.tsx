import { apiFor, mountApp, project, projectKey, user, workspace } from './app-harness';

type ProjectDialogGeometry = Readonly<{
  nameLabel: { left: number; top: number };
  nameControl: { left: number; top: number };
  descriptionLabel: { left: number; top: number };
  descriptionControl: { left: number; top: number };
  primaryAction: { left: number; top: number };
}>;

function captureProjectDialogGeometry(): Cypress.Chainable<ProjectDialogGeometry> {
  return cy.findByRole('dialog').then(($dialog) => {
    const dialog = $dialog[0];
    const origin = (element: Element | null, label: string) => {
      expect(element, label).to.not.equal(null);
      const bounds = (element as HTMLElement).getBoundingClientRect();
      return { left: bounds.left, top: bounds.top };
    };
    const name = dialog.querySelector<HTMLInputElement>('[name="projectName"]');
    const description = dialog.querySelector<HTMLTextAreaElement>('[name="projectDescription"]');
    return {
      nameLabel: origin(name?.closest('label')?.querySelector(':scope > span') ?? null, 'name label'),
      nameControl: origin(name, 'name control'),
      descriptionLabel: origin(description?.closest('label')?.querySelector(':scope > span') ?? null, 'description label'),
      descriptionControl: origin(description, 'description control'),
      primaryAction: origin(dialog.querySelector('button[type="submit"]'), 'primary action'),
    };
  });
}

function assertProjectDialogGeometry(actual: ProjectDialogGeometry, expected: ProjectDialogGeometry) {
  for (const part of Object.keys(expected) as Array<keyof ProjectDialogGeometry>) {
    expect(actual[part].left, `${part} left`).to.be.closeTo(expected[part].left, 1);
    expect(actual[part].top, `${part} top`).to.be.closeTo(expected[part].top, 1);
  }
}

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

  it('keeps Project validation, counters, and pending feedback geometrically stable across locales and viewports', () => {
    const scenarios = [
      { locale: 'zh-CN' as const, width: 960, height: 640, create: '新建项目', name: '项目名称', required: '请输入项目名称。', submit: '创建项目', pending: '正在创建…' },
      { locale: 'en' as const, width: 1280, height: 800, create: 'New project', name: 'Project name', required: 'Enter a project name.', submit: 'Create project', pending: 'Creating…' },
    ];

    for (const scenario of scenarios) {
      const api = apiFor({ status: 'authenticated', currentUser: user });
      const pendingCreate = new Cypress.Promise(() => undefined);
      (api.projects.create as Cypress.Agent<sinon.SinonStub>).returns(pendingCreate);
      let baseline: ProjectDialogGeometry;

      cy.viewport(scenario.width, scenario.height);
      mountApp(api, scenario.locale);
      cy.findAllByRole('button', { name: scenario.create }).first().click();
      captureProjectDialogGeometry().then((geometry) => { baseline = geometry; });

      cy.findByLabelText(scenario.name).blur();
      cy.findByRole('alert').should('contain.text', scenario.required);
      captureProjectDialogGeometry().then((geometry) => assertProjectDialogGeometry(geometry, baseline));

      cy.findByLabelText(scenario.name).type('a'.repeat(80));
      cy.findByText('80 / 100').should('be.visible');
      captureProjectDialogGeometry().then((geometry) => assertProjectDialogGeometry(geometry, baseline));

      cy.findByLabelText(scenario.name).type('a'.repeat(20));
      cy.findByText('100 / 100').should('be.visible');
      cy.findAllByRole('status').filter(':visible').should('have.length.at.least', 1);
      captureProjectDialogGeometry().then((geometry) => assertProjectDialogGeometry(geometry, baseline));

      cy.findByRole('button', { name: scenario.submit }).click();
      cy.findByRole('button', { name: scenario.pending }).should('be.disabled');
      captureProjectDialogGeometry().then((geometry) => assertProjectDialogGeometry(geometry, baseline));
      cy.wrap(api.projects.create).should('have.been.calledOnce');
    }
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
