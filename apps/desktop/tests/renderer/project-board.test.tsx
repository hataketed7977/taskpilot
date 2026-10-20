/** @vitest-environment jsdom */
import { cleanup, createEvent, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
          lifecycle: "OPEN",
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
    lifecycle: card.lifecycle,
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
    version: targetColumnId === board.columns[0].columnId ? board.version : board.version + 1,
    columns: board.columns.map((column) => ({
      ...column,
      cards:
        column.columnId === targetColumnId
          ? [{ ...card, title, workItemVersion: card.workItemVersion + 1, placementVersion: targetColumnId === board.columns[0].columnId ? card.placementVersion : card.placementVersion + 1 }]
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
function renderBoard(api: TaskPilotDesktopApi, withSwitch = false) {
  return render(
    <LocaleProvider initialLanguages={["zh-CN"]}>
      {withSwitch ? <LocaleSwitch /> : null}
      <BoardWorkspace
        api={api}
        userId={userId}
        workspaceId={workspaceId}
        project={project}
        onSettings={vi.fn()}
      />
    </LocaleProvider>,
  );
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
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

  it("edits content and Column atomically without a separate move control", async () => {
    const api = apiFor();
    const authoritative = editedBoard(initialBoard, "准备正式发布", doingId);
    vi.mocked(api.boards.editWorkItem).mockResolvedValue({
      key: key(boardId, 1),
      value: {
        workItem: toWorkItem(authoritative.columns[1].cards[0]),
        board: authoritative,
      },
    });
    const operator = userEvent.setup();
    renderBoard(api);
    await screen.findByRole("heading", { name: "工作看板" });

    expect(
      screen.queryByRole("button", { name: "移动准备发布" }),
    ).not.toBeInTheDocument();
    await operator.click(screen.getByRole("button", { name: "准备发布" }));
    const title = screen.getByLabelText("标题");
    await operator.clear(title);
    await operator.type(title, "准备正式发布");
    await operator.click(screen.getByRole("combobox", { name: "所在列表" }));
    await operator.click(screen.getByRole("option", { name: "处理中" }));
    await operator.click(screen.getByRole("button", { name: "保存更改" }));

    expect(api.boards.editWorkItem).toHaveBeenCalledTimes(1);
    expect(api.boards.editWorkItem).toHaveBeenCalledWith({
      workspaceId,
      projectId,
      boardId,
      workItemId,
      currentColumnId: todoId,
      targetColumnId: doingId,
      expectedBoardVersion: 3,
      expectedPlacementVersion: 0,
      expectedVersion: 0,
      title: "准备正式发布",
      description: "检查版本",
    });
    const movedCard = await screen.findByRole("button", { name: "准备正式发布" });
    expect(
      screen.getByRole("heading", { name: "处理中" }).closest(".board-column"),
    ).toContainElement(movedCard);
    expect(movedCard).toHaveFocus();
  });

  it("layers Select and Dialog Escape while restoring focus to the Column trigger", async () => {
    const api = apiFor();
    const operator = userEvent.setup();
    renderBoard(api);
    await screen.findByRole("heading", { name: "工作看板" });

    await operator.click(screen.getByRole("button", { name: "准备发布" }));
    const trigger = screen.getByRole("combobox", { name: "所在列表" });
    await operator.click(trigger);
    expect(screen.getByRole("option", { name: "处理中" })).toBeInTheDocument();

    await operator.keyboard("{Escape}");
    expect(screen.queryByRole("option", { name: "处理中" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "编辑工作项" })).toBeInTheDocument();
    expect(trigger).toHaveFocus();

    await operator.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "编辑工作项" })).not.toBeInTheDocument();
  });

  it("disables Column selection during an atomic edit and preserves the submitted target", async () => {
    const api = apiFor();
    const edit = deferred<never>();
    vi.mocked(api.boards.editWorkItem).mockReturnValue(edit.promise);
    const operator = userEvent.setup();
    renderBoard(api);
    await screen.findByRole("heading", { name: "工作看板" });

    await operator.click(screen.getByRole("button", { name: "准备发布" }));
    const trigger = screen.getByRole("combobox", { name: "所在列表" });
    await operator.click(trigger);
    await operator.click(screen.getByRole("option", { name: "处理中" }));
    await operator.click(screen.getByRole("button", { name: "保存更改" }));

    expect(trigger).toBeDisabled();
    await operator.click(trigger);
    expect(screen.queryByRole("option", { name: "待处理" })).not.toBeInTheDocument();
    expect(api.boards.editWorkItem).toHaveBeenCalledTimes(1);
    expect(api.boards.editWorkItem).toHaveBeenCalledWith(
      expect.objectContaining({ targetColumnId: doingId }),
    );

    edit.reject(new Error("conflict"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "看板已发生变化或暂时无法更新，请重新加载后再试。",
    );
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
      const slots = targetColumn.querySelectorAll<HTMLElement>(
        ".board-drop-slot",
      );
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

    const slots = sourceColumn.querySelectorAll<HTMLElement>(
      ".board-drop-slot",
    );
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
    await operator.click(screen.getByRole("combobox", { name: "所在列表" }));
    await operator.click(screen.getByRole("option", { name: "处理中" }));
    await operator.click(screen.getByRole("button", { name: "保存更改" }));
    await operator.click(screen.getByRole("tab", { name: "产品规划" }));
    expect(await screen.findByRole("heading", { name: "产品规划" })).toBeInTheDocument();

    edit.reject(new Error("conflict"));
    await waitFor(() => expect(screen.getByRole("heading", { name: "产品规划" })).toBeInTheDocument());
    expect(screen.queryByText("准备发布")).not.toBeInTheDocument();
    expect(screen.queryByText("未能移动准备发布，已恢复原布局。")).not.toBeInTheDocument();
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
    const title = screen.getByLabelText("标题");
    await operator.clear(title);
    await operator.type(title, "准备正式发布");
    await operator.click(screen.getByRole("button", { name: "保存更改" }));
    expect(await screen.findByText("准备正式发布")).toBeInTheDocument();
    const submitted = vi.mocked(api.boards.editWorkItem).mock.calls[0]?.[0];
    expect(submitted).not.toHaveProperty("expectedBoardVersion");
    expect(submitted).not.toHaveProperty("expectedPlacementVersion");
    oldRead.resolve({ key: key(boardId, 0), value: initialBoard });
    await waitFor(() =>
      expect(screen.getByText("准备正式发布")).toBeInTheDocument(),
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
