import { useState } from 'react';
import { Select, type SelectOption } from '../../src/renderer/shared/ui/select';

const baseOptions: readonly SelectOption[] = [
  { value: 'backlog', label: '待处理' },
  { value: 'doing', label: '进行中' },
  { value: 'done', label: '已完成' },
];

function SelectHarness({ options = baseOptions }: { options?: readonly SelectOption[] }) {
  const [value, setValue] = useState(options[0]?.value ?? '');
  return <Select ariaLabel="所在列表" value={value} options={options} onValueChange={setValue} />;
}

describe('shared Select', () => {
  it('supports keyboard selection, cancellation, and focus return', () => {
    cy.mount(<SelectHarness />);
    cy.findByRole('combobox', { name: '所在列表' }).as('trigger').focus().type('{enter}');
    cy.findByRole('option', { name: '待处理' }).should('have.attr', 'aria-selected', 'true');
    cy.get('body').type('{downarrow}{esc}');
    cy.findByRole('option').should('not.exist');
    cy.findByRole('combobox', { name: '所在列表' })
      .should('be.focused')
      .and('contain.text', '待处理')
      .type('{enter}');
    cy.findByRole('option', { name: '待处理' }).should('have.attr', 'data-highlighted');
    cy.focused().type('{downarrow}');
    cy.findByRole('option', { name: '进行中' }).should('have.attr', 'data-highlighted');
    cy.focused().should('have.attr', 'title', '进行中').type('{enter}');
    cy.findByRole('combobox', { name: '所在列表' }).should('be.focused').and('contain.text', '进行中');
  });

  it('cancels on outside interaction without changing the value and restores trigger focus', () => {
    cy.mount(
      <div style={{ minHeight: 320, padding: 24 }}>
        <SelectHarness />
      </div>,
    );

    cy.findByRole('combobox', { name: '所在列表' }).as('trigger').click();
    cy.findByRole('option', { name: '进行中' }).trigger('pointermove');
    cy.get('body').click(1, 1, { force: true });

    cy.findByRole('option').should('not.exist');
    cy.get('@trigger').should('be.focused').and('contain.text', '待处理');
  });

  it('keeps a long, scrollable menu inside a 960 by 640 viewport', () => {
    cy.viewport(960, 640);
    const options = Array.from({ length: 40 }, (_, index) => ({
      value: `column-${index}`,
      label: index === 39
        ? '这是一个非常长的、由用户输入的列表名称，用于验证菜单不会突破窗口边界并且完整名称仍然可以被辅助技术读取'
        : `列表 ${index + 1}`,
    }));
    cy.mount(
      <div style={{ minHeight: 620, display: 'grid', placeItems: 'end', padding: 12 }}>
        <SelectHarness options={options} />
      </div>,
    );
    cy.findByRole('combobox', { name: '所在列表' }).click();
    cy.get('[data-taskpilot-select-content]').should(($content) => {
      const rect = $content[0].getBoundingClientRect();
      expect(rect.left).to.be.at.least(0);
      expect(rect.top).to.be.at.least(0);
      expect(rect.right).to.be.at.most(960);
      expect(rect.bottom).to.be.at.most(640);
    });
    cy.findByRole('option', { name: options.at(-1)?.label }).scrollIntoView().should('be.visible');
    cy.document().then((document) => {
      expect(document.documentElement.scrollWidth).to.be.at.most(960);
    });
  });

  it('renders above a clipped dialog surface and removes spatial motion when requested', () => {
    cy.then(() => Cypress.automation('remote:debugger:protocol', {
      command: 'Emulation.setEmulatedMedia',
      params: { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] },
    }));
    cy.mount(
      <div className="modal-backdrop">
        <section className="project-dialog" role="dialog" aria-label="编辑工作项" style={{ overflow: 'hidden' }}>
          <SelectHarness />
        </section>
      </div>,
    );
    cy.findByRole('combobox', { name: '所在列表' }).click();
    cy.get('[data-taskpilot-select-content]').should('be.visible').and(($content) => {
      expect($content[0].closest('[data-cy-root]')).to.equal(null);
      expect($content[0].parentElement?.parentElement).to.equal(document.body);
      const contentZ = Number.parseInt(getComputedStyle($content[0]).zIndex, 10);
      const dialogZ = Number.parseInt(getComputedStyle(document.querySelector('.modal-backdrop')!).zIndex, 10);
      expect(contentZ).to.be.greaterThan(dialogZ);
    });

    cy.get('[data-taskpilot-select-content]').should(($content) => {
      expect(getComputedStyle($content[0]).animationName).to.equal('none');
    });
    cy.then(() => Cypress.automation('remote:debugger:protocol', {
      command: 'Emulation.setEmulatedMedia',
      params: { features: [] },
    }));
  });
});
