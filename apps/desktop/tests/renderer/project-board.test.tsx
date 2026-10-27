/** @vitest-environment jsdom */
import { StrictMode } from "react";
import {
  cleanup,
  createEvent,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BoardWorkspace } from "../../src/renderer/board-workspace";
import { LocaleProvider } from "../../src/renderer/i18n/locale-context";
import { useLocale } from "../../src/renderer/i18n/locale-state";
import type {
  BoardResponseKey,
  BoardView,
  ProjectView,
  TaskPilotDesktopApi,
  WorkItemView,
} from "../../src/shared/contracts";

const userId = "11111111-1111-4111-8111-111111111111";
const workspaceId = "22222222-2222-4222-8222-222222222222";
const projectId = "33333333-3333-4333-8333-333333333333";
const boardId = "44444444-4444-4444-8444-444444444444";
const secondBoardId = "55555555-5555-4555-8555-555555555555";
const todoId = "66666666-6666-4666-8666-666666666666";
const doingId = "77777777-7777-4777-8777-777777777777";
const workItemId = "88888888-8888-4888-8888-888888888888";
const targetWorkItemId = "99999999-9999-4999-8999-999999999999";
const lastTargetWorkItemId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const now = "2026-10-15T00:00:00Z";
const project: ProjectView = {
  projectId,
  workspaceId,
  name: "我的项目",
  description: "用户写的描述",
  status: "ACTIVE",
  version: 0,
  createdAt: now,
  updatedAt: now,
  archivedAt: null,
};
const initialBoard: BoardView = {
  boardId,
  projectId,
  name: "工作看板",
  description: "",
  version: 3,
  createdAt: now,
  updatedAt: now,
  columns: [
    {
      columnId: todoId,
      name: "待处理",
      position: 0,
      version: 0,
      createdAt: now,
      updatedAt: now,
      cards: [
        {
          workItemId,
          title: "准备发布",
          description: "检查版本",
          workItemVersion: 0,
          placementVersion: 0,
          position: 0,
        },
      ],
    },
    {
      columnId: doingId,
      name: "处理中",
      position: 1,
      version: 0,
      createdAt: now,
      updatedAt: now,
      cards: [],
    },
  ],
};
const secondBoard: BoardView = {
  ...initialBoard,
  boardId: secondBoardId,
  name: "产品规划",
  version: 0,
  columns: [{ ...initialBoard.columns[0], cards: [] }],
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
              title: "核对发布说明",
              position: 0,
            },
            {
              ...initialBoard.columns[0].cards[0],
              workItemId: lastTargetWorkItemId,
              title: "通知试用用户",
              position: 1,
            },
          ],
        }
      : column,
  ),
};
const key = (id = boardId, generation = 0): BoardResponseKey => ({
  sessionGeneration: 4,
  userId,
  workspaceId,
  projectId,
  boardId: id,
  boardGeneration: generation,
});

function apiFor(board = initialBoard): TaskPilotDesktopApi {
  const boards: TaskPilotDesktopApi["boards"] = {
    resolveHome: vi.fn().mockResolvedValue({
      key: key(board.boardId),
      value: {
        boards: [summary(board), summary(secondBoard)],
        currentBoard: board,
      },
    }),
    list: vi.fn().mockResolvedValue({
      key: key(),
      value: [summary(board), summary(secondBoard)],
    }),
    open: vi.fn().mockImplementation(({ boardId: requested }) =>
      Promise.resolve({
        key: key(requested),
        value: requested === secondBoardId ? secondBoard : board,
      }),
    ),
    create: vi
      .fn()
      .mockResolvedValue({ key: key(secondBoardId, 1), value: secondBoard }),
    edit: vi
      .fn()
      .mockResolvedValue({ key: key(board.boardId, 1), value: board }),
    permanentlyDelete: vi.fn(),
    createColumn: vi
      .fn()
      .mockResolvedValue({ key: key(board.boardId, 1), value: board }),
    editColumn: vi
      .fn()
      .mockResolvedValue({ key: key(board.boardId, 1), value: board }),
    reorderColumns: vi
      .fn()
      .mockResolvedValue({ key: key(board.boardId, 1), value: board }),
    deleteColumn: vi
      .fn()
      .mockResolvedValue({ key: key(board.boardId, 1), value: undefined }),
    createWorkItem: vi.fn().mockResolvedValue({
      key: key(board.boardId, 1),
      value: { workItem: toWorkItem(board.columns[0].cards[0]), board },
    }),
    openWorkItem: vi.fn().mockResolvedValue({
      key: key(),
      value: toWorkItem(board.columns[0].cards[0]),
    }),
    editWorkItem: vi.fn().mockResolvedValue({
      key: key(board.boardId, 1),
      value: {
        workItem: {
          ...toWorkItem(board.columns[0].cards[0]),
          title: "准备正式发布",
          version: 1,
        },
        board: editedBoard(board, "准备正式发布"),
      },
    }),
    moveCard: vi.fn().mockResolvedValue({
      key: key(board.boardId, 1),
      value: movedBoard(board),
    }),
  };
  return {
    boards,
    auth: {
      getCapabilities: vi.fn(),
      startGitHubSignIn: vi.fn(),
      continueGitHubSignIn: vi.fn(),
      completeGitHubRegistration: vi.fn(),
      cancelGitHubSignIn: vi.fn(),
      getSessionView: vi.fn(),
      subscribeSessionView: vi.fn(),
      logout: vi.fn(),
    },
    workspaces: { list: vi.fn() },
    projects: {
      resolveHome: vi.fn(),
      list: vi.fn(),
      open: vi.fn(),
      create: vi.fn(),
      edit: vi.fn(),
      archive: vi.fn(),
      restore: vi.fn(),
      permanentlyDelete: vi.fn(),
    },
  };
}
function summary(board: BoardView) {
  return {
    boardId: board.boardId,
    projectId: board.projectId,
    name: board.name,
    description: board.description,
    version: board.version,
    createdAt: board.createdAt,
    updatedAt: board.updatedAt,
  };
}
function toWorkItem(
  card: BoardView["columns"][number]["cards"][number],
): WorkItemView {
  return {
    workItemId: card.workItemId,
    projectId,
    title: card.title,
    description: card.description,
    version: card.workItemVersion,
    createdAt: now,
    updatedAt: now,
  };
}
function editedBoard(
  board: BoardView,
  title: string,
  targetColumnId = board.columns[0].columnId,
): BoardView {
  const card = board.columns.flatMap((column) => column.cards)[0];
  return {
    ...board,
    version:
      targetColumnId === board.columns[0].columnId
        ? board.version
        : board.version + 1,
    columns: board.columns.map((column) => ({
      ...column,
      cards:
        column.columnId === targetColumnId
          ? [
              {
                ...card,
                title,
                workItemVersion: card.workItemVersion + 1,
                placementVersion:
                  targetColumnId === board.columns[0].columnId
                    ? card.placementVersion
                    : card.placementVersion + 1,
              },
            ]
          : [],
    })),
  };
}
function movedBoard(board: BoardView): BoardView {
  const card = board.columns[0].cards[0];
  return {
    ...board,
    version: board.version + 1,
    columns: [
      { ...board.columns[0], cards: [] },
      {
        ...board.columns[1],
        cards: [{ ...card, position: 0, placementVersion: 1 }],
      },
    ],
  };
}
function rectAt(top: number, height: number): DOMRect {
  return {
    top,
    bottom: top + height,
    left: 0,
    right: 260,
    width: 260,
    height,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}
function dragTransfer() {
  const values = new Map<string, string>();
  return {
    effectAllowed: "none",
    dropEffect: "none",
    setData(type: string, value: string) {
      values.set(type, value);
    },
    getData(type: string) {
      return values.get(type) ?? "";
    },
  };
}
function fireDragOverAt(
  target: HTMLElement,
  dataTransfer: ReturnType<typeof dragTransfer>,
  clientY: number,
) {
  const event = createEvent.dragOver(target, { dataTransfer });
  Object.defineProperty(event, "clientY", { value: clientY });
  fireEvent(target, event);
}
function fireDropAt(
  target: HTMLElement,
  dataTransfer: ReturnType<typeof dragTransfer>,
  clientY: number,
) {
  const event = createEvent.drop(target, { dataTransfer });
  Object.defineProperty(event, "clientY", { value: clientY });
  fireEvent(target, event);
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function LocaleSwitch() {
  const { locale, changeLocale } = useLocale();
  return (
    <button
      type="button"
      onClick={() => void changeLocale(locale === "zh-CN" ? "en" : "zh-CN")}
    >
      switch
    </button>
  );
}
function renderBoard(
  api: TaskPilotDesktopApi,
  withSwitch = false,
  onLeaveProject = vi.fn(),
  strictMode = false,
) {
  const board = (
    <LocaleProvider initialLanguages={["zh-CN"]}>
      {withSwitch ? <LocaleSwitch /> : null}
      <BoardWorkspace
        api={api}
        userId={userId}
        workspaceId={workspaceId}
        project={project}
        onSettings={vi.fn()}
        onLeaveProject={onLeaveProject}
      />
    </LocaleProvider>
  );
  return render(strictMode ? <StrictMode>{board}</StrictMode> : board);
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("Project board deletion", () => {
  const emptyBoard: BoardView = {
    ...initialBoard,
    columns: initialBoard.columns.map((column) => ({ ...column, cards: [] })),
  };

  async function openDeleteDialog(
    api: TaskPilotDesktopApi,
    board: BoardView = emptyBoard,
  ) {
    vi.mocked(api.boards.resolveHome).mockResolvedValue({
      key: key(board.boardId),
      value: { boards: [summary(board)], currentBoard: board },
    });
    const operator = userEvent.setup();
    renderBoard(api);
    await screen.findByRole("heading", { name: board.name });
    await operator.click(screen.getByRole("button", { name: "看板操作" }));
    await operator.click(
      screen.getByRole("menuitem", { name: "永久删除看板" }),
    );
    return operator;
  }

  it("places deletion in local Board actions and requires the exact current name", async () => {
    const api = apiFor();
    const operator = await openDeleteDialog(api);

    expect(
      screen.getByRole("heading", { name: "永久删除“工作看板”？" }),
    ).toBeInTheDocument();
    expect(screen.getByText("此操作无法撤销。")).toBeInTheDocument();
    expect(screen.getByText("只能删除没有卡片的空看板。")).toBeInTheDocument();
    expect(
      screen.getByText("看板中的列表会被删除，但项目工作项会保留。"),
    ).toBeInTheDocument();
    const confirmation = screen.getByLabelText("输入“工作看板”以确认");
    const submit = screen.getByRole("button", { name: "永久删除" });
    expect(submit).toBeDisabled();
    await operator.type(confirmation, "工作看板 ");
    expect(submit).toBeDisabled();
    await operator.clear(confirmation);
    await operator.type(confirmation, "工作看板");
    expect(submit).toBeEnabled();
  });

  it("asks before discarding dirty confirmation and restores focus", async () => {
    const api = apiFor();
    const operator = await openDeleteDialog(api);
    await operator.type(screen.getByLabelText("输入“工作看板”以确认"), "工作");
    await operator.keyboard("{Escape}");
    expect(
      screen.getByRole("heading", { name: "放弃删除确认？" }),
    ).toBeInTheDocument();
    await operator.click(screen.getByRole("button", { name: "继续确认" }));
    expect(screen.getByLabelText("输入“工作看板”以确认")).toHaveValue("工作");
    await operator.keyboard("{Escape}");
    await operator.click(screen.getByRole("button", { name: "放弃并关闭" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "看板操作" })).toHaveFocus();
  });

  it("prevents duplicate deletion while the command is pending", async () => {
    const api = apiFor();
    const pending = deferred<{
      key: BoardResponseKey;
      value: {
        outcome: "deleted";
        home: { boards: []; currentBoard?: BoardView };
      };
    }>();
    vi.mocked(api.boards.permanentlyDelete).mockReturnValue(pending.promise);
    const operator = await openDeleteDialog(api);
    await operator.type(
      screen.getByLabelText("输入“工作看板”以确认"),
      "工作看板",
    );
    const submit = screen.getByRole("button", { name: "永久删除" });
    await operator.click(submit);
    expect(screen.getByRole("button", { name: "正在删除…" })).toBeDisabled();
    await operator.click(screen.getByRole("button", { name: "正在删除…" }));
    expect(api.boards.permanentlyDelete).toHaveBeenCalledOnce();
    expect(api.boards.permanentlyDelete).toHaveBeenCalledWith({
      workspaceId,
      projectId,
      boardId,
      expectedVersion: 3,
      confirmationName: "工作看板",
    });
    pending.resolve({
      key: { ...key(), boardId: undefined, boardGeneration: undefined },
      value: { outcome: "deleted", home: { boards: [] } },
    });
    expect(
      await screen.findByRole("heading", { name: "还没有看板" }),
    ).toBeInTheDocument();
  });

  it.each([
    ["BOARD_NOT_EMPTY", "此看板仍有卡片，未被删除。请先移走所有卡片。"],
    [
      "BOARD_VERSION_CONFLICT",
      "看板已发生变化，未被删除。请重新加载后再确认。",
    ],
    [
      "BOARD_NAME_CONFIRMATION_MISMATCH",
      "看板名称已发生变化，未被删除。请使用当前名称重新确认。",
    ],
    ["BOARD_DELETE_RESTRICTED", "看板仍被受保护的数据引用，未被删除。"],
  ])("shows a stable deletion error for %s", async (code, message) => {
    const api = apiFor();
    vi.mocked(api.boards.permanentlyDelete).mockRejectedValue({
      code,
      category: "conflict",
    });
    const operator = await openDeleteDialog(api);
    await operator.type(
      screen.getByLabelText("输入“工作看板”以确认"),
      "工作看板",
    );
    await operator.click(screen.getByRole("button", { name: "永久删除" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.getByLabelText("输入“工作看板”以确认")).toHaveValue(
      "工作看板",
    );
  });

  it("commits the authoritative remaining Board home returned by Main", async () => {
    const api = apiFor();
    vi.mocked(api.boards.permanentlyDelete).mockResolvedValue({
      key: key(secondBoardId, 1),
      value: {
        outcome: "deleted",
        home: { boards: [summary(secondBoard)], currentBoard: secondBoard },
      },
    });
    const operator = await openDeleteDialog(api);
    await operator.type(
      screen.getByLabelText("输入“工作看板”以确认"),
      "工作看板",
    );
    await operator.click(screen.getByRole("button", { name: "永久删除" }));

    expect(
      await screen.findByRole("heading", { name: "产品规划" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("tab", { name: "工作看板" }),
    ).not.toBeInTheDocument();
    expect(api.boards.resolveHome).toHaveBeenCalledOnce();
  });

  it("uses the authoritative zero-Board home after deleting the last Board", async () => {
    const api = apiFor();
    vi.mocked(api.boards.resolveHome).mockResolvedValue({
      key: key(),
      value: { boards: [summary(emptyBoard)], currentBoard: emptyBoard },
    });
    vi.mocked(api.boards.permanentlyDelete).mockResolvedValue({
      key: { ...key(), boardId: undefined, boardGeneration: undefined },
      value: { outcome: "deleted", home: { boards: [] } },
    });
    const operator = await openDeleteDialog(api);
    await operator.type(
      screen.getByLabelText("输入“工作看板”以确认"),
      "工作看板",
    );
    await operator.click(screen.getByRole("button", { name: "永久删除" }));

    expect(
      await screen.findByRole("heading", { name: "还没有看板" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新建看板" })).toBeEnabled();
  });

  it("keeps an unsuccessfully reconciled Board and reports that it was not deleted", async () => {
    const api = apiFor();
    const latest = { ...emptyBoard, version: 4 };
    vi.mocked(api.boards.permanentlyDelete).mockResolvedValue({
      key: key(boardId, 1),
      value: {
        outcome: "notDeleted",
        home: { boards: [summary(latest)], currentBoard: latest },
      },
    });
    const operator = await openDeleteDialog(api);
    await operator.type(
      screen.getByLabelText("输入“工作看板”以确认"),
      "工作看板",
    );
    await operator.click(screen.getByRole("button", { name: "永久删除" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "看板未被删除，已加载最新状态。",
    );
    expect(
      screen.getByRole("heading", { name: "工作看板" }),
    ).toBeInTheDocument();
  });

  it("restricts an unknown result to reconciliation retry or leaving the Project", async () => {
    const api = apiFor();
    const onLeaveProject = vi.fn();
    vi.mocked(api.boards.permanentlyDelete).mockRejectedValue({
      code: "BOARD_DELETE_RESULT_UNKNOWN",
      category: "unknown",
      recovery: "RETRY",
    });
    const operator = userEvent.setup();
    renderBoard(api, false, onLeaveProject);
    await screen.findByRole("heading", { name: "工作看板" });
    await operator.click(screen.getByRole("button", { name: "看板操作" }));
    await operator.click(
      screen.getByRole("menuitem", { name: "永久删除看板" }),
    );
    await operator.type(
      screen.getByLabelText("输入“工作看板”以确认"),
      "工作看板",
    );
    await operator.click(screen.getByRole("button", { name: "永久删除" }));

    expect(
      await screen.findByRole("heading", { name: "删除结果暂时未知" }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole("button").map((button) => button.textContent),
    ).toEqual(expect.arrayContaining(["重试确认结果", "离开项目"]));
    expect(
      screen.queryByRole("button", { name: "编辑看板" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "添加工作项" }),
    ).not.toBeInTheDocument();

    vi.mocked(api.boards.resolveHome).mockResolvedValueOnce({
      key: key(boardId, 1),
      value: { boards: [summary(emptyBoard)], currentBoard: emptyBoard },
    });
    await operator.click(screen.getByRole("button", { name: "重试确认结果" }));
    expect(
      await screen.findByRole("heading", { name: "工作看板" }),
    ).toBeInTheDocument();
    expect(api.boards.permanentlyDelete).toHaveBeenCalledOnce();

    vi.mocked(api.boards.permanentlyDelete).mockRejectedValueOnce({
      code: "BOARD_DELETE_RESULT_UNKNOWN",
      category: "unknown",
    });
    await operator.click(screen.getByRole("button", { name: "看板操作" }));
    await operator.click(
      screen.getByRole("menuitem", { name: "永久删除看板" }),
    );
    await operator.type(
      screen.getByLabelText("输入“工作看板”以确认"),
      "工作看板",
    );
    await operator.click(screen.getByRole("button", { name: "永久删除" }));
    await operator.click(
      await screen.findByRole("button", { name: "离开项目" }),
    );
    expect(onLeaveProject).toHaveBeenCalledOnce();
  });

  it("reports committed deletion separately when refreshing home fails", async () => {
    const api = apiFor();
    vi.mocked(api.boards.permanentlyDelete).mockRejectedValue({
      code: "BOARD_DELETE_COMMITTED_REFRESH_FAILED",
      category: "temporary",
      recovery: "RETRY",
    });
    const operator = await openDeleteDialog(api);
    await operator.type(
      screen.getByLabelText("输入“工作看板”以确认"),
      "工作看板",
    );
    await operator.click(screen.getByRole("button", { name: "永久删除" }));

    expect(
      await screen.findByRole("heading", { name: "看板已删除，刷新失败" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("删除已经完成，请重新加载看板列表。"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "永久删除" }),
    ).not.toBeInTheDocument();
  });
});

describe("Work Item read-only detail", () => {
  it("renders a focused work sheet with a unique actual heading and persistent field labels", async () => {
    const api = apiFor();
    const operator = userEvent.setup();
    renderBoard(api);
    await screen.findByRole("heading", { name: "工作看板" });
    await operator.click(screen.getByRole("button", { name: "准备发布" }));
    await screen.findByRole("button", { name: "编辑标题" });
    const dialog = screen.getByRole("dialog", { name: "准备发布" });
    const sheet = within(dialog);
    expect(sheet.getAllByRole("heading")).toHaveLength(1);
    const heading = sheet.getByRole("heading", { name: "准备发布" });
    expect(heading).toBeInTheDocument();
    expect(heading).toHaveFocus();
    expect(sheet.getByRole("button", { name: "编辑标题" })).not.toHaveFocus();
    expect(sheet.getAllByText("准备发布")).toHaveLength(1);
    for (const text of ["工作项详情", "当前看板", "状态", "进行中", "标题"]) {
      expect(sheet.queryByText(text, { exact: true })).not.toBeInTheDocument();
    }
    // Description remains the only labeled body field; Board position stays on the canvas.
    expect(sheet.getByText("描述", { exact: true })).toBeInTheDocument();
    expect(sheet.getByRole("button", { name: "编辑描述" })).toHaveTextContent("检查版本");
    expect(sheet.queryByText("所在列表", { exact: true })).not.toBeInTheDocument();
    expect(sheet.queryByRole("button", { name: "编辑所在列表" })).not.toBeInTheDocument();
    expect(sheet.queryByRole("combobox", { name: "所在列表" })).not.toBeInTheDocument();
    expect(dialog.querySelector("footer")).toHaveTextContent("创建时间");
    expect(dialog.querySelector("footer")).toHaveTextContent("更新时间");
    expect(sheet.queryByRole("status")).not.toBeInTheDocument();
    expect(dialog.querySelector(".work-item-detail__save-status")).toBeNull();
  });

  it("loads authoritative detail under the production StrictMode lifecycle", async () => {
    const api = apiFor();
    const operator = userEvent.setup();
    renderBoard(api, false, vi.fn(), true);
    await screen.findByRole("heading", { name: "工作看板" });

    await operator.click(screen.getByRole("button", { name: "准备发布" }));

    expect(
      await screen.findByRole("button", { name: "编辑标题" }),
    ).toHaveTextContent("准备发布");
  });

  it("loads authoritative Work Item detail before showing read-only fields", async () => {
    const api = apiFor();
    const detail =
      deferred<
        Awaited<ReturnType<TaskPilotDesktopApi["boards"]["openWorkItem"]>>
      >();
    vi.mocked(api.boards.openWorkItem).mockReturnValue(detail.promise);
    const operator = userEvent.setup();
    renderBoard(api);
    await screen.findByRole("heading", { name: "工作看板" });
    await operator.click(screen.getByRole("button", { name: "准备发布" }));
    expect(
      screen.getByRole("dialog", { name: "准备发布" }),
    ).toHaveTextContent("正在加载");

    detail.resolve({
      key: key(boardId),
      value: {
        ...toWorkItem(initialBoard.columns[0].cards[0]),
        title: "权威标题",
        description: "权威描述",
        version: 4,
      },
    });
    expect(
      await screen.findByRole("button", { name: "编辑标题" }),
    ).toHaveTextContent("权威标题");
    expect(screen.getByRole("button", { name: "编辑描述" })).toHaveTextContent(
      "权威描述",
    );
    expect(screen.queryByText("所在列表", { exact: true })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "编辑所在列表" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: "标题" }),
    ).not.toBeInTheDocument();
    expect(api.boards.openWorkItem).toHaveBeenCalledWith({
      workspaceId,
      projectId,
      boardId,
      workItemId,
    });
  });

  it("keeps the Board usable when detail loading fails and supports retry", async () => {
    const api = apiFor();
    vi.mocked(api.boards.openWorkItem)
      .mockRejectedValueOnce(new Error("temporary"))
      .mockResolvedValueOnce({
        key: key(boardId),
        value: toWorkItem(initialBoard.columns[0].cards[0]),
      });
    const operator = userEvent.setup();
    renderBoard(api);
    await screen.findByRole("heading", { name: "工作看板" });
    await operator.click(screen.getByRole("button", { name: "准备发布" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "暂时无法加载，请重试",
    );
    expect(
      screen.getByRole("heading", { name: "工作看板" }),
    ).toBeInTheDocument();
    await operator.click(screen.getByRole("button", { name: "重试" }));
    expect(
      await screen.findByRole("button", { name: "编辑标题" }),
    ).toHaveTextContent("准备发布");
    expect(api.boards.openWorkItem).toHaveBeenCalledTimes(2);
  });

  it("ignores a late detail read after closing and restores focus to the Card", async () => {
    const api = apiFor();
    const detail =
      deferred<
        Awaited<ReturnType<TaskPilotDesktopApi["boards"]["openWorkItem"]>>
      >();
    vi.mocked(api.boards.openWorkItem).mockReturnValue(detail.promise);
    const operator = userEvent.setup();
    renderBoard(api);
    await screen.findByRole("heading", { name: "工作看板" });
    const card = screen.getByRole("button", { name: "准备发布" });
    await operator.click(card);
    await operator.click(screen.getByRole("button", { name: "关闭" }));
    expect(card).toHaveFocus();
    detail.resolve({
      key: key(boardId),
      value: toWorkItem(initialBoard.columns[0].cards[0]),
    });
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog"),
      ).not.toBeInTheDocument(),
    );
  });
});

describe("Work Item title and description fields", () => {
  it("edits only the title from the latest confirmed baseline and Enter saves it", async () => {
    const api = apiFor();
    const confirmed = {
      ...toWorkItem(initialBoard.columns[0].cards[0]),
      title: "服务端标题",
      description: "服务端描述",
      version: 4,
    };
    vi.mocked(api.boards.openWorkItem).mockResolvedValue({
      key: key(),
      value: confirmed,
    });
    const authoritative = editedBoard(initialBoard, "准备正式发布");
    vi.mocked(api.boards.editWorkItem).mockResolvedValue({
      key: key(boardId, 1),
      value: {
        workItem: { ...confirmed, title: "准备正式发布", version: 5 },
        board: authoritative,
      },
    });
    const operator = userEvent.setup();
    renderBoard(api);
    await screen.findByRole("heading", { name: "工作看板" });
    await operator.click(screen.getByRole("button", { name: "准备发布" }));
    await operator.click(
      await screen.findByRole("button", { name: "编辑标题" }),
    );

    const title = screen.getByRole("textbox", { name: "标题" });
    expect(
      screen.queryByRole("textbox", { name: "描述" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "保存更改" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "取消" })).not.toBeInTheDocument();
    await operator.clear(title);
    await operator.type(title, "准备正式发布{Enter}");

    expect(api.boards.editWorkItem).toHaveBeenCalledWith({
      workspaceId,
      projectId,
      boardId,
      workItemId,
      currentColumnId: todoId,
      targetColumnId: todoId,
      expectedVersion: 4,
      title: "准备正式发布",
      description: "服务端描述",
    });
    expect(
      await screen.findByRole("button", { name: "编辑标题" }),
    ).toHaveTextContent("准备正式发布");
    expect(
      screen.getByRole("button", { name: "准备正式发布" }),
    ).toBeInTheDocument();
  });

  it("saves title on true focus exit and Escape discards a later draft", async () => {
    const api = apiFor();
    const authoritative = editedBoard(initialBoard, "失焦保存");
    vi.mocked(api.boards.editWorkItem).mockResolvedValue({
      key: key(boardId, 1),
      value: {
        workItem: { ...toWorkItem(authoritative.columns[0].cards[0]), version: 1 },
        board: authoritative,
      },
    });
    const operator = userEvent.setup();
    renderBoard(api);
    await screen.findByRole("heading", { name: "工作看板" });
    await operator.click(screen.getByRole("button", { name: "准备发布" }));
    await operator.click(await screen.findByRole("button", { name: "编辑标题" }));
    const title = screen.getByRole("textbox", { name: "标题" });
    await operator.clear(title);
    await operator.type(title, "失焦保存");
    await operator.tab();
    await waitFor(() => expect(api.boards.editWorkItem).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("status")).toHaveTextContent("已保存");

    await operator.click(screen.getByRole("button", { name: "编辑标题" }));
    const secondDraft = screen.getByRole("textbox", { name: "标题" });
    await operator.clear(secondDraft);
    await operator.type(secondDraft, "不要提交{Escape}");
    expect(api.boards.editWorkItem).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "编辑标题" })).toHaveTextContent("失焦保存");
  });

  it("saves a dirty field before closing the detail without a confirmation gate", async () => {
    const api = apiFor();
    const authoritative = editedBoard(initialBoard, "保存后关闭");
    vi.mocked(api.boards.editWorkItem).mockResolvedValue({
      key: key(boardId, 1),
      value: {
        workItem: {
          ...toWorkItem(authoritative.columns[0].cards[0]),
          version: 1,
        },
        board: authoritative,
      },
    });
    const operator = userEvent.setup();
    renderBoard(api);
    await screen.findByRole("heading", { name: "工作看板" });
    await operator.click(screen.getByRole("button", { name: "准备发布" }));
    await operator.click(
      await screen.findByRole("button", { name: "编辑标题" }),
    );
    const title = screen.getByRole("textbox", { name: "标题" });
    await operator.clear(title);
    await operator.type(title, "保存后关闭");
    await operator.click(screen.getByRole("button", { name: "关闭" }));

    expect(screen.queryByRole("group", { name: "有未保存的更改" })).not.toBeInTheDocument();

    await waitFor(() =>
      expect(
        screen.queryByRole("dialog"),
      ).not.toBeInTheDocument(),
    );
    expect(api.boards.editWorkItem).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("button", { name: "保存后关闭" }),
    ).toBeInTheDocument();
  });

  it("does not resubmit an in-flight draft when close is requested repeatedly", async () => {
    const api = apiFor();
    const authoritative = editedBoard(initialBoard, "保存一次后关闭");
    const save = deferred<Awaited<ReturnType<TaskPilotDesktopApi["boards"]["editWorkItem"]>>>();
    vi.mocked(api.boards.editWorkItem).mockReturnValue(save.promise);
    const operator = userEvent.setup();
    renderBoard(api);
    await screen.findByRole("heading", { name: "工作看板" });
    await operator.click(screen.getByRole("button", { name: "准备发布" }));
    await operator.click(
      await screen.findByRole("button", { name: "编辑标题" }),
    );
    const title = screen.getByRole("textbox", { name: "标题" });
    await operator.clear(title);
    await operator.type(title, "保存一次后关闭");
    await operator.click(screen.getByRole("button", { name: "关闭" }));
    await operator.click(screen.getByRole("button", { name: "关闭" }));

    expect(api.boards.editWorkItem).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveTextContent("保存中");
    save.resolve({
      key: key(boardId, 1),
      value: {
        workItem: {
          ...toWorkItem(authoritative.columns[0].cards[0]),
          version: 1,
        },
        board: authoritative,
      },
    });

    await waitFor(() =>
      expect(
        screen.queryByRole("dialog"),
      ).not.toBeInTheDocument(),
    );
    expect(api.boards.editWorkItem).toHaveBeenCalledTimes(1);
  });

  it("keeps one save in flight while a conflict refresh is pending", async () => {
    const api = apiFor();
    const workItemRefresh = deferred<
      Awaited<ReturnType<TaskPilotDesktopApi["boards"]["openWorkItem"]>>
    >();
    const boardRefresh = deferred<
      Awaited<ReturnType<TaskPilotDesktopApi["boards"]["open"]>>
    >();
    vi.mocked(api.boards.editWorkItem).mockRejectedValue(
      Object.assign(new Error("conflict"), { code: "RESOURCE_VERSION_CONFLICT" }),
    );
    vi.mocked(api.boards.openWorkItem)
      .mockResolvedValueOnce({
        key: key(),
        value: toWorkItem(initialBoard.columns[0].cards[0]),
      })
      .mockReturnValueOnce(workItemRefresh.promise);
    vi.mocked(api.boards.open).mockReturnValueOnce(boardRefresh.promise);
    const operator = userEvent.setup();
    renderBoard(api);
    await screen.findByRole("heading", { name: "工作看板" });
    await operator.click(screen.getByRole("button", { name: "准备发布" }));
    await operator.click(
      await screen.findByRole("button", { name: "编辑标题" }),
    );
    const title = screen.getByRole("textbox", { name: "标题" });
    await operator.clear(title);
    await operator.type(title, "冲突期间只保存一次{Enter}");
    await waitFor(() => expect(api.boards.open).toHaveBeenCalledTimes(1));

    await operator.click(screen.getByRole("button", { name: "关闭" }));
    expect(api.boards.editWorkItem).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveTextContent("保存中");

    const latestBoard = { ...initialBoard, version: 4 };
    workItemRefresh.resolve({
      key: key(boardId, 1),
      value: { ...toWorkItem(initialBoard.columns[0].cards[0]), version: 1 },
    });
    boardRefresh.resolve({ key: key(boardId, 1), value: latestBoard });

    expect(
      await screen.findByRole("group", { name: "标题发生冲突" }),
    ).toBeInTheDocument();
    expect(api.boards.editWorkItem).toHaveBeenCalledTimes(1);
  });

  it("recovers locally when a successful save response is superseded", async () => {
    const api = apiFor();
    const authoritative = editedBoard(initialBoard, "迟到响应");
    vi.mocked(api.boards.editWorkItem).mockResolvedValue({
      key: key(boardId, -1),
      value: {
        workItem: {
          ...toWorkItem(authoritative.columns[0].cards[0]),
          version: 1,
        },
        board: authoritative,
      },
    });
    const operator = userEvent.setup();
    renderBoard(api);
    await screen.findByRole("heading", { name: "工作看板" });
    await operator.click(screen.getByRole("button", { name: "准备发布" }));
    await operator.click(
      await screen.findByRole("button", { name: "编辑标题" }),
    );
    const title = screen.getByRole("textbox", { name: "标题" });
    await operator.clear(title);
    await operator.type(title, "迟到响应{Enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "暂时无法保存标题",
    );
    expect(screen.getByRole("textbox", { name: "标题" })).toHaveValue(
      "迟到响应",
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("keeps the title editor, draft and field labels mounted while the save is pending", async () => {
    const api = apiFor();
    const save = deferred<Awaited<ReturnType<TaskPilotDesktopApi["boards"]["editWorkItem"]>>>();
    vi.mocked(api.boards.editWorkItem).mockReturnValue(save.promise);
    const authoritative = editedBoard(initialBoard, "保存中仍保留编辑器");
    const operator = userEvent.setup();
    renderBoard(api);
    await screen.findByRole("heading", { name: "工作看板" });
    await operator.click(screen.getByRole("button", { name: "准备发布" }));
    await operator.click(await screen.findByRole("button", { name: "编辑标题" }));
    const title = screen.getByRole("textbox", { name: "标题" });
    await operator.clear(title);
    await operator.type(title, "保存中仍保留编辑器{Enter}");
    await screen.findByRole("status");

    // The editor and its draft stay instead of an early read-only swap.
    expect(screen.getByRole("textbox", { name: "标题" })).toHaveValue(
      "保存中仍保留编辑器",
    );
    expect(screen.getByText("描述", { exact: true })).toBeInTheDocument();
    expect(screen.queryByText("所在列表", { exact: true })).not.toBeInTheDocument();

    save.resolve({
      key: key(boardId, 1),
      value: {
        workItem: { ...toWorkItem(authoritative.columns[0].cards[0]), version: 1 },
        board: authoritative,
      },
    });
    expect(
      await screen.findByRole("button", { name: "编辑标题" }),
    ).toHaveTextContent("保存中仍保留编辑器");
    expect(screen.queryByRole("textbox", { name: "标题" })).not.toBeInTheDocument();
  });

  it("does not submit the title while an IME composition is active, then submits after it ends", async () => {
    const api = apiFor();
    vi.mocked(api.boards.editWorkItem).mockResolvedValue({
      key: key(boardId, 1),
      value: {
        workItem: {
          ...toWorkItem(initialBoard.columns[0].cards[0]),
          title: "候选确认",
          version: 1,
        },
        board: editedBoard(initialBoard, "候选确认"),
      },
    });
    const operator = userEvent.setup();
    renderBoard(api);
    await screen.findByRole("heading", { name: "工作看板" });
    await operator.click(screen.getByRole("button", { name: "准备发布" }));
    await operator.click(await screen.findByRole("button", { name: "编辑标题" }));
    const title = screen.getByRole("textbox", { name: "标题" });
    await operator.clear(title);
    fireEvent.compositionStart(title);
    await operator.type(title, "候选确认");
    fireEvent.keyDown(title, { key: "Enter", code: "Enter" });
    expect(api.boards.editWorkItem).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "标题" })).toBeInTheDocument();

    fireEvent.compositionEnd(title);
    await operator.keyboard("{Enter}");
    await waitFor(() => expect(api.boards.editWorkItem).toHaveBeenCalledTimes(1));
  });

  it("keeps description Enter as a newline and saves with Ctrl+Enter", async () => {
    const api = apiFor();
    const authoritative = editedBoard(initialBoard, "准备发布");
    authoritative.columns[0].cards[0].description = "第一行\n第二行";
    vi.mocked(api.boards.editWorkItem).mockResolvedValue({
      key: key(boardId, 1),
      value: {
        workItem: {
          ...toWorkItem(authoritative.columns[0].cards[0]),
          version: 1,
        },
        board: authoritative,
      },
    });
    const operator = userEvent.setup();
    renderBoard(api);
    await screen.findByRole("heading", { name: "工作看板" });
    await operator.click(screen.getByRole("button", { name: "准备发布" }));
    await operator.click(
      await screen.findByRole("button", { name: "编辑描述" }),
    );
    const description = screen.getByRole("textbox", { name: "描述" });
    await operator.clear(description);
    await operator.type(description, "第一行{Enter}第二行");
    expect(description).toHaveValue("第一行\n第二行");
    expect(api.boards.editWorkItem).not.toHaveBeenCalled();
    await operator.keyboard("{Control>}{Enter}{/Control}");
    expect(api.boards.editWorkItem).toHaveBeenCalledWith(
      expect.objectContaining({
        description: "第一行\n第二行",
        title: "准备发布",
      }),
    );
  });

  it("validates locally and retains a title draft after a temporary save failure", async () => {
    const api = apiFor();
    vi.mocked(api.boards.editWorkItem).mockRejectedValue(
      new Error("temporary"),
    );
    const operator = userEvent.setup();
    renderBoard(api);
    await screen.findByRole("heading", { name: "工作看板" });
    await operator.click(screen.getByRole("button", { name: "准备发布" }));
    await operator.click(
      await screen.findByRole("button", { name: "编辑标题" }),
    );
    const title = screen.getByRole("textbox", { name: "标题" });
    await operator.clear(title);
    await operator.keyboard("{Enter}");
    expect(screen.getByRole("alert")).toHaveTextContent("标题不能为空");
    expect(api.boards.editWorkItem).not.toHaveBeenCalled();

    await operator.type(title, "保留这个草稿{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "暂时无法保存标题",
    );
    expect(screen.getByRole("textbox", { name: "标题" })).toHaveValue(
      "保留这个草稿",
    );
    expect(
      screen.getByRole("button", { name: "准备发布" }),
    ).toBeInTheDocument();
  });
});

describe("Project board workspace", () => {
  it("lands on the resolved board, renders Cards by workItemId, and switches boards", async () => {
    const api = apiFor();
    const operator = userEvent.setup();
    renderBoard(api);
    expect(
      await screen.findByRole("heading", { name: "工作看板" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("准备发布").closest(".board-card"),
    ).not.toHaveAttribute("data-card-id");
    await operator.click(screen.getByRole("tab", { name: "产品规划" }));
    expect(
      await screen.findByRole("heading", { name: "产品规划" }),
    ).toBeInTheDocument();
    expect(api.boards.open).toHaveBeenCalledWith({
      workspaceId,
      projectId,
      boardId: secondBoardId,
    });
  });

  it("uses roving focus and arrow keys to switch Board tabs", async () => {
    const api = apiFor();
    const operator = userEvent.setup();
    renderBoard(api);
    const current = await screen.findByRole("tab", { name: "工作看板" });
    const next = screen.getByRole("tab", { name: "产品规划" });
    expect(current).toHaveAttribute("tabindex", "0");
    expect(next).toHaveAttribute("tabindex", "-1");

    current.focus();
    await operator.keyboard("{ArrowRight}");

    await waitFor(() => expect(next).toHaveAttribute("aria-selected", "true"));
    expect(next).toHaveFocus();
    expect(next).toHaveAttribute("tabindex", "0");
    expect(current).toHaveAttribute("tabindex", "-1");
    expect(api.boards.open).toHaveBeenCalledWith({
      workspaceId,
      projectId,
      boardId: secondBoardId,
    });
  });

  it("creates a board with locale and one request id, then selects it", async () => {
    const api = apiFor();
    const operator = userEvent.setup();
    renderBoard(api);
    await screen.findByRole("heading", { name: "工作看板" });
    await operator.click(screen.getByRole("button", { name: "新建看板" }));
    await operator.type(screen.getByLabelText("看板名称"), "产品规划");
    await operator.click(screen.getByRole("button", { name: "保存更改" }));
    expect(api.boards.create).toHaveBeenCalledWith({
      workspaceId,
      projectId,
      requestId: expect.any(String),
      name: "产品规划",
      description: "",
      locale: "zh-CN",
    });
    expect(
      await screen.findByRole("heading", { name: "产品规划" }),
    ).toBeInTheDocument();
  });

  it("creates a Work Item in the selected Column with one stable request id", async () => {
    const api = apiFor();
    const operator = userEvent.setup();
    renderBoard(api);
    await screen.findByRole("heading", { name: "工作看板" });
    await operator.click(
      screen.getAllByRole("button", { name: "添加工作项" })[1],
    );
    await operator.type(screen.getByLabelText("标题"), "评审发布说明");
    await operator.type(screen.getByLabelText("描述（可选）"), "确认升级步骤");
    await operator.click(screen.getByRole("button", { name: "保存更改" }));
    expect(api.boards.createWorkItem).toHaveBeenCalledWith({
      workspaceId,
      projectId,
      boardId,
      columnId: doingId,
      requestId: expect.any(String),
      expectedBoardVersion: 3,
      title: "评审发布说明",
      description: "确认升级步骤",
    });
  });

  it("edits the Board and Column, reorders Columns, and deletes only an empty non-final Column", async () => {
    const api = apiFor();
    const operator = userEvent.setup();
    renderBoard(api);
    await screen.findByRole("heading", { name: "工作看板" });

    await operator.click(screen.getByRole("button", { name: "编辑看板" }));
    const boardName = screen.getByLabelText("看板名称");
    await operator.clear(boardName);
    await operator.type(boardName, "发布看板");
    await operator.click(screen.getByRole("button", { name: "保存更改" }));
    expect(api.boards.edit).toHaveBeenCalledWith(
      expect.objectContaining({
        boardId,
        expectedVersion: 3,
        name: "发布看板",
      }),
    );

    await operator.click(screen.getByRole("button", { name: "编辑处理中" }));
    const columnName = screen.getByLabelText("列表名称");
    await operator.clear(columnName);
    await operator.type(columnName, "进行中");
    await operator.click(screen.getByRole("button", { name: "保存更改" }));
    expect(api.boards.editColumn).toHaveBeenCalledWith(
      expect.objectContaining({
        boardId,
        columnId: doingId,
        expectedBoardVersion: 3,
        expectedColumnVersion: 0,
        name: "进行中",
      }),
    );

    await operator.click(
      screen.getByRole("button", { name: "向左移动处理中" }),
    );
    expect(api.boards.reorderColumns).toHaveBeenCalledWith({
      workspaceId,
      projectId,
      boardId,
      expectedBoardVersion: 3,
      columnIds: [doingId, todoId],
    });

    await operator.click(screen.getByRole("button", { name: "删除处理中" }));
    expect(api.boards.deleteColumn).toHaveBeenCalledWith({
      workspaceId,
      projectId,
      boardId,
      columnId: doingId,
      expectedBoardVersion: 3,
      expectedColumnVersion: 0,
    });
    expect(api.boards.open).toHaveBeenCalledWith({
      workspaceId,
      projectId,
      boardId,
    });
    expect(screen.getByRole("button", { name: "删除待处理" })).toBeDisabled();
  });

  it("shows drag source, target, insertion, and settle states while using the server snapshot", async () => {
    const api = apiFor();
    const authoritative = movedBoard(initialBoard);
    vi.mocked(api.boards.moveCard).mockResolvedValue({
      key: key(boardId, 1),
      value: authoritative,
    });
    renderBoard(api);
    await screen.findByRole("heading", { name: "工作看板" });
    const card = screen
      .getByRole("button", { name: "准备发布" })
      .closest(".board-card")!;
    const targetColumn = screen
      .getByRole("heading", { name: "处理中" })
      .closest(".board-column")!;
    const dataTransfer = dragTransfer();

    fireEvent.dragStart(card, { dataTransfer });
    await waitFor(() => expect(card).toHaveClass("is-dragging"));
    expect(card).not.toHaveAttribute("inert");
    fireEvent.dragOver(targetColumn, { dataTransfer, clientY: 120 });
    expect(targetColumn).toHaveClass("is-drop-target");
    expect(targetColumn.querySelectorAll(".board-drop-slot")).toHaveLength(1);
    expect(targetColumn.querySelector(".board-column__empty")).toBeNull();
    fireEvent.drop(targetColumn, { dataTransfer, clientY: 120 });

    await waitFor(() => expect(api.boards.moveCard).toHaveBeenCalledTimes(1));
    const movedCard = screen
      .getByRole("button", { name: "准备发布" })
      .closest(".board-card")!;
    expect(movedCard).toHaveClass("is-settling");
    await waitFor(() => expect(movedCard).not.toHaveClass("is-settling"));
  });

  it.each([
    {
      name: "第一张 Card 前",
      pointerY: 120,
      beforeWorkItemId: targetWorkItemId,
      slotAfterWorkItemId: undefined,
      slotBeforeWorkItemId: targetWorkItemId,
    },
    {
      name: "两张 Card 之间",
      pointerY: 170,
      beforeWorkItemId: lastTargetWorkItemId,
      slotAfterWorkItemId: targetWorkItemId,
      slotBeforeWorkItemId: lastTargetWorkItemId,
    },
    {
      name: "最后一张 Card 后",
      pointerY: 270,
      beforeWorkItemId: undefined,
      slotAfterWorkItemId: lastTargetWorkItemId,
      slotBeforeWorkItemId: undefined,
    },
  ])(
    "按最近边缘把落点解析到$name",
    async ({
      pointerY,
      beforeWorkItemId,
      slotAfterWorkItemId,
      slotBeforeWorkItemId,
    }) => {
      const api = apiFor(boardWithTargetCards);
      renderBoard(api);
      await screen.findByRole("heading", { name: "工作看板" });
      const sourceCard = screen
        .getByRole("button", { name: "准备发布" })
        .closest<HTMLElement>(".board-card")!;
      const targetColumn = screen
        .getByRole("heading", { name: "处理中" })
        .closest<HTMLElement>(".board-column")!;
      const firstTarget = targetColumn.querySelector<HTMLElement>(
        `[data-work-item-id="${targetWorkItemId}"]`,
      )!;
      const lastTarget = targetColumn.querySelector<HTMLElement>(
        `[data-work-item-id="${lastTargetWorkItemId}"]`,
      )!;
      vi.spyOn(firstTarget, "getBoundingClientRect").mockReturnValue(
        rectAt(100, 84),
      );
      vi.spyOn(lastTarget, "getBoundingClientRect").mockReturnValue(
        rectAt(184, 84),
      );
      const dataTransfer = dragTransfer();

      fireEvent.dragStart(sourceCard, { dataTransfer });
      fireDragOverAt(targetColumn, dataTransfer, pointerY);

      expect(targetColumn).toHaveClass("is-drop-target");
      const slots =
        targetColumn.querySelectorAll<HTMLElement>(".board-drop-slot");
      expect(slots).toHaveLength(1);
      const slot = slots[0];
      if (slotAfterWorkItemId) {
        expect(
          targetColumn.querySelector(
            `[data-work-item-id="${slotAfterWorkItemId}"]`,
          )?.nextElementSibling,
        ).toBe(slot);
      } else {
        expect(slot.previousElementSibling).toBeNull();
      }
      if (slotBeforeWorkItemId) {
        expect(slot.nextElementSibling).toBe(
          targetColumn.querySelector(
            `[data-work-item-id="${slotBeforeWorkItemId}"]`,
          ),
        );
      } else {
        expect(slot.nextElementSibling).toBeNull();
      }

      fireDropAt(targetColumn, dataTransfer, pointerY);
      await waitFor(() => expect(api.boards.moveCard).toHaveBeenCalledTimes(1));
      expect(api.boards.moveCard).toHaveBeenCalledWith({
        workspaceId,
        projectId,
        boardId,
        workItemId,
        expectedBoardVersion: 3,
        expectedPlacementVersion: 0,
        targetColumnId: doingId,
        ...(beforeWorkItemId ? { beforeWorkItemId } : {}),
      });
    },
  );

  it("keeps a same-column drop near the source Card at its original position", async () => {
    const api = apiFor();
    renderBoard(api);
    await screen.findByRole("heading", { name: "工作看板" });
    const sourceCard = screen
      .getByRole("button", { name: "准备发布" })
      .closest<HTMLElement>(".board-card")!;
    const sourceColumn = screen
      .getByRole("heading", { name: "待处理" })
      .closest<HTMLElement>(".board-column")!;
    vi.spyOn(sourceCard, "getBoundingClientRect").mockReturnValue(
      rectAt(100, 84),
    );
    const dataTransfer = dragTransfer();

    fireEvent.dragStart(sourceCard, { dataTransfer });
    await waitFor(() => expect(sourceCard).toHaveClass("is-dragging"));
    fireDragOverAt(sourceColumn, dataTransfer, 120);

    const slots =
      sourceColumn.querySelectorAll<HTMLElement>(".board-drop-slot");
    expect(slots).toHaveLength(1);
    expect(sourceCard).toHaveClass("is-dragging");

    fireDropAt(sourceColumn, dataTransfer, 120);
    expect(api.boards.moveCard).not.toHaveBeenCalled();
  });

  it("restores the authoritative layout and announces a failed drag move", async () => {
    const api = apiFor();
    vi.mocked(api.boards.moveCard).mockRejectedValue(new Error("conflict"));
    renderBoard(api);
    await screen.findByRole("heading", { name: "工作看板" });
    const card = screen
      .getByRole("button", { name: "准备发布" })
      .closest(".board-card")!;
    const targetColumn = screen
      .getByRole("heading", { name: "处理中" })
      .closest(".board-column")!;
    const dataTransfer = dragTransfer();
    fireEvent.dragStart(card, { dataTransfer });
    fireEvent.drop(targetColumn, { dataTransfer });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "未能移动准备发布，已恢复原布局。",
    );
    expect(
      screen.getByRole("heading", { name: "待处理" }).closest(".board-column"),
    ).toHaveTextContent("准备发布");
  });

  it("restores focus to the invoking control when a dialog is cancelled", async () => {
    const api = apiFor();
    const operator = userEvent.setup();
    renderBoard(api);
    await screen.findByRole("heading", { name: "工作看板" });
    const editBoard = screen.getByRole("button", { name: "编辑看板" });
    await operator.click(editBoard);
    expect(screen.getByLabelText("看板名称")).toHaveFocus();
    await operator.click(screen.getByRole("button", { name: "取消" }));
    expect(editBoard).toHaveFocus();
  });

  it("keeps a pending Board selection when an old Board mutation succeeds late", async () => {
    const api = apiFor();
    const reorder = deferred<{ key: BoardResponseKey; value: BoardView }>();
    const nextBoard = deferred<{ key: BoardResponseKey; value: BoardView }>();
    vi.mocked(api.boards.reorderColumns).mockReturnValue(reorder.promise);
    vi.mocked(api.boards.open).mockReturnValue(nextBoard.promise);
    const operator = userEvent.setup();
    renderBoard(api);
    await screen.findByRole("heading", { name: "工作看板" });

    await operator.click(
      screen.getByRole("button", { name: "向左移动处理中" }),
    );
    await operator.click(screen.getByRole("tab", { name: "产品规划" }));
    reorder.resolve({
      key: key(boardId, 1),
      value: { ...initialBoard, name: "迟到的旧看板" },
    });

    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: "迟到的旧看板" }),
      ).not.toBeInTheDocument(),
    );
    nextBoard.resolve({ key: key(secondBoardId), value: secondBoard });
    expect(
      await screen.findByRole("heading", { name: "产品规划" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("暂时无法保存更改，请重试。"),
    ).not.toBeInTheDocument();
  });

  it("does not show an old Board mutation error while another Board selection is pending", async () => {
    const api = apiFor();
    const reorder = deferred<never>();
    const nextBoard = deferred<{ key: BoardResponseKey; value: BoardView }>();
    vi.mocked(api.boards.reorderColumns).mockReturnValue(reorder.promise);
    vi.mocked(api.boards.open).mockReturnValue(nextBoard.promise);
    const operator = userEvent.setup();
    renderBoard(api);
    await screen.findByRole("heading", { name: "工作看板" });

    await operator.click(
      screen.getByRole("button", { name: "向左移动处理中" }),
    );
    await operator.click(screen.getByRole("tab", { name: "产品规划" }));
    reorder.reject(new Error("conflict"));
    await waitFor(() =>
      expect(
        screen.queryByText("暂时无法保存更改，请重试。"),
      ).not.toBeInTheDocument(),
    );

    nextBoard.resolve({ key: key(secondBoardId), value: secondBoard });
    expect(
      await screen.findByRole("heading", { name: "产品规划" }),
    ).toBeInTheDocument();
  });

  it("does not apply or report an old atomic edit after selecting another Board", async () => {
    const api = apiFor();
    const edit = deferred<never>();
    vi.mocked(api.boards.editWorkItem).mockReturnValue(edit.promise);
    const operator = userEvent.setup();
    renderBoard(api);
    await screen.findByRole("heading", { name: "工作看板" });

    await operator.click(screen.getByRole("button", { name: "准备发布" }));
    await operator.click(
      await screen.findByRole("button", { name: "编辑标题" }),
    );
    const title = screen.getByRole("textbox", { name: "标题" });
    await operator.clear(title);
    await operator.type(title, "等待中的详情保存{Enter}");
    await waitFor(() => expect(api.boards.editWorkItem).toHaveBeenCalledTimes(1));
    expect(api.boards.editWorkItem).toHaveBeenCalledWith(
      expect.objectContaining({
        currentColumnId: todoId,
        targetColumnId: todoId,
      }),
    );
    await operator.click(screen.getByRole("tab", { name: "产品规划" }));
    expect(
      await screen.findByRole("heading", { name: "产品规划" }),
    ).toBeInTheDocument();

    edit.reject(new Error("conflict"));
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "产品规划" }),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByText("准备发布")).not.toBeInTheDocument();
    expect(
      screen.queryByText("未能移动准备发布，已恢复原布局。"),
    ).not.toBeInTheDocument();
  });

  it("rejects an old Board read after a mutation generation and preserves edited content", async () => {
    const api = apiFor();
    const oldRead = deferred<{ key: BoardResponseKey; value: BoardView }>();
    vi.mocked(api.boards.open).mockReturnValue(oldRead.promise);
    const operator = userEvent.setup();
    renderBoard(api);
    await screen.findByRole("heading", { name: "工作看板" });
    await operator.click(screen.getByRole("tab", { name: "工作看板" }));
    await operator.click(screen.getByRole("button", { name: "准备发布" }));
    await operator.click(
      await screen.findByRole("button", { name: "编辑标题" }),
    );
    const title = screen.getByLabelText("标题");
    await operator.clear(title);
    await operator.type(title, "准备正式发布{Enter}");
    expect(
      await screen.findByRole("button", { name: "准备正式发布" }),
    ).toBeInTheDocument();
    const submitted = vi.mocked(api.boards.editWorkItem).mock.calls[0]?.[0];
    expect(submitted).not.toHaveProperty("expectedBoardVersion");
    expect(submitted).not.toHaveProperty("expectedPlacementVersion");
    oldRead.resolve({ key: key(boardId, 0), value: initialBoard });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "准备正式发布" }),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByText("准备发布")).not.toBeInTheDocument();
  });

  it("switches product copy immediately while preserving user-authored names and data", async () => {
    const api = apiFor();
    const operator = userEvent.setup();
    renderBoard(api, true);
    await screen.findByRole("heading", { name: "工作看板" });
    await operator.click(screen.getByRole("button", { name: "switch" }));
    expect(
      screen.getByRole("button", { name: "New board" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "工作看板" }),
    ).toBeInTheDocument();
    expect(screen.getByText("准备发布")).toBeInTheDocument();
    expect(api.boards.resolveHome).toHaveBeenCalledTimes(1);
  });
});
