import { BoardWorkspace } from '../../src/renderer/features/board/board-workspace';
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
      permanentlyDelete: cy.stub(),
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

type GeometryAxis = 'left' | 'right' | 'top' | 'bottom' | 'width' | 'height';
type AxisBounds = Record<GeometryAxis, number>;
type WorkSheetGeometry = {
  sheet: AxisBounds | null;
  close: AxisBounds | null;
  footer: AxisBounds | null;
};

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

async function dispatchChromiumTab() {
  const key = {
    key: 'Tab',
    code: 'Tab',
    windowsVirtualKeyCode: 9,
    nativeVirtualKeyCode: 9,
  };
  await Cypress.automation('remote:debugger:protocol', {
    command: 'Input.dispatchKeyEvent',
    params: { type: 'rawKeyDown', ...key },
  });
  await Cypress.automation('remote:debugger:protocol', {
    command: 'Input.dispatchKeyEvent',
    params: { type: 'keyUp', ...key },
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
        onLeaveProject={cy.stub().as('leaveProject')}
      />
    </LocaleProvider>,
  );
}

describe('Project Board experience', () => {
  beforeEach(() => cy.viewport(960, 640));

  it('deletes an empty Board from the keyboard and uses the authoritative zero-Board home', () => {
    const emptyBoard: BoardView = {
      ...initialBoard,
      columns: initialBoard.columns.map((column) => ({ ...column, cards: [] })),
    };
    const api = apiFor('success', emptyBoard);
    api.boards.permanentlyDelete = cy.stub().resolves({
      key: { ...key(1), boardId: undefined, boardGeneration: undefined },
      value: { outcome: 'deleted', home: { boards: [] } },
    });
    mountBoard(api, 'en');

    cy.findByRole('button', { name: 'Board actions' })
      .focus()
      .trigger('keydown', { key: 'Enter' });
    cy.findByRole('menuitem', { name: 'Permanently delete board' })
      .should('be.focused')
      .trigger('keydown', { key: 'Enter' });
    cy.findByRole('dialog', {
      name: `Permanently delete “${emptyBoard.name}”?`,
    }).should('be.visible');
    cy.findByLabelText(`Type “${emptyBoard.name}” to confirm`)
      .type(emptyBoard.name)
      .type('{enter}');

    cy.wrap(api.boards.permanentlyDelete).should('have.been.calledOnceWith', {
      workspaceId,
      projectId,
      boardId,
      expectedVersion: 3,
      confirmationName: emptyBoard.name,
    });
    cy.findByRole('heading', { name: 'No boards yet' }).should('be.visible');
    cy.findByRole('button', { name: 'New board' }).should('be.visible');
  });

  it('gates dirty Escape, blocks duplicate pending submission, and restores Board action focus', () => {
    const emptyBoard: BoardView = {
      ...initialBoard,
      columns: initialBoard.columns.map((column) => ({ ...column, cards: [] })),
    };
    const api = apiFor('success', emptyBoard);
    let resolveDelete!: (value: unknown) => void;
    const pending = new Cypress.Promise((resolve) => { resolveDelete = resolve; });
    api.boards.permanentlyDelete = cy.stub().returns(pending);
    mountBoard(api, 'zh-CN');

    cy.findByRole('button', { name: '看板操作' }).as('actions').click();
    cy.findByRole('menuitem', { name: '永久删除看板' }).click();
    cy.findByLabelText(`输入“${emptyBoard.name}”以确认`).type('部分名称{esc}');
    cy.findByRole('dialog', { name: '放弃删除确认？' }).should('be.visible');
    cy.findByRole('button', { name: '继续确认' }).click();
    cy.findByLabelText(`输入“${emptyBoard.name}”以确认`)
      .should('have.value', '部分名称')
      .clear()
      .type(emptyBoard.name);
    cy.findByRole('button', { name: '永久删除' }).click();
    cy.findByRole('button', { name: '正在删除…' })
      .should('be.disabled')
      .click({ force: true });
    cy.wrap(api.boards.permanentlyDelete).should('have.been.calledOnce');

    cy.then(() => resolveDelete({
      key: key(1),
      value: {
        outcome: 'notDeleted',
        home: { boards: [summary(emptyBoard)], currentBoard: emptyBoard },
      },
    }));
    cy.findByRole('alert').should('contain.text', '看板未被删除');
    cy.get('@actions').should('be.focused');
  });

  it('restricts an unknown deletion result to retry reconciliation or leave Project', () => {
    const emptyBoard: BoardView = {
      ...initialBoard,
      columns: initialBoard.columns.map((column) => ({ ...column, cards: [] })),
    };
    const api = apiFor('success', emptyBoard);
    api.boards.permanentlyDelete = cy.stub()
      .onFirstCall().rejects({
        code: 'BOARD_DELETE_RESULT_UNKNOWN',
        recovery: 'RETRY',
      })
      .onSecondCall().rejects({ code: 'BOARD_DELETE_RESULT_UNKNOWN' });
    mountBoard(api, 'zh-CN');
    cy.findByRole('button', { name: '看板操作' }).click();
    cy.findByRole('menuitem', { name: '永久删除看板' }).click();
    cy.findByLabelText(`输入“${emptyBoard.name}”以确认`).type(emptyBoard.name);
    cy.findByRole('button', { name: '永久删除' }).click();

    cy.findByRole('heading', { name: '删除结果暂时未知' }).should('be.visible');
    cy.findByRole('button', { name: '编辑看板' }).should('not.exist');
    cy.findByRole('button', { name: '添加工作项' }).should('not.exist');
    cy.wrap(api.boards.permanentlyDelete).should('have.been.calledOnce');
    cy.findByRole('button', { name: '重试确认结果' }).click();
    cy.wrap(api.boards.resolveHome).should('have.been.calledTwice');
    cy.wrap(api.boards.permanentlyDelete).should('have.been.calledOnce');

    cy.findByRole('button', { name: '看板操作' }).click();
    cy.findByRole('menuitem', { name: '永久删除看板' }).click();
    cy.findByLabelText(`输入“${emptyBoard.name}”以确认`).type(emptyBoard.name);
    cy.findByRole('button', { name: '永久删除' }).click();
    cy.findByRole('button', { name: '离开项目' }).click();
    cy.get('@leaveProject').should('have.been.calledOnce');
  });

  it('keeps a long bilingual deletion confirmation usable at 960x640 with reduced motion', () => {
    const longBoard: BoardView = {
      ...initialBoard,
      name: '发布准备 Release readiness · 一个很长但必须完整保留的用户看板名称',
      columns: initialBoard.columns.map((column) => ({ ...column, cards: [] })),
    };
    const api = apiFor('success', longBoard);
    mountBoard(api, 'zh-CN');
    cy.findByRole('button', { name: '看板操作' }).click();
    cy.findByRole('menuitem', { name: '永久删除看板' }).click();
    cy.findByRole('dialog', { name: `永久删除“${longBoard.name}”？` })
      .should('be.visible')
      .and(($dialog) => {
        const bounds = $dialog[0].getBoundingClientRect();
        expect(bounds.left).to.be.at.least(0);
        expect(bounds.right).to.be.at.most(960);
        expect(bounds.bottom).to.be.at.most(640);
      });
    cy.findByLabelText(`输入“${longBoard.name}”以确认`).should('be.visible');
    cy.document().then((document) => {
      const reducedMotionRules = [...document.styleSheets].flatMap((sheet) => {
        try {
          return [...sheet.cssRules].filter(
            (rule): rule is CSSMediaRule =>
              rule instanceof CSSMediaRule &&
              rule.conditionText === '(prefers-reduced-motion: reduce)',
          );
        } catch {
          return [];
        }
      });
      expect(reducedMotionRules.length).to.be.greaterThan(0);
      expect(document.documentElement.scrollWidth).to.be.at.most(
        document.documentElement.clientWidth,
      );
    });
  });

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

  it('loads authoritative read-only detail, then saves title and multiline description field by field', () => {
    const api = apiFor();
    const authoritative = {
      ...item(initialBoard),
      title: 'Server-confirmed title',
      description: 'Server-confirmed description',
      version: 4,
    };
    let resolveDetail: ((value: unknown) => void) | undefined;
    api.boards.openWorkItem = cy.stub().returns(
      new Promise((resolve) => {
        resolveDetail = resolve;
      }),
    );
    const titleBoard: BoardView = {
      ...initialBoard,
      columns: initialBoard.columns.map((column) => ({
        ...column,
        cards: column.cards.map((card) =>
          card.workItemId === workItemId
            ? { ...card, title: 'Release candidate ready', workItemVersion: 5 }
            : card,
        ),
      })),
    };
    const descriptionBoard: BoardView = {
      ...titleBoard,
      columns: titleBoard.columns.map((column) => ({
        ...column,
        cards: column.cards.map((card) =>
          card.workItemId === workItemId
            ? { ...card, description: 'First line\nSecond line', workItemVersion: 6 }
            : card,
        ),
      })),
    };
    api.boards.editWorkItem = cy
      .stub()
      .onFirstCall()
      .resolves({
        key: key(1),
        value: {
          workItem: { ...authoritative, title: 'Release candidate ready', version: 5 },
          board: titleBoard,
        },
      })
      .onSecondCall()
      .resolves({
        key: key(2),
        value: {
          workItem: {
            ...authoritative,
            title: 'Release candidate ready',
            description: 'First line\nSecond line',
            version: 6,
          },
          board: descriptionBoard,
        },
      });

    mountBoard(api, 'zh-CN');
    cy.findByRole('button', {
      name: initialBoard.columns[0].cards[0].title,
    }).click();
    cy.findByRole('dialog', { name: initialBoard.columns[0].cards[0].title })
      .should('contain.text', '正在加载')
      .and('not.contain.text', initialBoard.columns[0].cards[0].description);
    cy.wrap(api.boards.openWorkItem).should('have.been.calledOnceWith', {
      workspaceId,
      projectId,
      boardId,
      workItemId,
    });
    cy.then(() =>
      resolveDetail?.({ key: key(), value: authoritative }),
    );

    cy.findByRole('heading', { name: 'Server-confirmed title' }).should('be.focused');
    cy.findByRole('button', { name: '编辑标题' })
      .should('contain.text', 'Server-confirmed title')
      .and('not.be.focused');
    cy.findByRole('button', { name: '编辑描述' }).should(
      'contain.text',
      'Server-confirmed description',
    );
    cy.findByText('进行中').should('not.exist');
    cy.findByText('创建时间').should('be.visible');
    cy.findByRole('textbox', { name: '标题' }).should('not.exist');

    cy.findByRole('button', { name: '编辑标题' }).click();
    cy.findByRole('textbox', { name: '标题' })
      .clear()
      .type('Release candidate ready{enter}');
    cy.wrap(api.boards.editWorkItem).should('have.been.calledWith', {
      workspaceId,
      projectId,
      boardId,
      workItemId,
      currentColumnId: todoId,
      targetColumnId: todoId,
      expectedVersion: 4,
      title: 'Release candidate ready',
      description: 'Server-confirmed description',
    });
    cy.findByRole('button', { name: '编辑标题' })
      .should('contain.text', 'Release candidate ready')
      .and('be.focused');

    cy.findByRole('button', { name: '编辑描述' }).click();
    cy.findByRole('textbox', { name: '描述' })
      .clear()
      .type('First line{enter}Second line')
      .should('have.value', 'First line\nSecond line');
    cy.wrap(api.boards.editWorkItem).should('have.been.calledOnce');
    cy.findByRole('textbox', { name: '描述' }).type('{ctrl}{enter}');
    cy.wrap(api.boards.editWorkItem).should('have.been.calledTwice');
    cy.wrap(api.boards.editWorkItem).should('have.been.calledWith', {
      workspaceId,
      projectId,
      boardId,
      workItemId,
      currentColumnId: todoId,
      targetColumnId: todoId,
      expectedVersion: 5,
      title: 'Release candidate ready',
      description: 'First line\nSecond line',
    });
    cy.findByRole('button', { name: '编辑描述' })
      .should('contain.text', 'First line')
      .and('be.focused');
  });

  it('layers field Escape, implicit close save, and Card focus without a dirty gate', () => {
    const api = apiFor();
    const savedBoard: BoardView = {
      ...initialBoard,
      columns: initialBoard.columns.map((column) => ({
        ...column,
        cards: column.cards.map((card) =>
          card.workItemId === workItemId
            ? { ...card, title: 'Saved while closing', workItemVersion: 1 }
            : card,
        ),
      })),
    };
    api.boards.editWorkItem = cy.stub().resolves({
      key: key(1),
      value: {
        workItem: { ...item(savedBoard), title: 'Saved while closing', version: 1 },
        board: savedBoard,
      },
    });
    mountBoard(api, 'zh-CN');
    cy.findByRole('button', {
      name: initialBoard.columns[0].cards[0].title,
    }).as('card').click();
    cy.findByRole('button', { name: '编辑标题' }).click();
    cy.findByRole('textbox', { name: '标题' }).clear().type('Discard this draft{esc}');
    cy.findByRole('group', { name: '有未保存的更改' }).should('not.exist');
    cy.findByRole('button', { name: '编辑标题' })
      .should('contain.text', initialBoard.columns[0].cards[0].title)
      .and('be.focused');
    cy.wrap(api.boards.editWorkItem).should('not.have.been.called');

    cy.findByRole('button', { name: '编辑标题' }).click();
    cy.findByRole('textbox', { name: '标题' }).clear().type('Saved while closing');
    cy.findByRole('button', { name: '关闭' }).click();
    cy.findByRole('group', { name: '有未保存的更改' }).should('not.exist');
    cy.findByRole('dialog').should('not.exist');
    cy.findByRole('button', { name: 'Saved while closing' }).should('be.focused');
    cy.wrap(api.boards.editWorkItem).should('have.been.calledOnce');
  });

  it('keeps a revised title draft after conflict and retries the revision against latest authority', () => {
    const api = apiFor();
    const latestBoard: BoardView = {
      ...initialBoard,
      version: 4,
      columns: initialBoard.columns.map((column) => ({
        ...column,
        cards: column.cards.map((card) => ({
          ...card,
          title: 'Updated elsewhere',
          workItemVersion: 2,
        })),
      })),
    };
    const latestWorkItem = {
      ...item(latestBoard),
      title: 'Updated elsewhere',
      version: 2,
    };
    const revisedTitle = 'Revised after conflict';
    const revisedBoard: BoardView = {
      ...latestBoard,
      columns: latestBoard.columns.map((column) => ({
        ...column,
        cards: column.cards.map((card) =>
          card.workItemId === workItemId
            ? { ...card, title: revisedTitle, workItemVersion: 3 }
            : card,
        ),
      })),
    };
    api.boards.openWorkItem = cy
      .stub()
      .onFirstCall()
      .resolves({ key: key(), value: item(initialBoard) })
      .onSecondCall()
      .resolves({ key: key(1), value: latestWorkItem });
    api.boards.open = cy.stub().resolves({ key: key(1), value: latestBoard });
    api.boards.editWorkItem = cy
      .stub()
      .onFirstCall()
      .rejects(Object.assign(new Error('conflict'), { code: 'RESOURCE_VERSION_CONFLICT' }))
      .onSecondCall()
      .resolves({
        key: key(2),
        value: {
          workItem: { ...latestWorkItem, title: revisedTitle, version: 3 },
          board: revisedBoard,
        },
      });

    openDetail(api, 'en');
    cy.findByRole('button', { name: 'Edit title' }).click();
    cy.findByRole('textbox', { name: 'Title' }).clear().type('Local title{enter}');
    cy.findByRole('group', { name: 'Title conflict' }).should('be.visible');
    cy.findByRole('textbox', { name: 'Title' })
      .should('have.value', 'Local title')
      .clear()
      .type(revisedTitle);
    cy.findByRole('textbox', { name: 'Title' }).should('have.value', revisedTitle);
    cy.findByRole('button', { name: 'Retry with latest version' }).click();

    cy.wrap(api.boards.editWorkItem).should('have.been.calledTwice');
    cy.wrap(api.boards.editWorkItem).should('have.been.calledWith', {
      workspaceId,
      projectId,
      boardId,
      workItemId,
      currentColumnId: todoId,
      targetColumnId: todoId,
      expectedVersion: 2,
      title: revisedTitle,
      description: latestWorkItem.description,
    });
    cy.findByRole('button', { name: 'Edit title' })
      .should('contain.text', revisedTitle);
  });

  it('can discard a conflicted draft without mutating the latest authority', () => {
    const api = apiFor();
    const latestBoard: BoardView = {
      ...initialBoard,
      version: 4,
      columns: initialBoard.columns.map((column) => ({
        ...column,
        cards: column.cards.map((card) => ({ ...card, placementVersion: 2 })),
      })),
    };
    api.boards.openWorkItem = cy
      .stub()
      .onFirstCall()
      .resolves({ key: key(), value: item(initialBoard) })
      .onSecondCall()
      .resolves({ key: key(1), value: item(latestBoard) });
    api.boards.open = cy.stub().resolves({ key: key(1), value: latestBoard });
    api.boards.editWorkItem = cy
      .stub()
      .rejects(Object.assign(new Error('conflict'), { code: 'PLACEMENT_CONFLICT' }));

    mountBoard(api, 'zh-CN');
    cy.findByRole('button', {
      name: initialBoard.columns[0].cards[0].title,
    }).click();
    cy.findByRole('button', { name: '编辑标题' }).click();
    cy.findByRole('textbox', { name: '标题' }).clear().type('本地草稿{enter}');
    cy.findByRole('group', { name: '标题发生冲突' }).within(() => {
      cy.findByRole('button', { name: '使用最新内容' }).click();
    });
    cy.findByRole('button', { name: '编辑标题' })
      .should('contain.text', initialBoard.columns[0].cards[0].title)
      .and('be.focused');
    cy.wrap(api.boards.editWorkItem).should('have.been.calledOnce');
  });

  it('closes safely to the current Board when an authoritative save removes the Card', () => {
    const api = apiFor();
    const withoutCard: BoardView = {
      ...initialBoard,
      version: 4,
      columns: initialBoard.columns.map((column) => ({ ...column, cards: [] })),
    };
    api.boards.editWorkItem = cy.stub().resolves({
      key: key(1),
      value: {
        workItem: { ...item(initialBoard), title: 'No longer placed', version: 1 },
        board: withoutCard,
      },
    });
    mountBoard(api, 'en');
    cy.findByRole('button', {
      name: initialBoard.columns[0].cards[0].title,
    }).click();
    cy.findByRole('button', { name: 'Edit title' }).click();
    cy.findByRole('textbox', { name: 'Title' })
      .clear()
      .type('No longer placed{enter}');
    cy.findByRole('dialog').should('not.exist');
    cy.findByRole('tab', { name: initialBoard.name }).should('be.focused');
  });

  it('keeps long bilingual detail content usable across supported window widths', () => {
    const longDetail = {
      ...item(initialBoard),
      title: '中英文混合的超长标题 Long user-authored title '.repeat(8),
      description: '第一行 long description\n第二行 '.repeat(24),
    };
    const cases = [
      { locale: 'zh-CN' as const, dialog: longDetail.title.trim(), editTitle: '编辑标题' },
      { locale: 'en' as const, dialog: longDetail.title.trim(), editTitle: 'Edit title' },
    ];
    const viewports = [
      { width: 960, height: 640, label: 'minimum' },
      { width: 1280, height: 800, label: 'standard' },
      { width: 1600, height: 900, label: 'wide' },
    ];

    for (const language of cases) {
      for (const viewport of viewports) {
        const api = apiFor();
        api.boards.openWorkItem = cy.stub().resolves({ key: key(), value: longDetail });
        cy.viewport(viewport.width, viewport.height);
        mountBoard(api, language.locale);
        cy.findByRole('button', {
          name: initialBoard.columns[0].cards[0].title,
        }).click();
        cy.findByRole('dialog', { name: language.dialog }).should('have.class', 'work-item-sheet').then(($dialog) => {
          const bounds = $dialog[0].getBoundingClientRect();
          expect(bounds.left).to.be.at.least(0);
          expect(bounds.right).to.be.at.most(viewport.width);
          expect(bounds.top).to.be.at.least(0);
          expect(bounds.bottom).to.be.at.most(viewport.height);
        });
        cy.findByRole('button', { name: language.editTitle }).should(
          'contain.text',
          '中英文混合的超长标题',
        );
        // Opening the wider sheet can place the pointer over the description at
        // the Card's former screen coordinate. Move it to the close affordance
        // before sampling the intentionally flat, non-hover field surface.
        cy.get('.work-item-sheet .icon-action').then(async ($button) => {
          await dispatchChromiumMouse('mouseMoved', pointInTopLevelViewport($button[0]), false);
        });
        cy.findByRole('dialog', { name: language.dialog }).within(() => {
          cy.findAllByRole('heading').should('have.length', 1);
          cy.findByRole('heading', { name: longDetail.title.trim() }).should('have.css', 'font-size', '26px');
          cy.findByRole('button', { name: language.locale === 'en' ? 'Edit description' : '编辑描述' })
            .should('have.css', 'font-size', '14px').and('have.css', 'box-shadow', 'none').and('have.css', 'background-color', 'rgba(0, 0, 0, 0)');
          cy.get('footer').should('have.css', 'font-size', '11px');
          cy.get('.work-item-detail__save-status').should('not.exist');
        });
        cy.get('.work-item-sheet .icon-action').then(async ($button) => {
          await dispatchChromiumMouse('mouseMoved', pointInTopLevelViewport($button[0]), false);
        });
        cy.screenshot(`work-item-detail-${language.locale}-${viewport.label}`);
      }
    }

    cy.window().then((window) => {
      const reducedMotionRules = [...window.document.styleSheets].flatMap((sheet) => {
        try {
          return [...sheet.cssRules].filter(
            (rule): rule is CSSMediaRule =>
              rule instanceof window.CSSMediaRule &&
              rule.conditionText === '(prefers-reduced-motion: reduce)',
          );
        } catch {
          return [];
        }
      });
      expect(reducedMotionRules.length).to.be.greaterThan(0);
    });
  });

  it('keeps ordinary work sheets flat under real pointer hover and keyboard focus', () => {
    for (const locale of ['zh-CN', 'en'] as const) {
      for (const viewport of [
        { width: 960, height: 640, label: 'minimum' },
        { width: 1280, height: 800, label: 'standard' },
        { width: 1600, height: 900, label: 'wide' },
      ]) {
        cy.viewport(viewport.width, viewport.height);
        mountBoard(apiFor(), locale);
        cy.findByRole('button', { name: item(initialBoard).title }).click();
        cy.findByRole('heading', { name: item(initialBoard).title }).should('be.focused');
        cy.findByRole('button', { name: locale === 'en' ? 'Edit title' : '编辑标题' })
          .should('not.be.focused');
        cy.findByRole('button', { name: locale === 'en' ? 'Edit description' : '编辑描述' })
          .then(async ($field) => {
            await dispatchChromiumMouse('mouseMoved', pointInTopLevelViewport($field[0]), false);
          })
          .should(($field) => {
            expect($field[0].matches(':hover')).to.equal(true);
            const style = getComputedStyle($field[0]);
            expect(style.transform, 'hover does not lift the field').to.equal('none');
            expect(style.boxShadow, 'hover has no floating shadow').to.equal('none');
          });
        cy.get('.work-item-sheet .icon-action').focus().then(async () => {
          await dispatchChromiumTab();
        });
        cy.findByRole('button', { name: locale === 'en' ? 'Edit description' : '编辑描述' })
          .should('be.focused')
          .should(($field) => {
            const style = getComputedStyle($field[0]);
            expect(style.transform, 'focus does not lift the field').to.equal('none');
            expect(parseFloat(style.outlineWidth), 'visible keyboard focus').to.be.at.least(2);
          });
        cy.get('.work-item-sheet .icon-action').then(async ($button) => {
          await dispatchChromiumMouse('mouseMoved', pointInTopLevelViewport($button[0]), false);
        });
        cy.get('.work-item-sheet footer').should('be.visible');
        cy.findByRole('heading', { name: item(initialBoard).title }).focus();
        cy.get('.work-item-sheet .icon-action').then(async ($button) => {
          await dispatchChromiumMouse('mouseMoved', pointInTopLevelViewport($button[0]), false);
        });
        cy.screenshot(`work-item-sheet-ordinary-${locale}-${viewport.label}`);
      }
    }
  });

  it('settles adjacent save feedback without moving the work sheet footer', () => {
    const api = apiFor();
    const updated = movedBoard();
    let resolveSave: ((value: unknown) => void) | undefined;
    api.boards.editWorkItem = cy.stub().returns(
      new Promise((resolve) => {
        resolveSave = resolve;
      }),
    );
    mountBoard(api, 'en');
    cy.findByRole('button', { name: initialBoard.columns[0].cards[0].title }).click();
    cy.findByRole('button', { name: 'Edit title' }).click();
    cy.findByRole('textbox', { name: 'Title' }).clear().type('Saved title{enter}');
    cy.findByRole('status').should('contain.text', 'Saving');
    let footerTop = 0;
    cy.get('.work-item-sheet footer').then($footer => { footerTop = $footer[0].getBoundingClientRect().top; });
    cy.then(() =>
      resolveSave?.({
        key: key(1),
        value: { workItem: { ...item(updated), title: 'Saved title', version: 1 }, board: updated },
      }),
    );
    cy.findByRole('status').should('contain.text', 'Saved');
    cy.findByRole('status').should('not.exist');
    cy.get('.work-item-sheet footer').then($footer => {
      expect($footer[0].getBoundingClientRect().top).to.equal(footerTop);
    });
  });

  function openDetail(api: TaskPilotDesktopApi, locale: 'zh-CN' | 'en' = 'en') {
    mountBoard(api, locale);
    cy.findByRole('button', { name: initialBoard.columns[0].cards[0].title }).click();
    return cy.findByRole('dialog', { name: item(initialBoard).title });
  }

  function captureGeometry() {
    return cy.document().then((document) => {
      const rect = (element: HTMLElement | null | undefined) =>
        element ? (({ left, right, top, bottom, width, height }) =>
          ({ left, right, top, bottom, width, height }))(element.getBoundingClientRect()) : null;
      const sheet = document.querySelector<HTMLElement>('.work-item-sheet');
      return {
        sheet: rect(sheet),
        close: rect(sheet?.querySelector<HTMLElement>('.icon-action')),
        footer: rect(sheet?.querySelector<HTMLElement>('.work-item-detail__audit')),
      };
    });
  }

  function assertGeometryClose(actual: WorkSheetGeometry, expected: WorkSheetGeometry) {
    for (const part of ['sheet', 'close', 'footer'] as const) {
      const actualPart = actual[part];
      const expectedPart = expected[part];
      expect(actualPart, `${part} geometry`).to.not.equal(null);
      expect(expectedPart, `baseline ${part} geometry`).to.not.equal(null);
      for (const axis of ['left', 'right', 'top', 'bottom', 'width', 'height'] as const) {
        expect(actualPart![axis], `${part} ${axis}`).to.be.closeTo(expectedPart![axis], 1);
      }
    }
  }

  it('uses a comfortable desktop width and keeps description content anchored at the top left', () => {
    cy.viewport(1280, 800);
    openDetail(apiFor(), 'en').then(($dialog) => {
      const bounds = $dialog[0].getBoundingClientRect();
      expect(bounds.width, 'desktop sheet width').to.be.within(750, 770);
      expect(bounds.height, 'standard work sheet height').to.be.within(470, 490);
      const close = $dialog[0].querySelector<HTMLElement>('.icon-action')!;
      const title = $dialog[0].querySelector<HTMLElement>('.work-item-detail__title')!;
      const content = $dialog[0].querySelector<HTMLElement>('.work-item-detail__content')!;
      const description = $dialog[0].querySelector<HTMLElement>('.work-item-detail__description')!;
      const descriptionValue = description.querySelector<HTMLElement>('.work-item-detail__value')!;
      const closeBounds = close.getBoundingClientRect();
      const titleBounds = title.getBoundingClientRect();
      const contentBounds = content.getBoundingClientRect();
      const descriptionBounds = description.getBoundingClientRect();
      const valueBounds = descriptionValue.getBoundingClientRect();
      expect(closeBounds.left - titleBounds.right, 'title-to-close gap').to.be.closeTo(16, 1);
      expect(descriptionBounds.left, 'description uses the content width').to.be.closeTo(contentBounds.left, 3);
      expect(descriptionBounds.right, 'description uses the content width').to.be.closeTo(contentBounds.right, 6);
      expect(valueBounds.left - descriptionBounds.left, 'description left padding').to.be.closeTo(8, 1);
      expect(valueBounds.top - descriptionBounds.top, 'description top padding').to.be.within(6, 9);
      const descriptionStyle = getComputedStyle(description);
      expect(descriptionStyle.alignItems, 'preview content starts at the top').to.equal('flex-start');
      expect(descriptionStyle.justifyContent, 'preview content starts at the left').to.equal('flex-start');
    });
  });

  function assertOriginClose(
    actual: { left: number; top: number },
    expected: { left: number; top: number },
    label: string,
  ) {
    expect(actual, `${label} origin`).to.not.equal(null);
    expect(actual.left, `${label} left`).to.be.closeTo(expected.left, 1);
    expect(actual.top, `${label} top`).to.be.closeTo(expected.top, 1);
  }

  it('keeps the work sheet shell and title origin stable across read, edit, saving and success', () => {
    const api = apiFor();
    const savedTitle = 'Geometry title!';
    let resolveSave: ((value: unknown) => void) | undefined;
    api.boards.editWorkItem = cy.stub().returns(
      new Promise((resolve) => {
        resolveSave = resolve;
      }),
    );
    api.boards.openWorkItem = cy.stub().resolves({
      key: key(),
      value: { ...item(initialBoard), title: 'Geometry title' },
    });
    mountBoard(api, 'en');
    cy.findByRole('button', { name: initialBoard.columns[0].cards[0].title }).click();
    cy.findByRole('dialog', { name: 'Geometry title' });
    cy.screenshot('work-item-geometry-title-read');

    let readGeometry: WorkSheetGeometry | undefined;
    let titleOrigin: { left: number; top: number } | undefined;
    let titleMetrics: {
      fontFamily: string;
      fontSize: string;
      fontWeight: string;
      letterSpacing: string;
      lineHeight: string;
    } | undefined;
    captureGeometry().then((geometry) => { readGeometry = geometry; });
    cy.get('.work-item-sheet .work-item-detail__title .work-item-detail__value').then(($value) => {
      const bounds = $value[0].getBoundingClientRect();
      const style = getComputedStyle($value[0]);
      titleOrigin = { left: bounds.left, top: bounds.top };
      titleMetrics = {
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        fontWeight: style.fontWeight,
        letterSpacing: style.letterSpacing,
        lineHeight: style.lineHeight,
      };
    });
    cy.findByRole('button', { name: 'Edit title' }).click();
    cy.screenshot('work-item-geometry-title-edit');

    cy.findByRole('textbox', { name: 'Title' }).then(($input) => {
      const inputBounds = $input[0].getBoundingClientRect();
      const style = getComputedStyle($input[0]);
      assertOriginClose(
        {
          left: inputBounds.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft),
          top: inputBounds.top + parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop),
        },
        titleOrigin as never,
        'title text',
      );
      expect(style.appearance, 'native input chrome cannot change text metrics').to.equal('none');
      expect(parseFloat(style.borderLeftWidth), 'read and edit share the same structural border').to.equal(1);
      expect(parseFloat(style.paddingLeft), 'read and edit share the same title inset').to.equal(8);
      expect(parseFloat(style.paddingTop), 'read and edit share the same title vertical inset').to.equal(5);
      expect(
        {
          fontFamily: style.fontFamily,
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
          letterSpacing: style.letterSpacing,
          lineHeight: style.lineHeight,
        },
        'read and edit title metrics',
      ).to.deep.equal(titleMetrics);
    });
    captureGeometry().then((editGeometry) =>
      assertGeometryClose(editGeometry, readGeometry!),
    );

    cy.findByRole('textbox', { name: 'Title' }).type('{end}!{enter}');
    cy.findByRole('status').should('contain.text', 'Saving');
    cy.screenshot('work-item-geometry-title-saving');
    captureGeometry().then((savingGeometry) =>
      assertGeometryClose(savingGeometry, readGeometry!),
    );
    cy.findByRole('textbox', { name: 'Title' }).should('exist');

    cy.then(() =>
      resolveSave?.({
        key: key(1),
        value: {
          workItem: { ...item(initialBoard), title: savedTitle, version: 1 },
          board: movedBoard(savedTitle),
        },
      }),
    );
    cy.findByRole('status').should('contain.text', 'Saved');
    cy.screenshot('work-item-geometry-title-saved');
    captureGeometry().then((savedGeometry) =>
      assertGeometryClose(savedGeometry, readGeometry!),
    );
    cy.findByRole('button', { name: 'Edit title' })
      .find('.work-item-detail__value')
      .then(($value) => {
        const valueBounds = $value[0].getBoundingClientRect();
        assertOriginClose(
          { left: valueBounds.left, top: valueBounds.top },
          titleOrigin!,
          'saved title text',
        );
      });
  });

  it('opens an empty description as a comfortable top-left full-width multiline editor', () => {
    const api = apiFor();
    const emptyDetail = { ...item(initialBoard), description: '' };
    api.boards.openWorkItem = cy.stub().resolves({ key: key(), value: emptyDetail });
    openDetail(api, 'en');
    let readGeometry: WorkSheetGeometry | undefined;
    captureGeometry().then((geometry) => { readGeometry = geometry; });
    cy.findByText('No description').should('exist');
    let descriptionHeight = 0;
    cy.findByRole('button', { name: 'Edit description' })
      .then(($description) => {
        descriptionHeight = $description[0].getBoundingClientRect().height;
      })
      .click();
    cy.findByRole('textbox', { name: 'Description' })
      .should('exist')
      .and('have.value', '')
      .then(($textarea) => {
        const textareaHeight = $textarea[0].getBoundingClientRect().height;
        expect(textareaHeight, 'multiline editor uses the available work area').to.be.at.least(240);
        expect(textareaHeight, 'read and edit description share one slot').to.be.closeTo(descriptionHeight, 1);
        const style = getComputedStyle($textarea[0]);
        expect(style.textAlign, 'textarea text starts at the left').to.equal('left');
        expect(style.alignContent, 'textarea text starts at the top').to.equal('start');
      });
    captureGeometry().then((editGeometry) =>
      assertGeometryClose(editGeometry, readGeometry!),
    );
  });

  it('keeps a long title single-line without moving the shell or hiding detail content', () => {
    const api = apiFor();
    const longTitle = 'A long title that remains a single-line field '.repeat(6).trim();
    let resolveSave: ((value: unknown) => void) | undefined;
    api.boards.editWorkItem = cy.stub().returns(
      new Promise((resolve) => {
        resolveSave = resolve;
      }),
    );
    openDetail(api, 'en');
    let readGeometry: WorkSheetGeometry | undefined;
    captureGeometry().then((geometry) => { readGeometry = geometry; });
    cy.findByRole('button', { name: 'Edit title' }).click();
    cy.findByRole('textbox', { name: 'Title' }).then(($input) => {
      const before = $input[0].getBoundingClientRect();
      expect($input[0].tagName, 'title uses a single-line control').to.equal('INPUT');
      cy.wrap($input).clear().type(longTitle, { parseSpecialCharSequences: false });
      cy.wrap($input).should(($edited) => {
        const after = $edited[0].getBoundingClientRect();
        const style = getComputedStyle($edited[0]);
        expect(after.height, 'title editor remains single-line').to.be.closeTo(before.height, 1);
        expect(after.height, 'title editor remains compact').to.be.lessThan(50);
        expect(after.left).to.be.closeTo(before.left, 1);
        expect(after.width).to.be.closeTo(before.width, 1);
        expect(['hidden', 'clip'], 'title has no vertical scrollbar').to.include(style.overflowY);
        expect(style.whiteSpace, 'title does not wrap').to.equal('nowrap');
        expect($edited).to.have.value(longTitle);
      });
    });
    captureGeometry().then((editGeometry) =>
      assertGeometryClose(editGeometry, readGeometry!),
    );
    cy.findByRole('textbox', { name: 'Title' }).type('{enter}');
    cy.findByRole('status').should('contain.text', 'Saving');
    cy.then(() =>
      resolveSave?.({
        key: key(1),
        value: {
          workItem: { ...item(initialBoard), title: longTitle, version: 1 },
          board: movedBoard(longTitle),
        },
      }),
    );
    cy.findByRole('button', { name: 'Edit title' }).then(($button) => {
      const bounds = $button[0].getBoundingClientRect();
      const value = $button[0].querySelector<HTMLElement>('.work-item-detail__value');
      expect(bounds.height, 'read title remains single-line').to.be.lessThan(50);
      expect(getComputedStyle($button[0]).overflowY).to.equal('hidden');
      expect(getComputedStyle($button[0]).whiteSpace).to.equal('nowrap');
      expect(value, 'title value').not.to.equal(null);
      expect(getComputedStyle(value!).textOverflow, 'long title uses ellipsis').to.equal('ellipsis');
      expect(value!.textContent, 'full title stays in the DOM').to.equal(longTitle);
    });
    cy.get('.work-item-sheet footer').should('be.visible');
    cy.findByText('Description').should('be.visible');
    cy.findByText('In column').should('not.exist');
  });

  it('does not submit the title during an IME composition in real Chromium', () => {
    const api = apiFor();
    api.boards.editWorkItem = cy.stub().resolves({
      key: key(1),
      value: {
        workItem: { ...item(initialBoard), title: '候选确认', version: 1 },
        board: movedBoard('候选确认'),
      },
    });
    openDetail(api, 'zh-CN');
    cy.findByRole('button', { name: '编辑标题' }).click();
    cy.findByRole('textbox', { name: '标题' }).then(($input) => {
      const element = $input[0];
      element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      cy.wrap(element).type('候选确认');
      element.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
      );
    });
    cy.wrap(api.boards.editWorkItem).should('not.have.been.called');
    cy.findByRole('textbox', { name: '标题' }).should('exist');
    cy.findByRole('textbox', { name: '标题' }).then(($input) => {
      $input[0].dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    });
    cy.findByRole('textbox', { name: '标题' }).type('{enter}');
    cy.wrap(api.boards.editWorkItem).should('have.been.calledOnce');
  });

  it('keeps field labels present during validation failure and temporary save failure', () => {
    const api = apiFor();
    api.boards.editWorkItem = cy.stub().rejects(new Error('temporary'));
    openDetail(api, 'en');
    cy.findByRole('button', { name: 'Edit title' }).click();
    cy.findByRole('textbox', { name: 'Title' }).clear().type('{enter}');
    cy.findByRole('alert').should('contain.text', 'Title is required');
    let invalidGeometry: WorkSheetGeometry | undefined;
    captureGeometry().then((geometry) => { invalidGeometry = geometry; });

    cy.findByRole('textbox', { name: 'Title' }).type('Pending save{enter}');
    cy.findByRole('alert').should('contain.text', 'could not be saved temporarily');
    cy.findByText('Description').should('be.visible');
    cy.findByText('In column').should('not.exist');
    cy.screenshot('work-item-geometry-title-temporary-failure');
    captureGeometry().then((failedGeometry) =>
      assertGeometryClose(failedGeometry, invalidGeometry!),
    );
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
