import { BoardWorkspace } from '../../src/renderer/board-workspace';
import { LocaleProvider } from '../../src/renderer/i18n/locale-context';
import type {
  BoardResponseKey,
  BoardView,
  ProjectView,
  TaskPilotDesktopApi,
  WorkItemView,
} from '../../src/shared/contracts';

const userId = '11111111-1111-4111-8111-111111111111';
const workspaceId = '22222222-2222-4222-8222-222222222222';
const projectId = '33333333-3333-4333-8333-333333333333';
const boardId = '44444444-4444-4444-8444-444444444444';
const todoId = '55555555-5555-4555-8555-555555555555';
const doingId = '66666666-6666-4666-8666-666666666666';
const workItemId = '77777777-7777-4777-8777-777777777777';
const targetWorkItemId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const lastTargetWorkItemId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const now = '2026-10-15T00:00:00Z';
const project: ProjectView = {
  projectId,
  workspaceId,
  name: 'A long user-authored project name that remains readable at minimum width',
  description:
    'User-authored content is preserved while product controls change language.',
  status: 'ACTIVE',
  version: 0,
  createdAt: now,
  updatedAt: now,
  archivedAt: null,
};
const initialBoard: BoardView = {
  boardId,
  projectId,
  name: 'A user-authored release board with a deliberately long name',
  description: '',
  version: 3,
  createdAt: now,
  updatedAt: now,
  columns: [
    {
      columnId: todoId,
      name: 'A very long user-authored backlog column',
      position: 0,
      version: 0,
      createdAt: now,
      updatedAt: now,
      cards: [
        {
          workItemId,
          title:
            'Prepare a release candidate with a deliberately long user-authored title',
          description: 'Verify the upgrade steps and rollback notes.',
          lifecycle: 'OPEN',
          workItemVersion: 0,
          placementVersion: 0,
          position: 0,
        },
      ],
    },
    {
      columnId: doingId,
      name: 'In progress',
      position: 1,
      version: 0,
      createdAt: now,
      updatedAt: now,
      cards: [],
    },
    {
      columnId: '88888888-8888-4888-8888-888888888888',
      name: 'Review',
      position: 2,
      version: 0,
      createdAt: now,
      updatedAt: now,
      cards: [],
    },
    {
      columnId: '99999999-9999-4999-8999-999999999999',
      name: 'Ready to ship',
      position: 3,
      version: 0,
      createdAt: now,
      updatedAt: now,
      cards: [],
    },
  ],
};
const boardWithTargetCards: BoardView = {
  ...initialBoard,
  columns: initialBoard.columns.map((column) =>
    column.columnId === doingId
      ? {
          ...column,
          cards: [
            {
              ...initialBoard.columns[0].cards[0],
              workItemId: targetWorkItemId,
              title: 'Check the release notes',
              position: 0,
            },
            {
              ...initialBoard.columns[0].cards[0],
              workItemId: lastTargetWorkItemId,
              title: 'Notify pilot users',
              position: 1,
            },
          ],
        }
      : column,
  ),
};
const key = (generation = 0): BoardResponseKey => ({
  sessionGeneration: 2,
  userId,
  workspaceId,
  projectId,
  boardId,
  boardGeneration: generation,
});
const summary = (board: BoardView) => ({
  boardId: board.boardId,
  projectId: board.projectId,
  name: board.name,
  description: board.description,
  version: board.version,
  createdAt: board.createdAt,
  updatedAt: board.updatedAt,
});
const item = (board: BoardView): WorkItemView => {
  const card = board.columns.flatMap((column) => column.cards)[0];
  return {
    workItemId: card.workItemId,
    projectId,
    title: card.title,
    description: card.description,
    lifecycle: card.lifecycle,
    version: card.workItemVersion,
    createdAt: now,
    updatedAt: now,
  };
};
const movedBoard = (
  title = initialBoard.columns[0].cards[0].title,
): BoardView => {
  const card = initialBoard.columns[0].cards[0];
  return {
    ...initialBoard,
    version: 4,
    columns: initialBoard.columns.map((column) =>
      column.columnId === todoId
        ? { ...column, cards: [] }
        : column.columnId === doingId
          ? {
              ...column,
              cards: [
                {
                  ...card,
                  title,
                  workItemVersion: title === card.title ? 0 : 1,
                  placementVersion: 1,
                  position: 0,
                },
              ],
            }
          : column,
    ),
  };
};

function apiFor(
  moveResult: 'success' | 'failure' = 'success',
  board: BoardView = initialBoard,
): TaskPilotDesktopApi {
  const moveCard =
    moveResult === 'success'
      ? cy.stub().resolves({ key: key(1), value: movedBoard() })
      : cy.stub().rejects(new Error('conflict'));
  const edited = movedBoard('Prepare the final release candidate');
  return {
    auth: {
      getCapabilities: cy.stub(),
      startGitHubSignIn: cy.stub(),
      continueGitHubSignIn: cy.stub(),
      completeGitHubRegistration: cy.stub(),
      cancelGitHubSignIn: cy.stub(),
      getSessionView: cy.stub(),
      subscribeSessionView: cy.stub(),
      logout: cy.stub(),
    },
    workspaces: { list: cy.stub() },
    projects: {
      resolveHome: cy.stub(),
      list: cy.stub(),
      open: cy.stub(),
      create: cy.stub(),
      edit: cy.stub(),
      archive: cy.stub(),
      restore: cy.stub(),
      permanentlyDelete: cy.stub(),
    },
    boards: {
      resolveHome: cy.stub().resolves({
        key: key(),
        value: { boards: [summary(board)], currentBoard: board },
      }),
      list: cy.stub().resolves({ key: key(), value: [summary(board)] }),
      open: cy.stub().resolves({ key: key(2), value: board }),
      create: cy.stub(),
      edit: cy.stub(),
      createColumn: cy.stub(),
      editColumn: cy.stub(),
      reorderColumns: cy.stub(),
      deleteColumn: cy.stub(),
      createWorkItem: cy.stub(),
      openWorkItem: cy
        .stub()
        .resolves({ key: key(), value: item(initialBoard) }),
      editWorkItem: cy.stub().resolves({
        key: key(1),
        value: { workItem: item(edited), board: edited },
      }),
      moveCard,
    },
  };
}

type MousePoint = { x: number; y: number };

function pointInTopLevelViewport(
  element: HTMLElement,
  xRatio = 0.5,
  yRatio = 0.5,
): MousePoint {
  const bounds = element.getBoundingClientRect();
  const point = {
    x: bounds.left + bounds.width * xRatio,
    y: bounds.top + bounds.height * yRatio,
  };
  let currentWindow = element.ownerDocument.defaultView;
  while (currentWindow && currentWindow !== currentWindow.top) {
    const parentWindow = currentWindow.parent;
    const frame =
      (currentWindow.frameElement as HTMLIFrameElement | null) ??
      [...parentWindow.document.querySelectorAll('iframe')].find(
        (candidate) => candidate.contentWindow === currentWindow,
      );
    if (!frame) throw new Error('Unable to locate the Cypress AUT frame');
    const frameBounds = frame.getBoundingClientRect();
    const frameScale = frameBounds.width / frame.offsetWidth;
    point.x = frameBounds.left + point.x * frameScale;
    point.y = frameBounds.top + point.y * frameScale;
    currentWindow = parentWindow;
  }
  return point;
}

async function dispatchChromiumMouse(
  type: 'mouseMoved' | 'mousePressed' | 'mouseReleased',
  point: MousePoint,
  pressed: boolean,
) {
  await Cypress.automation('remote:debugger:protocol', {
    command: 'Input.dispatchMouseEvent',
    params: {
      type,
      x: point.x,
      y: point.y,
      button: 'left',
      buttons: pressed ? 1 : 0,
      clickCount: 1,
      pointerType: 'mouse',
    },
  });
}

async function dragWithRealChromiumMouse(
  source: HTMLElement,
  target: HTMLElement,
) {
  const from = pointInTopLevelViewport(source);
  const to = pointInTopLevelViewport(target, 0.5, 0.72);
  await dispatchChromiumMouse('mouseMoved', from, false);
  await dispatchChromiumMouse('mousePressed', from, true);
  for (let step = 1; step <= 12; step += 1) {
    const progress = step / 12;
    await dispatchChromiumMouse(
      'mouseMoved',
      {
        x: from.x + (to.x - from.x) * progress,
        y: from.y + (to.y - from.y) * progress,
      },
      true,
    );
    await Cypress.Promise.delay(16);
  }
  await dispatchChromiumMouse('mouseReleased', to, false);
}

function mountBoard(
  api: TaskPilotDesktopApi,
  locale: 'zh-CN' | 'en' = 'en',
) {
  cy.mount(
    <LocaleProvider initialLanguages={[locale]}>
      <BoardWorkspace
        api={api}
        userId={userId}
        workspaceId={workspaceId}
        project={project}
        onSettings={cy.stub()}
      />
    </LocaleProvider>,
  );
}

describe('Project Board experience', () => {
  beforeEach(() => cy.viewport(960, 640));

  it('keeps long bilingual content and taller Cards usable at minimum width', () => {
    const api = apiFor();
    mountBoard(api, 'en');
    cy.findByRole('button', { name: 'New board' }).should('be.visible');
    cy.findByRole('heading', { name: project.name }).should('be.visible');
    cy.contains(initialBoard.columns[0].name).should('be.visible');
    cy.findByRole('button', {
      name: initialBoard.columns[0].cards[0].title,
    })
      .closest('.board-card')
      .should(($card) => {
        expect(Number.parseFloat(getComputedStyle($card[0]).minHeight)).to.be.at
          .least(84);
      });
    cy.get('.board-columns').then(($columns) => {
      expect($columns[0].scrollWidth).to.be.greaterThan(
        $columns[0].clientWidth,
      );
      expect(getComputedStyle($columns[0]).overflowX).to.equal('auto');
    });
    cy.get('.board-columns')
      .scrollTo('right', { duration: 0 })
      .scrollTo('left', { duration: 0 })
      .wait(160)
      .should(($columns) => {
        const columns = $columns[0];
        const firstColumn = columns.querySelector<HTMLElement>('.board-column');
        expect(columns.scrollLeft).to.equal(0);
        expect(firstColumn).not.to.equal(null);
        expect(
          Math.round(
            firstColumn!.getBoundingClientRect().left -
              columns.getBoundingClientRect().left,
          ),
        ).to.equal(Number.parseFloat(getComputedStyle(columns).paddingLeft));
      });
    cy.document().then((document) => {
      expect(document.documentElement.scrollWidth).to.be.at.most(
        document.documentElement.clientWidth,
      );
      const reducedMotionRules = [...document.styleSheets].flatMap(
        (sheet) => {
          try {
            return [...sheet.cssRules].filter(
              (rule): rule is CSSMediaRule =>
                rule instanceof CSSMediaRule &&
                rule.conditionText === '(prefers-reduced-motion: reduce)',
            );
          } catch {
            return [];
          }
        },
      );
      const motionRules = reducedMotionRules.flatMap((rule) => [
        ...rule.cssRules,
      ]);
      const disablesAnimation = (selector: string) =>
        motionRules.some(
          (rule) =>
            rule instanceof CSSStyleRule &&
            rule.selectorText.split(',').some(
              (candidate) => candidate.trim() === selector,
            ) &&
            rule.style.animationName === 'none',
        );
      expect(reducedMotionRules.length).to.be.greaterThan(0);
      expect(disablesAnimation('.board-card.is-settling')).to.equal(true);
      expect(disablesAnimation('.board-drop-slot')).to.equal(true);
    });
  });

  it('moves a Card through a real Chromium mouse drag session', () => {
    if (Cypress.browser.family !== 'chromium') {
      cy.log('Native drag evidence runs only in Chromium');
      return;
    }

    const api = apiFor();
    mountBoard(api, 'en');
    cy.findByRole('button', {
      name: initialBoard.columns[0].cards[0].title,
    })
      .closest('.board-card')
      .then(($source) => {
        cy.findByRole('heading', { name: 'In progress' })
          .closest('.board-column')
          .then(($target) =>
            cy.then(() =>
              dragWithRealChromiumMouse($source[0], $target[0]),
            ),
          );
      });

    cy.wrap(api.boards.moveCard).should('have.been.calledOnceWith', {
      workspaceId,
      projectId,
      boardId,
      workItemId,
      expectedBoardVersion: 3,
      expectedPlacementVersion: 0,
      targetColumnId: doingId,
    });
    cy.findByRole('heading', { name: 'In progress' })
      .closest('.board-column')
      .should('contain.text', initialBoard.columns[0].cards[0].title);
  });

  it('drags a Card with source, target, insertion, and settle feedback', () => {
    const api = apiFor();
    mountBoard(api, 'zh-CN');
    const transfer = new DataTransfer();
    cy.findByRole('button', {
      name: initialBoard.columns[0].cards[0].title,
    })
      .closest('.board-card')
      .as('card')
      .trigger('dragstart', { dataTransfer: transfer })
      .should('have.class', 'is-dragging')
      .and(($card) => {
        expect(Number.parseFloat(getComputedStyle($card[0]).opacity)).to.equal(
          0,
        );
      });
    cy.findByRole('heading', { name: 'In progress' })
      .closest('.board-column')
      .as('target')
      .trigger('dragover', { dataTransfer: transfer })
      .should('have.class', 'is-drop-target')
      .find('.board-drop-slot')
      .should('have.length', 1)
      .and('be.visible');
    cy.get('@target').trigger('drop', { dataTransfer: transfer });
    cy.wrap(api.boards.moveCard).should('have.been.calledOnceWith', {
      workspaceId,
      projectId,
      boardId,
      workItemId,
      expectedBoardVersion: 3,
      expectedPlacementVersion: 0,
      targetColumnId: doingId,
    });
    cy.findByRole('heading', { name: 'In progress' })
      .closest('.board-column')
      .should('contain.text', initialBoard.columns[0].cards[0].title)
      .find('.board-card')
      .should('have.class', 'is-settling');
    cy.findByRole('button', {
      name: initialBoard.columns[0].cards[0].title,
    }).should('be.focused');
    cy.wait(220);
    cy.findByRole('button', {
      name: initialBoard.columns[0].cards[0].title,
    })
      .closest('.board-card')
      .should('not.have.class', 'is-settling');
  });

  it('uses the pointer edge to place a Card at a specific position', () => {
    const api = apiFor('success', boardWithTargetCards);
    mountBoard(api, 'en');
    cy.window().then((window) => {
      cy.spy(window.Element.prototype, 'animate').as('layoutAnimation');
    });
    const transfer = new DataTransfer();
    cy.findByRole('button', {
      name: initialBoard.columns[0].cards[0].title,
    })
      .closest('.board-card')
      .trigger('dragstart', { dataTransfer: transfer });
    cy.get(`[data-work-item-id="${lastTargetWorkItemId}"]`).then(
      ($targetCard) => {
        const bounds = $targetCard[0].getBoundingClientRect();
        const clientY = bounds.top + bounds.height * 0.25;
        cy.findByRole('heading', { name: 'In progress' })
          .closest('.board-column')
          .as('targetColumn')
          .trigger('dragover', { dataTransfer: transfer, clientY })
          .should('have.class', 'is-drop-target')
          .find('.board-drop-slot')
          .should('have.length', 1)
          .then(($slot) => {
            expect($slot[0].nextElementSibling).to.equal($targetCard[0]);
            expect($slot[0].previousElementSibling).to.have.attr(
              'data-work-item-id',
              targetWorkItemId,
            );
          });
        cy.get('@layoutAnimation').should(
          'have.been.calledWithMatch',
          Cypress.sinon.match((keyframes: Keyframe[]) =>
            keyframes.some((keyframe) =>
              String(keyframe.transform).startsWith('translate3d('),
            ),
          ),
          Cypress.sinon.match({
            duration: 180,
            easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
          }),
        );
        cy.get('@targetColumn').trigger('drop', {
          dataTransfer: transfer,
          clientY,
        });
      },
    );
    cy.wrap(api.boards.moveCard).should('have.been.calledOnceWith', {
      workspaceId,
      projectId,
      boardId,
      workItemId,
      expectedBoardVersion: 3,
      expectedPlacementVersion: 0,
      targetColumnId: doingId,
      beforeWorkItemId: lastTargetWorkItemId,
    });
  });

  it('does not animate Card reflow when reduced motion is requested', () => {
    cy.window().then((window) => {
      cy.stub(window, 'matchMedia').callsFake(
        (query) =>
          ({
            matches: query === '(prefers-reduced-motion: reduce)',
            media: query,
            onchange: null,
            addListener: () => undefined,
            removeListener: () => undefined,
            addEventListener: () => undefined,
            removeEventListener: () => undefined,
            dispatchEvent: () => true,
          }) as MediaQueryList,
      );
      cy.spy(window.Element.prototype, 'animate').as('layoutAnimation');
    });
    mountBoard(apiFor('success', boardWithTargetCards), 'en');
    const transfer = new DataTransfer();
    cy.findByRole('button', {
      name: initialBoard.columns[0].cards[0].title,
    })
      .closest('.board-card')
      .trigger('dragstart', { dataTransfer: transfer });
    cy.get(`[data-work-item-id="${lastTargetWorkItemId}"]`).then(
      ($targetCard) => {
        const bounds = $targetCard[0].getBoundingClientRect();
        cy.findByRole('heading', { name: 'In progress' })
          .closest('.board-column')
          .trigger('dragover', {
            dataTransfer: transfer,
            clientY: bounds.top + bounds.height * 0.25,
          });
      },
    );
    cy.get('@layoutAnimation').should('not.have.been.called');
  });

  it('edits content and Column atomically without a separate move control', () => {
    const api = apiFor();
    mountBoard(api, 'zh-CN');
    cy.findByRole('button', {
      name: `移动${initialBoard.columns[0].cards[0].title}`,
    }).should('not.exist');
    cy.findByRole('button', {
      name: initialBoard.columns[0].cards[0].title,
    }).click();
    cy.findByLabelText('标题')
      .clear()
      .type('Prepare the final release candidate');
    cy.findByRole('combobox', { name: '所在列表' }).click();
    cy.findByRole('option', { name: 'In progress' }).click();
    cy.findByRole('button', { name: '保存更改' }).click();
    cy.wrap(api.boards.editWorkItem).should('have.been.calledOnceWith', {
      workspaceId,
      projectId,
      boardId,
      workItemId,
      currentColumnId: todoId,
      targetColumnId: doingId,
      expectedBoardVersion: 3,
      expectedPlacementVersion: 0,
      expectedVersion: 0,
      title: 'Prepare the final release candidate',
      description: 'Verify the upgrade steps and rollback notes.',
    });
    cy.findByRole('heading', { name: 'In progress' })
      .closest('.board-column')
      .should('contain.text', 'Prepare the final release candidate');
    cy.findByRole('button', {
      name: 'Prepare the final release candidate',
    }).should('be.focused');
  });

  it('layers Select and Dialog Escape and restores focus to the Column trigger', () => {
    const api = apiFor();
    mountBoard(api, 'zh-CN');
    cy.findByRole('button', {
      name: initialBoard.columns[0].cards[0].title,
    }).click();
    cy.findByRole('combobox', { name: '所在列表' }).as('columnTrigger').click();
    cy.findByRole('option', { name: 'In progress' }).should('be.visible');

    cy.focused().type('{esc}');
    cy.findByRole('option', { name: 'In progress' }).should('not.exist');
    cy.findByRole('dialog', { name: '编辑工作项' }).should('be.visible');
    cy.get('@columnTrigger').should('be.focused');

    cy.focused().type('{esc}');
    cy.findByRole('dialog', { name: '编辑工作项' }).should('not.exist');
  });

  it('disables Column selection while saving and preserves the submitted target', () => {
    const api = apiFor();
    const pending = new Promise<never>(() => undefined);
    api.boards.editWorkItem = cy.stub().returns(pending);
    mountBoard(api, 'zh-CN');
    cy.findByRole('button', {
      name: initialBoard.columns[0].cards[0].title,
    }).click();
    cy.findByRole('combobox', { name: '所在列表' }).as('columnTrigger').click();
    cy.findByRole('option', { name: 'In progress' }).click();
    cy.findByRole('button', { name: '保存更改' }).click();

    cy.get('@columnTrigger').should('be.disabled').click({ force: true });
    cy.findByRole('option', { name: 'A very long user-authored backlog column' }).should('not.exist');
    cy.wrap(api.boards.editWorkItem).should('have.been.calledOnceWith', {
      workspaceId,
      projectId,
      boardId,
      workItemId,
      currentColumnId: todoId,
      targetColumnId: doingId,
      expectedBoardVersion: 3,
      expectedPlacementVersion: 0,
      expectedVersion: 0,
      title: initialBoard.columns[0].cards[0].title,
      description: initialBoard.columns[0].cards[0].description,
    });
  });

  it('rolls back a failed drag, announces one error, and reloads authority', () => {
    const api = apiFor('failure');
    mountBoard(api, 'zh-CN');
    const transfer = new DataTransfer();
    cy.findByRole('button', {
      name: initialBoard.columns[0].cards[0].title,
    })
      .closest('.board-card')
      .trigger('dragstart', { dataTransfer: transfer });
    cy.findByRole('heading', { name: 'In progress' })
      .closest('.board-column')
      .trigger('dragover', { dataTransfer: transfer })
      .trigger('drop', { dataTransfer: transfer });
    cy.findAllByRole('alert')
      .should('have.length', 1)
      .and('contain.text', '已恢复原布局');
    cy.findByRole('heading', {
      name: initialBoard.columns[0].name,
    })
      .closest('.board-column')
      .should('contain.text', initialBoard.columns[0].cards[0].title);
    cy.findByRole('button', { name: '重新加载' }).click();
    cy.wrap(api.boards.resolveHome).should('have.been.calledTwice');
  });
});
