import { BoardWorkspace } from '../../src/renderer/features/board/board-workspace';
import { ProjectHome } from '../../src/renderer/features/shell/project-home';
import { LocaleProvider } from '../../src/renderer/i18n/locale-context';
import { PRODUCT_TEXT_LIMITS } from '../../src/renderer/shared/lib/text-constraints';
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
const creator = {
  userId: '10101010-1010-4010-8010-101010101010',
  displayName: 'Morgan Creator',
  avatarUrl: null,
};
const assigneeUser = {
  userId: '20202020-2020-4020-8020-202020202020',
  displayName: 'Avery Owner',
  avatarUrl: null,
};
const projectMember = {
  projectMemberId: '30303030-3030-4030-8030-303030303030',
  user: assigneeUser,
  role: 'OWNER' as const,
  createdAt: now,
};
const assigneeTarget = {
  targetType: 'PROJECT_MEMBER' as const,
  projectMemberId: projectMember.projectMemberId,
  user: projectMember.user,
  role: projectMember.role,
};

const makeProjectMembers = (count: number) => Array.from({ length: count }, (_, index) => {
  const serial = String(index + 1).padStart(2, '0');
  const idSerial = String(index + 1).padStart(12, '0');
  return {
    projectMemberId: `30303030-3030-4030-8030-${idSerial}`,
    user: {
      userId: `40404040-4040-4040-8040-${idSerial}`,
      displayName: `Member ${serial}`,
      avatarUrl: null,
    },
    role: 'OWNER' as const,
    createdAt: now,
  };
});
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
    createdBy: creator,
    assignee: card.assignee ?? null,
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
      listProjectMembers: cy.stub().resolves({ key: key(), value: [projectMember] }),
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
        .resolves({ key: key(), value: item(board.columns.some((column) => column.cards.length > 0) ? board : initialBoard) }),
      editWorkItem: cy.stub().resolves({
        key: key(1),
        value: { workItem: item(edited), board: edited },
      }),
      moveCard,
    },
  };
}


function withAssignee(board: BoardView, assigned = true): BoardView {
  return {
    ...board,
    columns: board.columns.map((column) => ({
      ...column,
      cards: column.cards.map((card) => ({
        ...card,
        assignee: assigned ? assigneeTarget : null,
        workItemVersion: card.workItemVersion + 1,
      })),
    })),
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

function setNativeTextValue(
  element: HTMLInputElement | HTMLTextAreaElement,
  value: string,
  inputType = 'insertText',
) {
  const prototype = element instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  if (!setter) throw new Error('Native text value setter is unavailable');
  setter.call(element, value);
  element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType }));
}

async function dispatchChromiumTab() {
  const key = {
    key: 'Tab',
    code: 'Tab',
    windowsVirtualKeyCode: 9,
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

function activateButtonWithChromiumEnter(button: HTMLButtonElement) {
  const keyboardEvents: Array<{ key: string; trusted: boolean; targetIsButton: boolean }> = [];
  const clicks: Array<{ trusted: boolean; detail: number }> = [];
  button.addEventListener('keydown', (event) => {
    keyboardEvents.push({ key: event.key, trusted: event.isTrusted, targetIsButton: event.target === button });
  }, { once: true });
  button.addEventListener('click', (event) => {
    clicks.push({ trusted: event.isTrusted, detail: event.detail });
  }, { once: true });

  return cy.then(() => Cypress.automation('remote:debugger:protocol', {
    command: 'Page.bringToFront', params: {},
  })).then(async () => {
    // Cypress .focus() can update activeElement while the runner browsing
    // context retains native keyboard focus. Focus the AUT frame explicitly.
    const document = button.ownerDocument;
    document.defaultView!.focus();
    button.focus();
    expect(document.activeElement, 'Enter target in the AUT').to.equal(button);
    expect(document.hasFocus(), 'AUT owns native browser focus').to.equal(true);
    const key = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 };
    await Cypress.automation('remote:debugger:protocol', {
      command: 'Input.dispatchKeyEvent',
      params: { type: 'keyDown', text: '\r', unmodifiedText: '\r', ...key },
    });
    await Cypress.automation('remote:debugger:protocol', {
      command: 'Input.dispatchKeyEvent', params: { type: 'keyUp', ...key },
    });
  }).then(() => {
    expect(keyboardEvents, 'native Enter reaches the focused AUT button').to.deep.equal([
      { key: 'Enter', trusted: true, targetIsButton: true },
    ]);
    expect(clicks, 'the browser activates the button from the keyboard').to.deep.equal([
      { trusted: true, detail: 0 },
    ]);
  });
}

function pressFocusedChromiumKey(key: 'Tab' | 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End' | 'Escape') {
  const keyCodes = { Tab: 9, ArrowLeft: 37, ArrowRight: 39, Home: 36, End: 35, Escape: 27 };
  return cy.document().then(async (document) => {
    const target = document.activeElement;
    expect(document.hasFocus(), 'AUT retains native keyboard focus').to.equal(true);
    expect(target, 'keyboard target exists').not.to.equal(null);
    const events: Array<{ key: string; trusted: boolean; targetMatches: boolean }> = [];
    target!.addEventListener('keydown', (event) => {
      const keyboard = event as KeyboardEvent;
      events.push({ key: keyboard.key, trusted: keyboard.isTrusted, targetMatches: keyboard.target === target });
    }, { once: true });
    // CDP's Windows key code is portable; native key codes are OS-specific
    // (macOS Tab is 48, not 9). Let Chromium derive the native representation.
    const params = { key, code: key, windowsVirtualKeyCode: keyCodes[key] };
    await Cypress.automation('remote:debugger:protocol', {
      command: 'Input.dispatchKeyEvent', params: { type: 'rawKeyDown', ...params },
    });
    await Cypress.automation('remote:debugger:protocol', {
      command: 'Input.dispatchKeyEvent', params: { type: 'keyUp', ...params },
    });
    expect(events, 'trusted key reaches the current focus without refocusing').to.deep.equal([
      { key, trusted: true, targetMatches: true },
    ]);
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
  currentProject: ProjectView = project,
) {
  cy.mount(
    <LocaleProvider initialLanguages={[locale]}>
      <div style={{ height: '100vh' }}>
        <BoardWorkspace
          api={api}
          userId={userId}
          workspaceId={workspaceId}
          project={currentProject}
          onSettings={cy.stub()}
          onLeaveProject={cy.stub().as('leaveProject')}
        />
      </div>
    </LocaleProvider>,
  );
}

// Capture-only runs register this suite exclusively; the ordinary run registers
// every candidate and existing regression test without skipped tests.
const captureOnly = Boolean(Cypress.expose('captureOnly'));
const captureMode = String(Cypress.expose('BOARD_LAYOUT_CAPTURE') ?? 'candidate');
const captureRoot = '/tmp/taskpilot-board-layout';
const layoutProject: ProjectView = {
  ...project,
  name: '客户协作平台 Customer collaboration',
  description: '统一客户反馈、交付验证与发布准备。 Coordinate customer feedback, delivery checks and release readiness.',
};
const layoutColumns = [
  ['需求池 Backlog', [
    ['修复登录 Fix login', ''],
    ['为企业客户补齐工作区权限与邀请流程 Workspace invitations and permissions', '核对所有者权限、失效邀请和重复提交。\nVerify owner access, expired invitations and duplicate submission.'],
    ['审核反馈 Review feedback', '整理本周客户访谈，确认共同问题和跟进责任人。'],
    ['审核反馈 Review feedback', ''],
    ['检查导出 Export check', 'Verify CSV encoding and preserve customer-authored content.'],
    ['建立试点客户回访清单并确认升级计划 Pilot customer follow-up', '记录升级步骤、回滚窗口与验收联系人。'],
    ['同步文档 Sync docs', 'Update the support playbook after release acceptance.'],
    ['修复通知 Notifications', '确认失败重试不会重复通知。'],
  ]],
  ['进行中 In progress', [
    ['ValidateEnterpriseWorkspaceInvitationPermissionsAndExpiredLinks', 'An unbroken historical title remains accessible without widening the Card.'],
    ['完善交付验收用例 Delivery acceptance', '覆盖中文与英文内容，保留原始描述。'],
    ['验证升级 Upgrade test', 'Check upgrade and rollback with the pilot workspace.'],
  ]],
  ['评审 Review', [
    ['确认发布说明 Release notes', 'Check wording with support and customer success.'],
    ['核对审计历史和责任人变更 Audit and assignment review', '保证未分配工作项不会显示创建人作为责任人。'],
  ]],
  ['等待客户确认 Waiting for customer confirmation', []],
  ['已交付 Delivered', [
    ['试点验收 Pilot sign-off', 'The pilot team completed its acceptance checklist.'],
    ['更新帮助中心 Help center', '同步常见问题与回滚操作说明。'],
  ]],
] as const;
const layoutBoard: BoardView = {
  ...initialBoard,
  name: '秋季交付 Autumn delivery · 客户验收与发布协作',
  columns: layoutColumns.map(([name, cards], columnIndex) => ({
    ...initialBoard.columns[0],
    columnId: `55555555-5555-4555-8555-${String(columnIndex + 10).padStart(12, '0')}`,
    name,
    position: columnIndex,
    cards: cards.map(([title, description], cardIndex) => ({
      ...initialBoard.columns[0].cards[0],
      workItemId: `77777777-7777-4777-8777-${String(columnIndex * 100 + cardIndex + 10).padStart(12, '0')}`,
      title,
      description,
      position: cardIndex,
      assignee: cardIndex % 3 === 0 ? null : assigneeTarget,
    })),
  })),
};

describe('Board layout evidence capture', () => {
  for (const locale of ['zh-CN', 'en'] as const) {
    for (const [width, height] of [[960, 640], [1280, 800], [1600, 900]]) {
      it(`captures ${locale} ${width}x${height} with the same five-column fixture`, () => {
        cy.viewport(width, height);
        mountBoard(apiFor('success', layoutBoard), locale, layoutProject);
        cy.get('[data-cy-root]').invoke('css', 'height', `${height}px`);
        cy.get('.board-column').should('have.length', 5);
        cy.get('.board-card').should('have.length', 15);
        cy.document().then((document) => document.fonts.ready);
        cy.get('.board-columns').scrollTo('left', { duration: 0 });
        cy.get('.board-card-list').each(($list) => { $list[0].scrollTop = 0; });
        cy.get('.board-surface').then(($surface) => {
          const surface = $surface[0];
          const rect = (element: Element) => {
            const { left, top, right, bottom, width, height } = element.getBoundingClientRect();
            return { left, top, right, bottom, width, height };
          };
          const columns = surface.querySelector('.board-columns')!;
          const viewport = rect(columns);
          const geometry = {
            mode: captureMode, locale, viewport: { width, height },
            browser: Cypress.browser, devicePixelRatio: surface.ownerDocument.defaultView!.devicePixelRatio,
            topOccupied: viewport.top, surface: rect(surface), canvas: viewport,
            horizontalScroll: columns.scrollLeft,
            columns: [...surface.querySelectorAll('.board-column')].map((column) => {
              const list = column.querySelector('.board-card-list')!;
              const listBounds = rect(list);
              const cards = [...column.querySelectorAll<HTMLElement>('.board-card')].map((card) => {
                const bounds = rect(card);
                const title = card.querySelector('.board-card__title')!;
                const titleStyle = getComputedStyle(title);
                return {
                  id: card.dataset.workItemId, title: title.textContent, bounds,
                  titleBounds: rect(title), titleLineHeight: titleStyle.lineHeight,
                  titleClamp: titleStyle.webkitLineClamp,
                  fullyVisible: bounds.left >= viewport.left && bounds.right <= viewport.right &&
                    bounds.top >= listBounds.top && bounds.bottom <= Math.min(listBounds.bottom, height),
                };
              });
              return {
                name: column.querySelector('h2')!.textContent, bounds: rect(column),
                scrollTop: list.scrollTop, scrollHeight: list.scrollHeight, clientHeight: list.clientHeight,
                visibleCardCount: cards.filter((card) => card.fullyVisible).length, cards,
              };
            }),
          };
          cy.writeFile(`${captureRoot}/${captureMode}/${locale}-${width}x${height}.json`, geometry);
        });
        cy.screenshot(`board-layout-${captureMode}-${locale}-${width}x${height}`, { capture: 'fullPage', scale: false, overwrite: true });
      });
    }
  }
});

let reducedMediaActive = false;
afterEach(() => {
  // cy.mount unmounts React children but reuses the component-index root.
  // Capture-specific pixel heights must not leak into a later viewport.
  cy.document().then((document) => {
    document.querySelector<HTMLElement>('[data-cy-root]')?.style.removeProperty('height');
  });
  if (!reducedMediaActive) return;
  reducedMediaActive = false;
  cy.then(() => Cypress.automation('remote:debugger:protocol', {
    command: 'Emulation.setEmulatedMedia', params: { features: [] },
  }));
});

function dragGeometryBoard(tallSource: boolean): BoardView {
  return {
    ...boardWithTargetCards,
    columns: boardWithTargetCards.columns.map((column) => ({
      ...column,
      cards: column.cards.map((card) => ({
        ...card,
        title: card.workItemId === workItemId
          ? tallSource ? 'Prepare enterprise workspace invitations and validate customer acceptance before release' : 'Fix login'
          : card.workItemId === targetWorkItemId ? 'Check notes'
            : 'Confirm pilot customer acceptance and prepare the final upgrade and rollback checklist',
      })),
    })),
  };
}

function dragAuthority(board: BoardView, targetOrder: string[], destination = doingId): BoardView {
  const cards = board.columns.flatMap((column) => column.cards);
  return {
    ...board, version: 4,
    columns: board.columns.map((column) => column.columnId === destination
      ? { ...column, cards: targetOrder.map((id, position) => ({
        ...cards.find((card) => card.workItemId === id)!, position,
        placementVersion: id === workItemId ? 1 : 0,
      })) }
      : column.columnId === todoId ? { ...column, cards: [] } : column),
  };
}

function cardLayoutMetrics(card: HTMLElement) {
  const bounds = card.getBoundingClientRect();
  return {
    height: bounds.height,
    titleWidth: card.querySelector('.board-card__title')!.getBoundingClientRect().width,
    summaryTop: card.querySelector('.board-card__description')!.getBoundingClientRect().top - bounds.top,
  };
}

if (!captureOnly) describe('Project Board experience', () => {
  beforeEach(() => cy.viewport(960, 640));

  it('keeps the five-column Board usable beside the real ProjectHome sidebar at 960x640', () => {
    const api = apiFor('success', layoutBoard);
    api.projects.resolveHome = cy.stub().resolves({
      key: { sessionGeneration: 2, userId, workspaceId, projectId, status: 'ACTIVE' },
      value: {
        workspace: { workspaceId, type: 'PERSONAL', role: 'OWNER', createdAt: now, updatedAt: now },
        projects: [layoutProject], currentProject: layoutProject,
      },
    });
    cy.mount(
      <LocaleProvider initialLanguages={['en']}>
        <ProjectHome api={api}
          session={{ status: 'authenticated', currentUser: { userId, displayName: 'Avery Owner' } }}
          onLogout={cy.stub().resolves()} />
      </LocaleProvider>,
    );
    cy.findByRole('complementary', { name: 'Project navigation' }).should('be.visible');
    cy.findByRole('heading', { name: layoutProject.name }).should('be.visible');
    cy.get('.board-column').should('have.length', 5);
    cy.get('.project-workspace').should(($workspace) => {
      const bounds = $workspace[0].getBoundingClientRect();
      const sidebar = $workspace[0].ownerDocument.querySelector('.project-sidebar')!.getBoundingClientRect();
      expect(sidebar.width, 'real sidebar consumes width').to.be.at.least(190);
      expect(bounds.left).to.be.closeTo(sidebar.right, 1);
      expect(bounds.width, 'Board receives the content width, not the whole viewport').to.be.at.most(770);
      expect(bounds.right).to.be.at.most(960);
      expect(bounds.bottom).to.be.at.most(640);
      expect($workspace[0].scrollWidth, 'workspace does not widen to fit Columns').to.be.at.most($workspace[0].clientWidth);
      for (const button of $workspace[0].querySelectorAll('.board-toolbar__actions button, .board-project-settings')) {
        const action = button.getBoundingClientRect();
        expect(action.left, 'toolbar action stays inside content').to.be.at.least(bounds.left);
        expect(action.right).to.be.at.most(bounds.right);
      }
      const tabs = $workspace[0].querySelector('.board-switcher')!.getBoundingClientRect();
      const actions = $workspace[0].querySelector('.board-toolbar__actions')!.getBoundingClientRect();
      expect(tabs.right, 'long Board name does not overlap actions').to.be.at.most(actions.left);
    });
    cy.get('.board-columns').should(($columns) => {
      expect($columns[0].scrollWidth).to.be.greaterThan($columns[0].clientWidth);
      expect(getComputedStyle($columns[0]).overflowX).to.equal('auto');
    });
    cy.get('.board-column').first().find('.board-card-list').should(($list) => {
      expect($list[0].scrollHeight).to.be.greaterThan($list[0].clientHeight);
    }).scrollTo('bottom', { duration: 0 }).then(($list) => {
      expect($list[0].scrollTop).to.be.greaterThan(0);
    });
    cy.get('.board-column').first().find('.board-card').last().find('button').focus()
      .should('be.visible').and('be.focused');
    cy.get('.board-columns').scrollTo('right', { duration: 0 });
    cy.get('.board-column').last().find('.board-add-card').focus()
      .should('be.visible').and('be.focused').and(($button) => {
        const bounds = $button[0].getBoundingClientRect();
        const workspaceBounds = $button[0].closest('.project-workspace')!.getBoundingClientRect();
        expect(bounds.left).to.be.at.least(workspaceBounds.left);
        expect(bounds.right).to.be.at.most(workspaceBounds.right);
        expect(bounds.bottom).to.be.at.most(640);
      });
    cy.get('.board-column').last().find<HTMLButtonElement>('.board-add-card')
      .then(($button) => activateButtonWithChromiumEnter($button[0]));
    cy.findByRole('dialog', { name: 'Add work item' }).should('be.visible');
    cy.findByRole('button', { name: 'Close' }).click();
    cy.get('.board-column').last().find('.board-add-card').should('be.focused');
    cy.document().then((document) => {
      expect(document.documentElement.scrollWidth).to.be.at.most(960);
      expect(document.documentElement.scrollHeight).to.be.at.most(640);
    });
  });

  for (const locale of ['zh-CN', 'en'] as const) {
    it(`keeps overflowing Board tabs and a scrolled Card reachable with real keyboard input at ${locale} 960x640`, () => {
      const boards: BoardView[] = Array.from({ length: 5 }, (_, index) => ({
        ...layoutBoard,
        boardId: index === 0 ? boardId : `44444444-4444-4444-8444-${String(index).padStart(12, '0')}`,
        name: [...`Delivery ${index + 1} · 客户验收与发布协作 Enterprise customer acceptance and release readiness`]
          .slice(0, PRODUCT_TEXT_LIMITS.boardName).join(''),
      }));
      const api = apiFor('success', boards[0]);
      api.projects.resolveHome = cy.stub().resolves({
        key: { sessionGeneration: 2, userId, workspaceId, projectId, status: 'ACTIVE' },
        value: {
          workspace: { workspaceId, type: 'PERSONAL', role: 'OWNER', createdAt: now, updatedAt: now },
          projects: [layoutProject], currentProject: layoutProject,
        },
      });
      api.boards.resolveHome = cy.stub().resolves({
        key: key(), value: { boards: boards.map(summary), currentBoard: boards[0] },
      });
      let generation = 0;
      api.boards.open = cy.stub().callsFake((request: { boardId: string }) => {
        const board = boards.find((candidate) => candidate.boardId === request.boardId)!;
        return Promise.resolve({ key: { ...key(++generation), boardId: board.boardId }, value: board });
      });
      const card = boards[0].columns[0].cards.at(-1)!;
      const cardSelector = `[data-work-item-id="${card.workItemId}"] .board-card__body`;
      api.boards.openWorkItem = cy.stub().callsFake(() => Promise.resolve({
        key: key(generation), value: {
          ...item(boards[0]), workItemId: card.workItemId, title: card.title,
          description: card.description, assignee: card.assignee ?? null,
        },
      }));
      cy.mount(
        <LocaleProvider initialLanguages={[locale]}>
          <ProjectHome api={api}
            session={{ status: 'authenticated', currentUser: { userId, displayName: 'Avery Owner' } }}
            onLogout={cy.stub().resolves()} />
        </LocaleProvider>,
      );
      cy.findAllByRole('tab').should('have.length', 5);
      cy.document().then((document) => document.fonts.ready);
      cy.get('.project-sidebar').should('be.visible');
      cy.get('.board-switcher').should(($tabs) => {
        expect($tabs[0].scrollWidth, 'long Board tabs overflow their local track').to.be.greaterThan($tabs[0].clientWidth);
        expect($tabs[0].scrollLeft, 'initial local scroll').to.equal(0);
      });

      const assertSelectedTab = (index: number) => {
        cy.findByRole('tab', { name: boards[index].name }).should('be.focused')
          .and('have.attr', 'aria-selected', 'true').and('have.attr', 'tabindex', '0')
          .and(($tab) => {
            const tab = $tab[0];
            const bounds = tab.getBoundingClientRect();
            const track = tab.closest('.board-switcher')!.getBoundingClientRect();
            const actions = tab.closest('.board-toolbar')!.querySelector('.board-toolbar__actions')!.getBoundingClientRect();
            expect(bounds.left, 'focused tab is not clipped on the left').to.be.at.least(track.left - 1);
            expect(bounds.right, 'focused tab is not clipped on the right').to.be.at.most(track.right + 1);
            expect(track.right, 'tab scrolling stays clear of Board actions').to.be.at.most(actions.left);
            expect(tab.matches(':focus-visible'), 'native keyboard focus remains visible').to.equal(true);
            expect(getComputedStyle(tab).outlineStyle).not.to.equal('none');
            expect(parseFloat(getComputedStyle(tab).outlineWidth)).to.be.at.least(2);
          });
        cy.findAllByRole('tab').should(($tabs) => {
          expect([...$tabs].filter((tab) => tab.getAttribute('aria-selected') === 'true')).to.have.length(1);
          for (const tab of $tabs) {
            if (tab.textContent !== boards[index].name) expect(tab.getAttribute('tabindex')).to.equal('-1');
          }
        });
      };
      cy.then(() => Cypress.automation('remote:debugger:protocol', { command: 'Page.bringToFront', params: {} }));
      cy.get<HTMLButtonElement>('.board-project-settings').then(($button) => {
        $button[0].ownerDocument.defaultView!.focus();
        $button[0].focus();
      });
      pressFocusedChromiumKey('Tab');
      assertSelectedTab(0);
      pressFocusedChromiumKey('ArrowRight');
      assertSelectedTab(1);
      pressFocusedChromiumKey('End');
      assertSelectedTab(4);
      cy.get('.board-switcher').should(($tabs) => expect($tabs[0].scrollLeft).to.be.greaterThan(0));
      pressFocusedChromiumKey('ArrowLeft');
      assertSelectedTab(3);
      pressFocusedChromiumKey('Home');
      assertSelectedTab(0);
      cy.get('.board-switcher').should(($tabs) => expect($tabs[0].scrollLeft).to.be.closeTo(0, 1));
      cy.wrap(api.boards.open).should('have.callCount', 4).and((stub) => {
        const calls = (stub as unknown as { getCalls(): Array<{ args: Array<{ boardId: string }> }> }).getCalls();
        expect(calls.map((call) => call.args[0].boardId)).to.deep.equal([1, 4, 3, 0].map((index) => boards[index].boardId));
      });

      const tabToCard = (remaining: number): Cypress.Chainable<unknown> => cy.document().then((document) => {
        if (document.activeElement?.matches(cardSelector)) return;
        expect(remaining, 'Card is reachable in a bounded native Tab traversal').to.be.greaterThan(0);
        return pressFocusedChromiumKey('Tab').then(() => tabToCard(remaining - 1));
      });
      tabToCard(24);
      const assertCardFocus = () => cy.get<HTMLButtonElement>(cardSelector).should('be.focused').and('be.visible')
        .and(($button) => {
          const bounds = $button[0].getBoundingClientRect();
          const list = $button[0].closest('.board-card-list')!;
          const visible = list.getBoundingClientRect();
          expect(list.scrollTop, 'native Tab scrolls the long Column to the Card').to.be.greaterThan(0);
          expect(bounds.left).to.be.at.least(visible.left - 1);
          expect(bounds.right).to.be.at.most(visible.right + 1);
          expect(bounds.top).to.be.at.least(visible.top - 1);
          expect(bounds.bottom).to.be.at.most(visible.bottom + 1);
          expect($button[0].matches(':focus-visible')).to.equal(true);
        });
      assertCardFocus().then(($button) => activateButtonWithChromiumEnter($button[0]));
      cy.findByRole('dialog', { name: card.title }).should('be.visible');
      cy.findByRole('heading', { name: card.title }).should('be.focused');
      cy.wrap(api.boards.openWorkItem).should('have.been.calledOnceWith', {
        workspaceId, projectId, boardId: boards[0].boardId, workItemId: card.workItemId,
      });
      pressFocusedChromiumKey('Escape');
      cy.findByRole('dialog', { name: card.title }).should('not.exist');
      assertCardFocus();
      cy.wrap(api.boards.editWorkItem).should('not.have.been.called');
      cy.wrap(api.boards.moveCard).should('not.have.been.called');
      cy.document().should((document) => {
        expect(document.documentElement.scrollWidth).to.be.at.most(960);
        expect(document.documentElement.scrollHeight).to.be.at.most(640);
      });
    });
  }

  it('orders Work Item creation as title, assignee, then description without redundant default help', () => {
    const api = apiFor();
    mountBoard(api, 'zh-CN');

    cy.findAllByRole('button', { name: '添加工作项' }).first().click();
    cy.findByRole('dialog', { name: '添加工作项' }).within(() => {
      cy.findByLabelText('标题').then(($title) => {
        cy.findByRole('combobox', { name: '负责人（可选）' }).then(($assignee) => {
          cy.findByLabelText('描述（可选）').then(($description) => {
            const titleTop = $title[0].getBoundingClientRect().top;
            const assigneeTop = $assignee[0].getBoundingClientRect().top;
            const descriptionTop = $description[0].getBoundingClientRect().top;
            expect(titleTop, 'title is the first field').to.be.lessThan(assigneeTop);
            expect(assigneeTop, 'assignee is the second field').to.be.lessThan(descriptionTop);
          });
        });
      });
      cy.findByRole('combobox', { name: '负责人（可选）' }).should('contain.text', '未分配');
      cy.contains('默认未分配。').should('not.exist');
    });
  });

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
    cy.findByRole('menuitem', { name: 'Delete board' })
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

  it('dismisses Board actions on the same real pointer action and restores trigger focus on Escape', () => {
    const api = apiFor();
    mountBoard(api, 'en');

    cy.findByRole('button', { name: 'Board actions' }).as('actions').click();
    cy.findByRole('menuitem', { name: 'Delete board' }).should('be.visible');
    cy.findByRole('button', { name: 'Edit board' }).click();
    cy.findByRole('menuitem', { name: 'Delete board' }).should('not.exist');
    cy.findByRole('dialog', { name: 'Edit board' }).should('be.visible');
    cy.findByRole('button', { name: 'Close' }).click();

    cy.get('@actions').click();
    cy.findByRole('menuitem', { name: 'Delete board' }).should('be.focused');
    cy.get('body').trigger('keydown', { key: 'Escape' });
    cy.findByRole('menuitem', { name: 'Delete board' }).should('not.exist');
    cy.get('@actions').should('be.focused');
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
    cy.findByRole('menuitem', { name: '删除看板' }).click();
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
    cy.findByRole('menuitem', { name: '删除看板' }).click();
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
    cy.findByRole('menuitem', { name: '删除看板' }).click();
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
    cy.findByRole('menuitem', { name: '删除看板' }).click();
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

  for (const locale of ['zh-CN', 'en'] as const) {
    for (const [width, height] of [[960, 640], [1280, 800], [1600, 900]]) {
      it(`keeps five readable Columns and existing actions reachable at ${locale} ${width}x${height}`, () => {
        cy.viewport(width, height);
        const api = apiFor('success', layoutBoard);
        mountBoard(api, locale, layoutProject);
        cy.get('.board-column').should('have.length', 5);
        cy.get('.board-columns').should(($canvas) => {
          if (width < 1528) expect($canvas[0].scrollWidth).to.be.greaterThan($canvas[0].clientWidth);
          expect(getComputedStyle($canvas[0]).overflowX).to.equal('auto');
        });
        cy.get('.board-column').should(($columns) => {
          const backgrounds = [...$columns].map((column) => getComputedStyle(column).backgroundColor);
          expect(new Set(backgrounds).size, 'neutral grouping is independent of column names').to.equal(1);
          for (const column of $columns) {
            expect(column.getBoundingClientRect().width, 'readable Column width').to.be.closeTo(288, 1);
            expect(column.getBoundingClientRect().bottom).to.be.at.most(height);
          }
        });
        cy.get('.board-column').first().find('.board-card-list').should(($list) => {
          expect($list[0].scrollHeight).to.be.greaterThan($list[0].clientHeight);
          expect(getComputedStyle($list[0]).overflowY).to.equal('auto');
        }).scrollTo('bottom', { duration: 0 }).then(($list) => {
          expect($list[0].scrollTop).to.be.greaterThan(0);
        });
        cy.get('.board-columns').scrollTo('right', { duration: 0, ensureScrollable: false });
        cy.get('.board-column').last().find('.board-add-card').focus().should('be.visible').and('be.focused')
          .then(($button) => {
            const bounds = $button[0].getBoundingClientRect();
            expect(bounds.left).to.be.at.least(0);
            expect(bounds.right).to.be.at.most(width);
            expect(bounds.bottom).to.be.at.most(height);
          });
        cy.get('.board-column').last().find<HTMLButtonElement>('.board-add-card')
          .then(($button) => activateButtonWithChromiumEnter($button[0]));
        cy.findByRole('dialog', { name: locale === 'en' ? 'Add work item' : '添加工作项' }).should('be.visible');
        cy.findByRole('button', { name: locale === 'en' ? 'Close' : '关闭' }).click();
        cy.get('.board-column').last().find('.board-add-card').should('be.focused');
        cy.get('.board-columns').scrollTo('left', { duration: 0, ensureScrollable: false });
        cy.get('.board-toolbar').then(($toolbar) => {
          const firstColumn = $toolbar[0].ownerDocument.querySelector('.board-column')!;
          expect(firstColumn.getBoundingClientRect().left).to.be.closeTo($toolbar[0].getBoundingClientRect().left + 20, 1);
        });
        cy.get('.board-column').first().find('.board-column__actions .icon-action').eq(2)
          .focus().should('be.visible').and('be.focused').and(($button) => {
            const bounds = $button[0].getBoundingClientRect();
            expect(bounds.width).to.be.at.least(32);
            expect(bounds.height).to.be.at.least(32);
          });
        cy.get('.board-toolbar__actions button, .board-project-settings').should(($buttons) => {
          for (const button of $buttons) {
            const bounds = button.getBoundingClientRect();
            expect(bounds.width).to.be.at.least(32);
            expect(bounds.height).to.be.at.least(32);
            expect(bounds.right).to.be.at.most(width);
          }
        });
        cy.document().then((document) => {
          expect(document.documentElement.scrollWidth).to.be.at.most(width);
          expect(document.documentElement.scrollHeight, 'only Column content scrolls vertically').to.be.at.most(height);
        });
      });
    }
  }

  it('bounds Card height by title lines and keeps summary and assignee slots stable', () => {
    const longTitle = 'Prepare enterprise workspace invitations and validate customer acceptance before release';
    const historicalDescription = '核对权限与失效邀请。\nPreserve the original customer description.\n'.repeat(150);
    const variants = [
      { title: 'Review feedback', description: '', assignee: null },
      { title: 'Review feedback', description: historicalDescription, assignee: assigneeTarget },
      { title: longTitle, description: '', assignee: null },
      { title: longTitle, description: historicalDescription, assignee: assigneeTarget },
      { title: 'ValidateEnterpriseWorkspaceInvitationPermissionsAndExpiredLinks'.repeat(4), description: 'Check long unbroken English text.', assignee: null },
      { title: '核对企业客户工作区邀请权限并验证失效链接与回滚操作'.repeat(5), description: '核对中文历史内容。', assignee: null },
    ];
    const stableBoard: BoardView = {
      ...initialBoard,
      columns: initialBoard.columns.map((column, columnIndex) => columnIndex === 0
        ? { ...column, cards: variants.map((variant, position) => ({
          ...column.cards[0], ...variant, position,
          workItemId: `cccccccc-cccc-4ccc-8ccc-${String(position + 1).padStart(12, '0')}`,
        })) }
        : column),
    };
    const api = apiFor('success', stableBoard);
    const original = stableBoard.columns[0].cards[3];
    api.boards.openWorkItem = cy.stub().resolves({ key: key(), value: {
      ...item(stableBoard), workItemId: original.workItemId,
      title: original.title, description: original.description, assignee: original.assignee,
    } });
    mountBoard(api, 'en');
    cy.get('[data-cy-root]').invoke('css', 'height', '640px');
    cy.document().then((document) => document.fonts.ready);
    cy.get('.board-column').first().find('.board-card').should(($cards) => {
      expect($cards).to.have.length(6);
      const metrics = [...$cards].map((card) => {
        const bounds = card.getBoundingClientRect();
        const title = card.querySelector<HTMLElement>('.board-card__title')!;
        const description = card.querySelector<HTMLElement>('.board-card__description')!;
        const meta = card.querySelector<HTMLElement>('.board-card__meta')!;
        const titleBounds = title.getBoundingClientRect();
        const descriptionBounds = description.getBoundingClientRect();
        const titleStyle = getComputedStyle(title);
        const descriptionStyle = getComputedStyle(description);
        expect(titleStyle.fontSize, 'readable title').to.equal('14px');
        expect(titleStyle.lineHeight).to.equal('20px');
        expect(titleStyle.webkitLineClamp).to.equal('2');
        expect(titleBounds.height).to.be.at.most(40.5);
        expect(titleBounds.width, 'title stays inside the Card').to.be.at.most(bounds.width);
        expect(descriptionStyle.fontSize).to.equal('12px');
        expect(descriptionStyle.lineHeight).to.equal('18px');
        expect(descriptionStyle.overflow).to.equal('hidden');
        expect(descriptionBounds.height, 'one summary line including empty summary').to.be.closeTo(18, 1);
        expect(meta.getBoundingClientRect().height, 'reserved responsibility footer').to.be.closeTo(24, 1);
        expect(meta.getBoundingClientRect().top).to.be.greaterThan(descriptionBounds.bottom);
        const avatar = card.querySelector<HTMLElement>('.board-card__assignee');
        if (avatar) {
          const avatarBounds = avatar.getBoundingClientRect();
          expect(meta.contains(avatar)).to.equal(true);
          expect(avatarBounds.left).to.be.closeTo(titleBounds.left, 1);
          expect(avatarBounds.width).to.be.closeTo(24, 1);
          expect(avatarBounds.height).to.be.closeTo(24, 1);
          expect(avatar.title).to.equal(assigneeUser.displayName);
          expect(card.querySelector('button')!.getAttribute('aria-label')).to.contain(assigneeUser.displayName);
        }
        return { height: bounds.height, titleHeight: titleBounds.height,
          titleWidth: titleBounds.width, summaryTop: descriptionBounds.top - bounds.top };
      });
      expect(metrics[0].titleHeight, 'short title uses one line').to.be.closeTo(20, 1);
      expect(metrics[2].titleHeight, 'long title uses two lines').to.be.closeTo(40, 1);
      expect(metrics[2].height - metrics[0].height, 'only the extra title line adds height').to.be.closeTo(20, 1);
      for (const [empty, assigned] of [[0, 1], [2, 3]]) {
        for (const axis of ['height', 'titleWidth', 'summaryTop'] as const) {
          expect(metrics[assigned][axis], `same title ${axis}`).to.be.closeTo(metrics[empty][axis], 1);
        }
        expect($cards[empty].querySelector('.board-card__assignee')).to.equal(null);
      }
      expect(metrics[4].height, 'unbroken historical title is bounded').to.be.closeTo(metrics[2].height, 1);
      expect(metrics[5].height, 'Chinese historical title is bounded').to.be.closeTo(metrics[2].height, 1);
    });
    cy.get(`[data-work-item-id="${original.workItemId}"] button`).scrollIntoView().click();
    cy.findByRole('heading', { name: original.title }).should('be.focused');
    cy.findByRole('button', { name: 'Edit description' }).should(($description) => {
      expect($description[0].textContent).to.contain(historicalDescription);
    });
    cy.wrap(api.boards.openWorkItem).should('have.been.calledOnceWith', {
      workspaceId, projectId, boardId, workItemId: original.workItemId,
    });
    cy.wrap(api.boards.editWorkItem).should('not.have.been.called');
  });

  it('keeps Card geometry stable through authoritative assignee set, replace and clear', () => {
    const replacementMember = { ...projectMember,
      projectMemberId: '40404040-4040-4040-8040-404040404040',
      user: { ...assigneeUser, userId: '50505050-5050-4050-8050-505050505050', displayName: '林交付 Delivery owner with a long name' },
    };
    const assigned = withAssignee(initialBoard);
    const replaced: BoardView = { ...assigned, columns: assigned.columns.map((column) => ({
      ...column, cards: column.cards.map((card) => ({ ...card, workItemVersion: 2,
        assignee: { ...assigneeTarget, projectMemberId: replacementMember.projectMemberId, user: replacementMember.user },
      })),
    })) };
    const cleared: BoardView = { ...replaced, columns: replaced.columns.map((column) => ({
      ...column, cards: column.cards.map((card) => ({ ...card, workItemVersion: 3, assignee: null })),
    })) };
    const api = apiFor();
    api.boards.listProjectMembers = cy.stub().resolves({ key: key(), value: [projectMember, replacementMember] });
    api.boards.editWorkItem = cy.stub()
      .onCall(0).resolves({ key: key(1), value: { workItem: item(assigned), board: assigned } })
      .onCall(1).resolves({ key: key(2), value: { workItem: item(replaced), board: replaced } })
      .onCall(2).resolves({ key: key(3), value: { workItem: item(cleared), board: cleared } });
    mountBoard(api, 'en');
    let baseline: ReturnType<typeof cardLayoutMetrics>;
    cy.get(`[data-work-item-id="${workItemId}"]`).then(($card) => { baseline = cardLayoutMetrics($card[0]); });
    cy.findByRole('button', { name: initialBoard.columns[0].cards[0].title }).click();
    for (const [current, next] of [
      ['Unassigned', assigneeUser.displayName],
      [assigneeUser.displayName, replacementMember.user.displayName],
      [replacementMember.user.displayName, 'Unassigned'],
    ]) {
      cy.findByRole('button', { name: `Change assignee. Current: ${current}` }).click();
      cy.findByRole('option', { name: new RegExp(next) }).click();
      cy.findByRole('button', { name: `Change assignee. Current: ${next}` }).should('be.visible');
      cy.get(`[data-work-item-id="${workItemId}"]`).should(($card) => {
        const actual = cardLayoutMetrics($card[0]);
        for (const axis of ['height', 'titleWidth', 'summaryTop'] as const) {
          expect(actual[axis], `authoritative ${next} ${axis}`).to.be.closeTo(baseline[axis], 1);
        }
        const avatar = $card[0].querySelector<HTMLElement>('.board-card__assignee');
        if (next === 'Unassigned') expect(avatar).to.equal(null);
        else expect(avatar?.title).to.equal(next);
      });
    }
    cy.wrap(api.boards.editWorkItem).should('have.been.calledThrice');
    cy.wrap(api.boards.editWorkItem).its('lastCall.args.0').should((input) => {
      expect(input).to.deep.include({ expectedVersion: 2, assigneePatch: { action: 'CLEAR' } });
    });
  });

  it('shows Card assignee and supports keyboard set and clear in the detail picker', () => {
    const api = apiFor('success', initialBoard);
    const assignedBoard = withAssignee(initialBoard);
    const unassignedAgain = withAssignee(initialBoard, false);
    api.boards.editWorkItem = cy
      .stub()
      .onFirstCall()
      .resolves({
        key: key(1),
        value: { workItem: item(assignedBoard), board: assignedBoard },
      })
      .onSecondCall()
      .resolves({
        key: key(2),
        value: { workItem: item(unassignedAgain), board: unassignedAgain },
      });
    mountBoard(api, 'en');

    cy.findByRole('button', {
      name: initialBoard.columns[0].cards[0].title,
    }).click();
    cy.findByRole('button', { name: 'Change assignee. Current: Unassigned' })
      .should('not.have.descendants', '.assignee-avatar')
      .focus()
      .type('{enter}');
    cy.findByRole('listbox', { name: 'Assignee options' }).should('be.visible');
    cy.findByRole('option', { name: /Unassigned/ })
      .should('not.have.descendants', '.assignee-avatar');
    cy.findByRole('searchbox', { name: 'Search project members' })
      .should('be.focused')
      .type('Avery');
    cy.findByRole('option', { name: /Avery Owner/ }).should('contain.text', 'Owner');
    cy.findByRole('searchbox', { name: 'Search project members' }).type('{enter}');
    cy.wrap(api.boards.editWorkItem)
      .should('have.been.calledOnce')
      .its('firstCall.args.0')
      .should((input) => {
        expect(input).to.include({
          workspaceId,
          projectId,
          boardId,
          workItemId,
          currentColumnId: todoId,
          targetColumnId: todoId,
          expectedVersion: 0,
        });
        expect(input).to.deep.include({
          assigneePatch: {
            action: 'SET',
            target: {
              targetType: 'PROJECT_MEMBER',
              projectMemberId: projectMember.projectMemberId,
            },
          },
        });
      });
    cy.findByRole('button', { name: 'Change assignee. Current: Avery Owner' })
      .should('be.visible')
      .click();
    cy.findByRole('option', { name: /Unassigned/ }).click();
    cy.wrap(api.boards.editWorkItem).should('have.been.calledTwice');
    cy.wrap(api.boards.editWorkItem).its('lastCall.args.0').should((input) => {
      expect(input).to.include({ expectedVersion: 1 });
      expect(input).to.deep.include({ assigneePatch: { action: 'CLEAR' } });
    });
    cy.findByRole('button', { name: initialBoard.columns[0].cards[0].title }).should('be.visible');
  });

  it('caps the assignee member menu and uses search to narrow a large project', () => {
    const manyMembers = makeProjectMembers(50);
    const api = apiFor('success', initialBoard);
    api.boards.listProjectMembers = cy.stub().resolves({
      key: key(),
      value: manyMembers,
    });
    mountBoard(api, 'en');

    cy.findByRole('button', { name: initialBoard.columns[0].cards[0].title }).click();
    cy.findByRole('button', { name: 'Change assignee. Current: Unassigned' }).click();

    cy.findAllByRole('option', { name: /Member \d\d/ }).should('have.length', 6);
    cy.findByRole('option', { name: /Member 06/ }).should('be.visible');
    cy.findByRole('option', { name: /Member 07/ }).should('not.exist');
    cy.findByText('Showing first 6 of 50 members. Search to narrow.').should('be.visible');
    cy.get('.assignee-picker__menu').should(($menu) => {
      const style = getComputedStyle($menu[0]);
      expect(style.overflowY, 'menu remains scrollable as safety').to.equal('auto');
    });

    cy.findByRole('searchbox', { name: 'Search project members' }).type('Member 0');
    cy.findAllByRole('option', { name: /Member \d\d/ }).should('have.length', 8);
    cy.findByRole('option', { name: /Member 08/ }).should('be.visible');
    cy.findByRole('option', { name: /Member 09/ }).should('not.exist');
    cy.findByText('1 more matching members. Keep typing to narrow.').should('be.visible');

    cy.findByRole('searchbox', { name: 'Search project members' }).clear().type('Member 49');
    cy.findAllByRole('option', { name: /Member \d\d/ }).should('have.length', 1);
    cy.findByRole('option', { name: /Member 49/ }).should('be.visible');
    cy.findByText(/more matching members|Showing first/).should('not.exist');
  });

  it('saves an edited description before opening the assignee picker', () => {
    const api = apiFor('success', initialBoard);
    const updatedDescription = 'Updated before assigning';
    const savedBoard: BoardView = {
      ...initialBoard,
      columns: initialBoard.columns.map((column) => ({
        ...column,
        cards: column.cards.map((card) => card.workItemId === workItemId
          ? { ...card, description: updatedDescription, workItemVersion: 1 }
          : card),
      })),
    };
    let resolveSave: ((value: unknown) => void) | undefined;
    api.boards.editWorkItem = cy.stub().returns(
      new Promise((resolve) => { resolveSave = resolve; }),
    );
    mountBoard(api, 'en');
    cy.findByRole('button', { name: initialBoard.columns[0].cards[0].title }).click();
    cy.findByRole('button', { name: 'Edit description' }).click();
    cy.findByRole('textbox', { name: 'Description' })
      .clear()
      .type(updatedDescription);
    cy.findByRole('button', { name: 'Change assignee. Current: Unassigned' })
      .should('not.be.disabled')
      .and('have.css', 'cursor', 'pointer')
      .click();

    cy.wrap(api.boards.editWorkItem)
      .should('have.been.calledOnce')
      .its('firstCall.args.0')
      .should((input) => {
        expect(input).to.include({ expectedVersion: 0 });
        expect(input).to.have.property('descriptionPatch').deep.equal({
          action: 'SET',
          value: updatedDescription,
        });
        expect(input).not.to.have.property('title');
      });
    cy.findByRole('listbox', { name: 'Assignee options' }).should('not.exist');

    cy.then(() => resolveSave?.({
      key: key(1),
      value: { workItem: item(savedBoard), board: savedBoard },
    }));
    cy.findByRole('listbox', { name: 'Assignee options' }).should('be.visible');
    cy.findByRole('searchbox', { name: 'Search project members' }).should('be.focused');
  });

  it('keeps assignee picker geometry stable and exposes a clear error state in Chromium', () => {
    const assignedBoard = withAssignee(initialBoard);
    const unassignedBoard = withAssignee(initialBoard, false);
    const api = apiFor('success', assignedBoard);
    api.boards.editWorkItem = cy
      .stub()
      .onFirstCall()
      .resolves({
        key: key(1),
        value: { workItem: item(unassignedBoard), board: unassignedBoard },
      })
      .onSecondCall()
      .resolves({
        key: key(2),
        value: { workItem: item(assignedBoard), board: assignedBoard },
      })
      .onThirdCall()
      .rejects(new Error('temporary'));
    mountBoard(api, 'en');
    cy.findByRole('button', {
      name: `${initialBoard.columns[0].cards[0].title}, assignee: Avery Owner`,
    }).click();
    cy.findByText('Creator').should('be.visible');
    cy.findByText('Morgan Creator').should('be.visible');
    cy.get('.work-item-detail__meta-field--assignee .work-item-detail__label')
      .then(($label) => $label[0].getBoundingClientRect())
      .as('assigneeLabelBounds');
    cy.get('.work-item-detail__creator-audit')
      .should('be.visible')
      .and('contain.text', 'Creator')
      .and('contain.text', 'Morgan Creator');
    cy.get('.work-item-detail__meta-strip').should('not.contain.text', 'Creator');
    cy.findByRole('button', { name: 'Change assignee. Current: Avery Owner' })
      .then(($button) => $button[0].getBoundingClientRect())
      .as('assignedBounds');
    cy.get('.assignee-picker__trigger-text')
      .then(($text) => $text[0].getBoundingClientRect())
      .as('assignedTextBounds');
    cy.get('.assignee-picker__trigger .assignee-avatar')
      .then(($avatar) => $avatar[0].getBoundingClientRect())
      .as('assignedAvatarBounds');
    cy.get('.work-item-detail__creator-audit').should(($creator) => {
      const footer = $creator[0].closest('.work-item-detail__audit');
      const creatorBounds = $creator[0].getBoundingClientRect();
      const metadataBounds = footer
        ?.querySelector<HTMLElement>('.work-item-detail__metadata')
        ?.getBoundingClientRect();
      expect(footer, 'creator belongs to the audit footer').to.not.equal(null);
      expect(metadataBounds, 'time metadata is present').to.not.equal(undefined);
      expect(creatorBounds.top + creatorBounds.height / 2, 'creator and times share one footer row')
        .to.be.closeTo(metadataBounds!.top + metadataBounds!.height / 2, 2);
    });
    cy.get('.assignee-picker__chevron').should(($icon) => {
      const icon = $icon[0].getBoundingClientRect();
      const trigger = $icon[0].closest('button')?.getBoundingClientRect();
      expect(trigger, 'chevron trigger').to.not.equal(undefined);
      expect(icon.top + icon.height / 2, 'chevron vertical center')
        .to.be.closeTo(trigger!.top + trigger!.height / 2, 0.5);
      expect(trigger!.right - icon.right, 'chevron right inset').to.be.closeTo(7, 0.5);
    });
    cy.get<DOMRect>('@assignedBounds').then((assigned) => {
      cy.get<DOMRect>('@assigneeLabelBounds').then((label) => {
        expect(label.top + label.height / 2, 'assignee label vertical center')
          .to.be.closeTo(assigned.top + assigned.height / 2, 1);
      });
    });
    cy.findByRole('button', { name: 'Change assignee. Current: Avery Owner' }).click();
    cy.findByRole('option', { name: /Unassigned/ }).trigger('mouseover').click();
    cy.findByRole('button', { name: 'Change assignee. Current: Unassigned' })
      .should('not.have.descendants', '.assignee-avatar')
      .then(($button) => $button[0].getBoundingClientRect())
      .as('unassignedBounds');
    cy.get<DOMRect>('@assignedBounds').then((assigned) => {
      cy.get<DOMRect>('@unassignedBounds').then((unassigned) => {
        expect(unassigned.left, 'assigned-to-unassigned left').to.be.closeTo(assigned.left, 1);
        expect(unassigned.top, 'assigned-to-unassigned top').to.be.closeTo(assigned.top, 1);
        expect(unassigned.width, 'assigned-to-unassigned width').to.be.closeTo(assigned.width, 1);
        expect(unassigned.height, 'assigned-to-unassigned height').to.be.closeTo(assigned.height, 1);
      });
    });
    cy.get<DOMRect>('@assignedAvatarBounds').then((assignedAvatar) => {
      cy.get('.assignee-picker__trigger-text').should(($text) => {
        const unassignedText = $text[0].getBoundingClientRect();
        expect(unassignedText.left, 'unassigned value left').to.be.closeTo(assignedAvatar.right + 10, 1);
      });
    });
    cy.findByRole('button', { name: 'Change assignee. Current: Unassigned' }).click();
    cy.findByRole('option', { name: /Avery Owner/ }).click();
    cy.findByRole('button', { name: 'Change assignee. Current: Avery Owner' })
      .then(($button) => $button[0].getBoundingClientRect())
      .as('reassignedBounds');
    cy.get<DOMRect>('@assignedBounds').then((assigned) => {
      cy.get<DOMRect>('@reassignedBounds').then((reassigned) => {
        expect(reassigned.left, 'unassigned-to-assigned left').to.be.closeTo(assigned.left, 1);
        expect(reassigned.top, 'unassigned-to-assigned top').to.be.closeTo(assigned.top, 1);
        expect(reassigned.width, 'unassigned-to-assigned width').to.be.closeTo(assigned.width, 1);
        expect(reassigned.height, 'unassigned-to-assigned height').to.be.closeTo(assigned.height, 1);
      });
    });
    cy.findByRole('button', { name: 'Change assignee. Current: Avery Owner' }).click();
    cy.findByRole('option', { name: /Unassigned/ }).trigger('mouseover').click();
    cy.findByRole('alert').should(
      'contain.text',
      'Assignee could not be saved. The current value is preserved.',
    );
    cy.get<DOMRect>('@assignedBounds').then((assigned) => {
      cy.findByRole('button', { name: 'Change assignee. Current: Avery Owner' }).should(($button) => {
        const after = $button[0].getBoundingClientRect();
        expect(after.left, 'error left').to.be.closeTo(assigned.left, 1);
        expect(after.width, 'error width').to.be.closeTo(assigned.width, 1);
        expect(after.height, 'error height').to.be.closeTo(assigned.height, 1);
      });
    });
  });


  for (const tall of [false, true]) {
    for (const placement of ['upper', 'lower', 'end', 'empty'] as const) {
      it(`uses a measured ${tall ? 'two-line' : 'one-line'} slot for ${placement} target insertion`, () => {
        const board = dragGeometryBoard(tall);
        const emptyId = board.columns[2].columnId;
        const destination = placement === 'empty' ? emptyId : doingId;
        const order = placement === 'upper' ? [workItemId, targetWorkItemId, lastTargetWorkItemId]
          : placement === 'lower' ? [targetWorkItemId, workItemId, lastTargetWorkItemId]
            : placement === 'end' ? [targetWorkItemId, lastTargetWorkItemId, workItemId] : [workItemId];
        const anchor = placement === 'upper' ? targetWorkItemId : placement === 'lower' ? lastTargetWorkItemId : undefined;
        const authoritative = dragAuthority(board, order, destination);
        const api = apiFor('success', board);
        api.boards.moveCard = cy.stub().resolves({ key: key(1), value: authoritative });
        mountBoard(api, 'en');
        cy.get('[data-cy-root]').invoke('css', 'height', '640px');
        cy.document().then((document) => document.fonts.ready);
        const transfer = new DataTransfer();
        let sourceBounds: DOMRect;
        cy.get(`[data-work-item-id="${workItemId}"]`).then(($source) => {
          sourceBounds = $source[0].getBoundingClientRect();
          const titleHeight = $source[0].querySelector('.board-card__title')!.getBoundingClientRect().height;
          expect(titleHeight, 'fixture has the requested title height').to.be.closeTo(tall ? 40 : 20, 1);
          cy.spy(transfer, 'setDragImage').as('dragImage');
        }).trigger('dragstart', { dataTransfer: transfer }).should('have.class', 'is-dragging');
        cy.get('@dragImage').should('have.been.calledOnce').then((spy) => {
          const preview = (spy as unknown as { firstCall: { args: HTMLElement[] } }).firstCall.args[0];
          expect(parseFloat(preview.style.height), 'preview retains source height').to.be.closeTo(sourceBounds.height, 1);
          expect(parseFloat(preview.style.width), 'preview retains source width').to.be.closeTo(sourceBounds.width, 1);
        });
        cy.get('.board-drop-slot').should('have.length', 1).and(($slot) => {
          expect($slot[0].getBoundingClientRect().height, 'source placeholder').to.be.closeTo(sourceBounds.height, 1);
        });
        const targetSelector = placement === 'empty' ? '.board-column:nth-child(3)' : '.board-column:nth-child(2)';
        const point = () => cy.get(targetSelector).then(($column) => {
          const target = placement === 'end' ? $column[0].querySelector(`[data-work-item-id="${lastTargetWorkItemId}"]`)
            : placement === 'empty' ? $column[0] : $column[0].querySelector(`[data-work-item-id="${targetWorkItemId}"]`);
          const bounds = target!.getBoundingClientRect();
          return placement === 'end' ? bounds.bottom + 4 : bounds.top + bounds.height * (placement === 'upper' ? 0.25 : 0.75);
        });
        point().then((clientY) => cy.get(targetSelector).trigger('dragover', { dataTransfer: transfer, clientY }));
        cy.get('.board-drop-slot').should('have.length', 1).and('be.visible').and(($slot) => {
          expect($slot[0].getBoundingClientRect().height, 'target placeholder').to.be.closeTo(sourceBounds.height, 1);
          expect($slot[0].getBoundingClientRect().width, 'stable column width').to.be.closeTo(sourceBounds.width, 1);
          if (anchor) expect($slot[0].nextElementSibling).to.have.attr('data-work-item-id', anchor);
          else expect($slot[0].nextElementSibling).to.equal(null);
        });
        point().then((clientY) => cy.get(targetSelector).trigger('drop', { dataTransfer: transfer, clientY }));
        cy.wrap(api.boards.moveCard).should('have.been.calledOnceWith', {
          workspaceId, projectId, boardId, workItemId, expectedBoardVersion: 3,
          expectedPlacementVersion: 0, targetColumnId: destination,
          ...(anchor ? { beforeWorkItemId: anchor } : {}),
        });
        cy.get(targetSelector).find('.board-card').should(($cards) => {
          expect([...$cards].map((card) => card.dataset.workItemId)).to.deep.equal(order);
        });
        cy.get('.board-drop-slot, .board-drag-preview, .is-dragging, .is-drop-target').should('not.exist');
      });
    }
  }

  for (const tall of [false, true]) {
    it(`reorders a ${tall ? 'two-line' : 'one-line'} Card within its Column with a measured slot`, () => {
      const original = dragGeometryBoard(tall);
      const board: BoardView = { ...original, columns: original.columns.map((column, index) =>
        index === 0 ? { ...column, cards: [column.cards[0], ...original.columns[1].cards] }
          : index === 1 ? { ...column, cards: [] } : column),
      };
      const order = [targetWorkItemId, workItemId, lastTargetWorkItemId];
      const authoritative = dragAuthority(board, order, todoId);
      const api = apiFor('success', board);
      api.boards.moveCard = cy.stub().resolves({ key: key(1), value: authoritative });
      mountBoard(api, 'en');
      const transfer = new DataTransfer();
      let sourceHeight = 0;
      cy.get(`[data-work-item-id="${workItemId}"]`).then(($source) => {
        sourceHeight = $source[0].getBoundingClientRect().height;
      }).trigger('dragstart', { dataTransfer: transfer }).should('have.class', 'is-dragging');
      const lowerPoint = () => cy.get(`[data-work-item-id="${targetWorkItemId}"]`).then(($target) => {
        const bounds = $target[0].getBoundingClientRect();
        return bounds.top + bounds.height * 0.75;
      });
      lowerPoint().then((clientY) => cy.get('.board-column').first().trigger('dragover', { dataTransfer: transfer, clientY }));
      cy.get('.board-drop-slot').should('have.length', 1).and(($slot) => {
        expect($slot[0].getBoundingClientRect().height).to.be.closeTo(sourceHeight, 1);
        expect($slot[0].nextElementSibling).to.have.attr('data-work-item-id', lastTargetWorkItemId);
        expect($slot[0].previousElementSibling).to.have.attr('data-work-item-id', targetWorkItemId);
      });
      lowerPoint().then((clientY) => cy.get('.board-column').first().trigger('drop', { dataTransfer: transfer, clientY }));
      cy.wrap(api.boards.moveCard).should('have.been.calledOnceWith', {
        workspaceId, projectId, boardId, workItemId, expectedBoardVersion: 3,
        expectedPlacementVersion: 0, targetColumnId: todoId, beforeWorkItemId: lastTargetWorkItemId,
      });
      cy.get('.board-column').first().find('.board-card').should(($cards) => {
        expect([...$cards].map((card) => card.dataset.workItemId)).to.deep.equal(order);
      });
      cy.get('.board-drop-slot, .is-dragging, .is-drop-target').should('not.exist');
      cy.get('.board-canvas').should(($canvas) => {
        expect($canvas[0].style.getPropertyValue('--board-drag-height')).to.equal('');
      });
    });
  }

  it('cleans a cancelled drag without mutation and measures a different next source', () => {
    const board = dragGeometryBoard(true);
    const api = apiFor('success', board);
    mountBoard(api, 'en');
    const transfer = new DataTransfer();
    let tallHeight = 0;
    cy.get(`[data-work-item-id="${workItemId}"]`).then(($source) => {
      tallHeight = $source[0].getBoundingClientRect().height;
    }).trigger('dragstart', { dataTransfer: transfer }).should('have.class', 'is-dragging');
    cy.get('.board-column').eq(2).trigger('dragover', { dataTransfer: transfer });
    cy.get('.board-drop-slot').should('have.length', 1).and(($slot) => {
      expect($slot[0].getBoundingClientRect().height).to.be.closeTo(tallHeight, 1);
    });
    cy.get(`[data-work-item-id="${workItemId}"]`).trigger('dragend', { dataTransfer: transfer, force: true });
    cy.get('.board-drop-slot, .board-drag-preview, .is-dragging, .is-drop-target').should('not.exist');
    cy.wrap(api.boards.moveCard).should('not.have.been.called');
    const next = new DataTransfer();
    let shortHeight = 0;
    cy.get(`[data-work-item-id="${targetWorkItemId}"]`).then(($source) => {
      shortHeight = $source[0].getBoundingClientRect().height;
      expect(tallHeight - shortHeight).to.be.closeTo(20, 1);
    }).trigger('dragstart', { dataTransfer: next }).should('have.class', 'is-dragging');
    cy.get('.board-drop-slot').should('have.length', 1).and(($slot) => {
      expect($slot[0].getBoundingClientRect().height, 'previous height is discarded').to.be.closeTo(shortHeight, 1);
    });
    cy.get(`[data-work-item-id="${targetWorkItemId}"]`).trigger('dragend', { dataTransfer: next, force: true });
    cy.get('.board-drop-slot, .board-drag-preview, .is-dragging, .is-drop-target').should('not.exist');
    cy.wrap(api.boards.moveCard).should('not.have.been.called');
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

  it('removes CSS and JS spatial motion with real media emulation while preserving a precise move', () => {
    reducedMediaActive = true;
    cy.then(() => Cypress.automation('remote:debugger:protocol', {
      command: 'Emulation.setEmulatedMedia',
      params: { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] },
    }));
    const board = dragGeometryBoard(true);
    const sourceCard = board.columns[0].cards[0];
    const authoritative = dragAuthority(board, [targetWorkItemId, workItemId, lastTargetWorkItemId]);
    const api = apiFor('success', board);
    api.boards.moveCard = cy.stub().resolves({ key: key(1), value: authoritative });
    mountBoard(api, 'en');
    cy.window().then((window) => {
      expect(window.matchMedia('(prefers-reduced-motion: reduce)').matches).to.equal(true);
      cy.spy(window.Element.prototype, 'animate').as('layoutAnimation');
    });
    cy.get('.board-column, .board-card, .board-column__actions').should(($elements) => {
      for (const element of $elements) {
        for (const pseudo of [null, '::before', '::after']) {
          const style = getComputedStyle(element, pseudo);
          for (const duration of style.transitionDuration.split(',')) {
            expect(parseFloat(duration), `${element.className} ${pseudo ?? 'element'} transition`).to.equal(0);
          }
        }
      }
    });
    const transfer = new DataTransfer();
    let sourceHeight = 0;
    cy.get(`[data-work-item-id="${workItemId}"]`).then(($source) => {
      sourceHeight = $source[0].getBoundingClientRect().height;
    }).trigger('dragstart', { dataTransfer: transfer }).should('have.class', 'is-dragging');
    cy.get(`[data-work-item-id="${targetWorkItemId}"]`).then(($target) => {
      const bounds = $target[0].getBoundingClientRect();
      cy.findByRole('heading', { name: 'In progress' }).closest('.board-column')
        .trigger('dragover', { dataTransfer: transfer, clientY: bounds.top + bounds.height * 0.75 });
    });
    cy.get('.board-drop-slot').should('have.length', 1).and('be.visible').and(($slot) => {
      const style = getComputedStyle($slot[0]);
      expect(style.animationName, 'insertion reveal is removed').to.equal('none');
      expect($slot[0].getBoundingClientRect().height).to.be.closeTo(sourceHeight, 1);
      expect($slot[0].nextElementSibling).to.have.attr('data-work-item-id', lastTargetWorkItemId);
    });
    cy.get('.is-drop-target').should('have.length', 1).and(($column) => {
      const style = getComputedStyle($column[0]);
      const marker = getComputedStyle($column[0], '::before');
      expect(marker.content, 'structural target marker').not.to.equal('none');
      expect(parseFloat(marker.height), 'marker has physical height').to.be.greaterThan(0);
      expect(parseFloat(marker.opacity), 'target marker remains visible').to.equal(1);
      expect(style.transform, 'target does not translate').to.equal('none');
    });
    cy.get('@layoutAnimation').should('not.have.been.called');
    cy.get(`[data-work-item-id="${targetWorkItemId}"]`).then(($target) => {
      const bounds = $target[0].getBoundingClientRect();
      cy.findByRole('heading', { name: 'In progress' }).closest('.board-column')
        .trigger('drop', { dataTransfer: transfer, clientY: bounds.top + bounds.height * 0.75 });
    });
    cy.wrap(api.boards.moveCard).should('have.been.calledOnceWith', {
      workspaceId, projectId, boardId, workItemId, expectedBoardVersion: 3,
      expectedPlacementVersion: 0, targetColumnId: doingId, beforeWorkItemId: lastTargetWorkItemId,
    });
    cy.get(`[data-work-item-id="${workItemId}"].is-settling`).should(($card) => {
      expect(getComputedStyle($card[0]).animationName, 'settling motion is removed').to.equal('none');
    });
    cy.findByRole('heading', { name: 'In progress' }).closest('.board-column').find('.board-card')
      .should(($cards) => expect([...$cards].map((card) => card.dataset.workItemId)).to.deep.equal([targetWorkItemId, workItemId, lastTargetWorkItemId]));
    cy.findByRole('button', { name: sourceCard.title }).should('be.focused');
    cy.get('.board-drop-slot, .board-drag-preview, .is-dragging, .is-drop-target').should('not.exist');
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
      descriptionPatch: { action: 'SET', value: 'First line\nSecond line' },
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
            .should('have.css', 'font-size', '14px')
            .and('have.css', 'box-shadow', 'none')
            .and('have.css', 'background-color', 'rgba(0, 0, 0, 0)');
          cy.findByText(language.locale === 'en' ? 'Assignee' : '负责人').then(($assigneeLabel) => {
            cy.findByText(language.locale === 'en' ? 'Description' : '描述').then(($descriptionLabel) => {
              expect(
                $descriptionLabel[0].getBoundingClientRect().left,
                'property labels align',
              ).to.be.closeTo($assigneeLabel[0].getBoundingClientRect().left, 1);
            });
          });
          cy.get('.assignee-picker__avatar-slot').then(($valueOrigin) => {
            cy.findByRole('button', { name: language.locale === 'en' ? 'Edit description' : '编辑描述' })
              .then(($description) => {
                expect(
                  $description[0].getBoundingClientRect().left,
                  'description aligns with the visible metadata value column',
                ).to.be.closeTo($valueOrigin[0].getBoundingClientRect().left, 1);
              });
          });
          cy.get('.work-item-detail__meta-strip').should(($strip) => {
            const style = getComputedStyle($strip[0]);
            const strip = $strip[0];
            const content = strip.parentElement!;
            const description = content.querySelector('.work-item-detail__row--description');
            expect(style.backgroundColor, 'metadata strip is flat').to.equal('rgba(0, 0, 0, 0)');
            expect(style.borderTopWidth, 'metadata strip is not a footer separator').to.equal('0px');
            expect(style.borderLeftWidth, 'metadata strip is not an outlined card').to.equal('0px');
            expect([...content.children].indexOf(strip), 'metadata sits above the writing body')
              .to.be.lessThan([...content.children].indexOf(description!));
            expect($strip[0].querySelector('.work-item-detail__meta-panel')).to.equal(null);
          });
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
        cy.findByRole('button', {
          name: locale === 'en'
            ? 'Change assignee. Current: Unassigned'
            : '更改负责人。当前：未分配',
        })
          .should('be.focused')
          .should(($trigger) => {
            const style = getComputedStyle($trigger[0]);
            expect(style.transform, 'focus does not lift the field').to.equal('none');
            expect(style.boxShadow, 'focus has no floating shadow').to.equal('none');
            expect(parseFloat(style.outlineWidth), 'visible keyboard focus').to.be.at.least(2);
          });
        cy.then(async () => { await dispatchChromiumTab(); });
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
      expect(bounds.height, 'standard work sheet height').to.be.within(610, 630);
      const close = $dialog[0].querySelector<HTMLElement>('.icon-action')!;
      const title = $dialog[0].querySelector<HTMLElement>('.work-item-detail__title')!;
      const content = $dialog[0].querySelector<HTMLElement>('.work-item-detail__content')!;
      const assigneeLabel = $dialog[0].querySelector<HTMLElement>('.work-item-detail__meta-field--assignee .work-item-detail__label')!;
      const assigneeTrigger = $dialog[0].querySelector<HTMLElement>('.assignee-picker__trigger')!;
      const assigneeValueOrigin = assigneeTrigger.querySelector<HTMLElement>('.assignee-picker__avatar-slot')!;
      const creatorAudit = $dialog[0].querySelector<HTMLElement>('.work-item-detail__creator-audit')!;
      const footerMetadata = $dialog[0].querySelector<HTMLElement>('.work-item-detail__metadata')!;
      const chevron = assigneeTrigger.querySelector<HTMLElement>('.assignee-picker__chevron')!;
      const descriptionRow = $dialog[0].querySelector<HTMLElement>('.work-item-detail__row--description')!;
      const descriptionLabel = descriptionRow.querySelector<HTMLElement>('.work-item-detail__label')!;
      const description = $dialog[0].querySelector<HTMLElement>('.work-item-detail__description')!;
      const descriptionValue = description.querySelector<HTMLElement>('.work-item-detail__value')!;
      const closeBounds = close.getBoundingClientRect();
      const titleBounds = title.getBoundingClientRect();
      const contentBounds = content.getBoundingClientRect();
      const assigneeLabelBounds = assigneeLabel.getBoundingClientRect();
      const assigneeTriggerBounds = assigneeTrigger.getBoundingClientRect();
      const assigneeValueOriginBounds = assigneeValueOrigin.getBoundingClientRect();
      const creatorAuditBounds = creatorAudit.getBoundingClientRect();
      const footerMetadataBounds = footerMetadata.getBoundingClientRect();
      const chevronBounds = chevron.getBoundingClientRect();
      const descriptionLabelBounds = descriptionLabel.getBoundingClientRect();
      const descriptionBounds = description.getBoundingClientRect();
      const valueBounds = descriptionValue.getBoundingClientRect();
      expect(closeBounds.left - titleBounds.right, 'title-to-close gap').to.be.closeTo(16, 1);
      expect(descriptionLabelBounds.left, 'detail labels share one column').to.be.closeTo(assigneeLabelBounds.left, 1);
      expect(creatorAudit.closest('.work-item-detail__audit'), 'creator belongs to footer').to.not.equal(null);
      expect(creatorAuditBounds.top + creatorAuditBounds.height / 2, 'creator aligns with timestamps')
        .to.be.closeTo(footerMetadataBounds.top + footerMetadataBounds.height / 2, 2);
      expect((chevronBounds.top + chevronBounds.height / 2), 'chevron is vertically centered')
        .to.be.closeTo(assigneeTriggerBounds.top + assigneeTriggerBounds.height / 2, 1);
      expect(descriptionBounds.left, 'description aligns with the visible metadata value column')
        .to.be.closeTo(assigneeValueOriginBounds.left, 1);
      expect(descriptionLabelBounds.top, 'description label and value start on the same row')
        .to.be.closeTo(descriptionBounds.top, 1);
      expect(descriptionBounds.right, 'description keeps a wide writing column').to.be.closeTo(contentBounds.right, 6);
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
        const textareaBounds = $textarea[0].getBoundingClientRect();
        const textareaHeight = textareaBounds.height;
        const labelBounds = $textarea[0]
          .closest('.work-item-detail__row--description')!
          .querySelector<HTMLElement>('.work-item-detail__label')!
          .getBoundingClientRect();
        expect(labelBounds.top, 'description label stays top-aligned with the multiline editor')
          .to.be.closeTo(textareaBounds.top, 1);
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
    const longTitle = 'A long title that remains a single-line field '.repeat(3).trim();
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

  it('atomically rejects over-limit typing, paste, and IME commits while preserving correction paths', () => {
    const api = apiFor();
    openDetail(api, 'en');
    cy.findByRole('button', { name: 'Edit title' }).click();
    const limitValue = '😀'.repeat(PRODUCT_TEXT_LIMITS.workItemTitle);
    const pastedCandidate = `${limitValue}pasted`;

    cy.findByRole('textbox', { name: 'Title' }).then(($input) => {
      const input = $input[0] as HTMLInputElement;
      setNativeTextValue(input, limitValue);
    });
    cy.findByRole('textbox', { name: 'Title' })
      .should('have.value', limitValue)
      .and('be.focused');
    cy.findByLabelText(`${PRODUCT_TEXT_LIMITS.workItemTitle} of ${PRODUCT_TEXT_LIMITS.workItemTitle} characters`)
      .should('be.visible');

    cy.findByRole('textbox', { name: 'Title' }).type('x');
    cy.findByRole('textbox', { name: 'Title' })
      .should('have.value', limitValue)
      .and('be.focused');
    cy.findAllByRole('status').filter(':contains("Limit reached")').should('have.length', 1);

    cy.findByRole('textbox', { name: 'Title' }).then(($input) => {
      const input = $input[0] as HTMLInputElement;
      setNativeTextValue(input, pastedCandidate, 'insertFromPaste');
    });
    cy.findByRole('textbox', { name: 'Title' }).should('have.value', limitValue);

    cy.findByRole('textbox', { name: 'Title' }).then(($input) => {
      const input = $input[0] as HTMLInputElement;
      input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      setNativeTextValue(input, `${limitValue}候选`, 'insertCompositionText');
      expect(input.value, 'composition intermediate remains visible').to.equal(`${limitValue}候选`);
      input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '候选' }));
    });
    cy.findByRole('textbox', { name: 'Title' })
      .should('have.value', limitValue)
      .and('be.focused');

    cy.findByRole('textbox', { name: 'Title' })
      .type('{selectall}A')
      .should('have.value', 'A');
    const correctableLimit = `A${'x'.repeat(PRODUCT_TEXT_LIMITS.workItemTitle - 1)}`;
    cy.findByRole('textbox', { name: 'Title' }).then(($input) => {
      setNativeTextValue($input[0] as HTMLInputElement, correctableLimit);
    });
    cy.findByRole('textbox', { name: 'Title' })
      .type('{backspace}')
      .should('have.value', `A${'x'.repeat(PRODUCT_TEXT_LIMITS.workItemTitle - 2)}`);
    cy.wrap(api.boards.editWorkItem).should('not.have.been.called');
  });

  it('keeps an over-limit historical draft through assignee save and gates closing it', () => {
    const baseline = 'x'.repeat(PRODUCT_TEXT_LIMITS.workItemDescription + 20);
    const draft = 'x'.repeat(PRODUCT_TEXT_LIMITS.workItemDescription + 10);
    const historical: BoardView = {
      ...initialBoard,
      columns: initialBoard.columns.map((column) => ({
        ...column,
        cards: column.cards.map((card) => card.workItemId === workItemId
          ? { ...card, description: baseline }
          : card),
      })),
    };
    const assigned = withAssignee(historical);
    const api = apiFor('success', historical);
    api.boards.editWorkItem = cy.stub().resolves({
      key: key(1),
      value: { workItem: { ...item(assigned), version: 1 }, board: assigned },
    });
    mountBoard(api, 'en');
    cy.findByRole('button', { name: initialBoard.columns[0].cards[0].title }).click();
    cy.findByRole('button', { name: 'Edit description' }).click();
    cy.findByRole('textbox', { name: 'Description' }).then(($input) => {
      const input = $input[0] as HTMLTextAreaElement;
      setNativeTextValue(input, draft, 'deleteContentBackward');
    });

    cy.findByRole('button', { name: 'Change assignee. Current: Unassigned' }).click();
    cy.wrap(api.boards.editWorkItem).should('not.have.been.called');
    cy.findByRole('button', { name: 'Unsaved changes paused' })
      .should('be.visible');
    cy.findByRole('button', { name: 'Edit description' }).should('contain.text', draft);
    cy.findByRole('option', { name: /Avery Owner/ }).click();

    cy.wrap(api.boards.editWorkItem).should('have.been.calledOnce');
    cy.wrap(api.boards.editWorkItem).its('firstCall.args.0').should((input) => {
      expect(input).to.deep.include({ expectedVersion: 0 });
      expect(input).to.have.property('assigneePatch');
      expect(input).not.to.have.property('descriptionPatch');
    });
    cy.findByRole('button', { name: 'Edit description' }).should('contain.text', draft);
    cy.findByRole('button', { name: 'Unsaved changes paused' }).should('be.visible');

    cy.findByRole('button', { name: 'Close' }).click();
    cy.findByRole('alertdialog').should('contain.text', 'Discard unsaved changes?');
    cy.findByRole('button', { name: 'Continue editing' }).click();
    cy.findByRole('textbox', { name: 'Description' })
      .should('have.value', draft)
      .and('be.focused');
    cy.findByRole('button', { name: 'Close' }).click();
    cy.findByRole('alertdialog').should('be.visible');
    cy.findByRole('button', { name: 'Discard and close' }).click();
    cy.findByRole('dialog').should('not.exist');
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
    cy.findByRole('alert').should(
      'contain.text',
      'Couldn’t save the title. Your changes are still here.',
    );
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
    cy.get('.board-drop-slot, .board-drag-preview, .is-dragging, .is-drop-target').should('not.exist');
    cy.findByRole('button', { name: '重新加载' }).click();
    cy.wrap(api.boards.resolveHome).should('have.been.calledTwice');
  });
});
