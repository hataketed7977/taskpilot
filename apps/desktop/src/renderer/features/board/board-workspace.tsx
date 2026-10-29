import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useTranslation } from "react-i18next";
import type {
  BoardColumnView,
  BoardHomeView,
  BoardResponseKey,
  BoardSummary,
  BoardView,
  CardView,
  ProjectView,
  TaskPilotDesktopApi,
} from "../../../shared/contracts";
import { useLocale } from "../../i18n/locale-state";
import {
  WorkItemDetailDialog,
  type WorkItemDetailTarget,
} from "../detail/work-item-detail-dialog";
import { BoardModal } from "./board-modal";

type BoardState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "delete-result-unknown" }
  | { kind: "delete-committed-refresh-failed" }
  | { kind: "ready"; home: BoardHomeView; key: BoardResponseKey };
type BoardDialog =
  | { kind: "create-board" }
  | { kind: "edit-board"; board: BoardView }
  | { kind: "delete-board"; board: BoardView }
  | { kind: "create-column"; board: BoardView }
  | { kind: "edit-column"; board: BoardView; column: BoardColumnView }
  | { kind: "create-card"; board: BoardView; column: BoardColumnView }
  | undefined;
type CodedError = { code?: string; recovery?: string };

type BoardWorkspaceProps = {
  api: TaskPilotDesktopApi;
  userId: string;
  workspaceId: string;
  project: ProjectView;
  onSettings(): void;
  onLeaveProject(): void;
};

export function BoardWorkspace({
  api,
  userId,
  workspaceId,
  project,
  onSettings,
  onLeaveProject,
}: BoardWorkspaceProps) {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const [state, setState] = useState<BoardState>({ kind: "loading" });
  const [dialog, setDialog] = useState<BoardDialog>();
  const [workItemDetail, setWorkItemDetail] = useState<WorkItemDetailTarget>();
  const [announcement, setAnnouncement] = useState("");
  const [pendingMove, setPendingMove] = useState<string>();
  const [moveFailure, setMoveFailure] = useState<string>();
  const [boardNotice, setBoardNotice] = useState<string>();
  const [boardActionsOpen, setBoardActionsOpen] = useState(false);
  const boardActionsTrigger = useRef<HTMLButtonElement>(null);
  const boardDeleteAction = useRef<HTMLButtonElement>(null);
  const focusWorkItemId = useRef<string | undefined>(undefined);
  const requestSequence = useRef(0);
  const selectionSequence = useRef(0);
  const selectedBoardId = useRef<string | undefined>(undefined);
  const boardGenerations = useRef(new Map<string, number>());

  const accepts = useCallback(
    (key: BoardResponseKey, boardId?: string) => {
      if (
        key.userId !== userId ||
        key.workspaceId !== workspaceId ||
        key.projectId !== project.projectId
      )
        return false;
      if (boardId && key.boardId !== boardId) return false;
      if (key.boardId && key.boardGeneration !== undefined) {
        const accepted = boardGenerations.current.get(key.boardId) ?? -1;
        if (key.boardGeneration < accepted) return false;
        boardGenerations.current.set(key.boardId, key.boardGeneration);
      }
      return true;
    },
    [project.projectId, userId, workspaceId],
  );

  const getSelection = useCallback(() => selectionSequence.current, []);

  useEffect(() => {
    if (boardActionsOpen) boardDeleteAction.current?.focus();
  }, [boardActionsOpen]);

  const clearBoardTransientState = useCallback(() => {
    setDialog(undefined);
    setWorkItemDetail(undefined);
    setAnnouncement("");
    setPendingMove(undefined);
    setMoveFailure(undefined);
    setBoardNotice(undefined);
    setBoardActionsOpen(false);
    focusWorkItemId.current = undefined;
  }, []);

  const resolve = useCallback(async () => {
    const request = ++requestSequence.current;
    const selection = ++selectionSequence.current;
    clearBoardTransientState();
    setState({ kind: "loading" });
    try {
      const result = await api.boards.resolveHome({
        workspaceId,
        projectId: project.projectId,
      });
      if (
        request !== requestSequence.current ||
        selection !== selectionSequence.current ||
        !accepts(result.key, result.value.currentBoard?.boardId)
      )
        return;
      selectedBoardId.current = result.value.currentBoard?.boardId;
      setState({ kind: "ready", home: result.value, key: result.key });
    } catch (error) {
      if (
        request === requestSequence.current &&
        (error as CodedError).recovery !== "SIGN_IN"
      )
        setState({ kind: "error" });
    }
  }, [
    accepts,
    api.boards,
    clearBoardTransientState,
    project.projectId,
    workspaceId,
  ]);

  useEffect(() => {
    void Promise.resolve().then(resolve);
    return () => {
      requestSequence.current += 1;
      selectionSequence.current += 1;
    };
  }, [resolve]);

  const commitBoard = useCallback(
    (
      board: BoardView,
      key: BoardResponseKey,
      add = false,
      selection = selectionSequence.current,
      allowSelectionChange = false,
    ) => {
      if (selection !== selectionSequence.current) return false;
      if (!allowSelectionChange && selectedBoardId.current !== board.boardId)
        return false;
      if (!accepts(key, board.boardId)) return false;
      const summary = toSummary(board);
      selectedBoardId.current = board.boardId;
      if (
        workItemDetail?.boardId === board.boardId &&
        !findCard(board, workItemDetail.workItemId)
      ) {
        setWorkItemDetail(undefined);
        requestAnimationFrame(() => {
          const fallback =
            document.querySelector<HTMLElement>(
              '.board-switcher [role="tab"][aria-selected="true"]',
            ) ?? document.querySelector<HTMLElement>(".board-add-card");
          fallback?.focus();
        });
      }
      setState((previous) => {
        if (previous.kind !== "ready") return previous;
        const exists = previous.home.boards.some(
          (item) => item.boardId === board.boardId,
        );
        return {
          kind: "ready",
          key,
          home: {
            boards: exists
              ? previous.home.boards.map((item) =>
                  item.boardId === board.boardId ? summary : item,
                )
              : add
                ? [...previous.home.boards, summary]
                : previous.home.boards,
            currentBoard: board,
          },
        };
      });
      return true;
    },
    [accepts, workItemDetail],
  );

  const commitHome = useCallback(
    (home: BoardHomeView, key: BoardResponseKey, selection: number) => {
      if (selection !== selectionSequence.current) return false;
      if (!accepts(key, home.currentBoard?.boardId)) return false;
      selectedBoardId.current = home.currentBoard?.boardId;
      if (home.currentBoard) {
        const generation = key.boardGeneration;
        if (generation !== undefined)
          boardGenerations.current.set(home.currentBoard.boardId, generation);
      }
      setState({ kind: "ready", home, key });
      return true;
    },
    [accepts],
  );

  const openBoard = async (board: BoardSummary) => {
    const request = ++requestSequence.current;
    const selection = ++selectionSequence.current;
    clearBoardTransientState();
    try {
      const result = await api.boards.open({
        workspaceId,
        projectId: project.projectId,
        boardId: board.boardId,
      });
      if (
        request !== requestSequence.current ||
        selection !== selectionSequence.current
      )
        return;
      commitBoard(result.value, result.key, false, selection, true);
    } catch (error) {
      if (
        request === requestSequence.current &&
        selection === selectionSequence.current &&
        (error as CodedError).recovery !== "SIGN_IN"
      )
        setState({ kind: "error" });
    }
  };

  const moveCard = useCallback(
    async (
      card: CardView,
      sourceColumnId: string,
      targetColumnId: string,
      beforeWorkItemId?: string,
    ): Promise<boolean> => {
      if (state.kind !== "ready" || !state.home.currentBoard || pendingMove)
        return false;
      const board = state.home.currentBoard;
      if (
        isOriginalCardPosition(
          board,
          card.workItemId,
          sourceColumnId,
          targetColumnId,
          beforeWorkItemId,
        )
      )
        return true;
      const snapshot = board;
      const selection = selectionSequence.current;
      const optimistic = previewMove(
        board,
        card.workItemId,
        targetColumnId,
        beforeWorkItemId,
      );
      setPendingMove(card.workItemId);
      setMoveFailure(undefined);
      setAnnouncement("");
      setState((previous) =>
        previous.kind === "ready"
          ? {
              ...previous,
              home: { ...previous.home, currentBoard: optimistic },
            }
          : previous,
      );
      try {
        const result = await api.boards.moveCard({
          workspaceId,
          projectId: project.projectId,
          boardId: board.boardId,
          workItemId: card.workItemId,
          expectedBoardVersion: board.version,
          expectedPlacementVersion: card.placementVersion,
          targetColumnId,
          ...(beforeWorkItemId ? { beforeWorkItemId } : {}),
        });
        if (
          selection !== selectionSequence.current ||
          selectedBoardId.current !== board.boardId
        )
          return false;
        focusWorkItemId.current = card.workItemId;
        if (!commitBoard(result.value, result.key, false, selection)) {
          focusWorkItemId.current = undefined;
          return false;
        }
        setAnnouncement(t("board.moveSucceeded", { title: card.title }));
        return true;
      } catch (error) {
        if (
          selection === selectionSequence.current &&
          selectedBoardId.current === board.boardId &&
          (error as CodedError).recovery !== "SIGN_IN"
        ) {
          setState((previous) =>
            previous.kind === "ready" &&
            previous.home.currentBoard?.boardId === board.boardId
              ? {
                  ...previous,
                  home: { ...previous.home, currentBoard: snapshot },
                }
              : previous,
          );
          setAnnouncement(t("board.moveFailed", { title: card.title }));
          setMoveFailure(card.title);
        }
        return false;
      } finally {
        if (
          selection === selectionSequence.current &&
          selectedBoardId.current === board.boardId
        )
          setPendingMove(undefined);
      }
    },
    [
      api.boards,
      commitBoard,
      pendingMove,
      project.projectId,
      state,
      t,
      workspaceId,
    ],
  );

  if (state.kind === "loading") {
    return (
      <div className="board-loading" aria-busy="true">
        <div className="skeleton skeleton--title" />
        <div className="board-loading__columns">
          <span />
          <span />
          <span />
        </div>
        <p className="visually-hidden" role="status">
          {t("board.loading")}
        </p>
      </div>
    );
  }
  if (
    state.kind === "delete-result-unknown" ||
    state.kind === "delete-committed-refresh-failed"
  ) {
    const unknown = state.kind === "delete-result-unknown";
    return (
      <div className="board-state board-state--critical" role="alert">
        <BoardGlyph />
        <h2>
          {t(
            unknown
              ? "board.delete.resultUnknownTitle"
              : "board.delete.committedRefreshTitle",
          )}
        </h2>
        <p>
          {t(
            unknown
              ? "board.delete.resultUnknownDetail"
              : "board.delete.committedRefreshDetail",
          )}
        </p>
        <div className="board-state__actions">
          <button
            type="button"
            className="project-button project-button--primary"
            onClick={() => void resolve()}
          >
            {t(
              unknown
                ? "board.delete.retryReconciliation"
                : "board.delete.retryRefresh",
            )}
          </button>
          {unknown ? (
            <button
              type="button"
              className="project-button"
              onClick={onLeaveProject}
            >
              {t("board.delete.leaveProject")}
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div className="board-state board-state--error" role="alert">
        <BoardGlyph />
        <h2>{t("board.loadErrorTitle")}</h2>
        <p>{t("board.loadErrorDetail")}</p>
        <button
          type="button"
          className="project-button project-button--primary"
          onClick={() => void resolve()}
        >
          {t("common.retry")}
        </button>
      </div>
    );
  }

  const board = state.home.currentBoard;
  return (
    <div className="board-surface">
      <header className="board-context">
        <div className="board-context__project">
          <span>{t("project.personalSpace")}</span>
          <h1>{project.name}</h1>
          {project.description ? <p>{project.description}</p> : null}
        </div>
        <button
          type="button"
          className="project-button board-project-settings"
          onClick={onSettings}
        >
          <SettingsIcon />
          {t("project.settingsAction")}
        </button>
      </header>
      <div className="board-toolbar">
        <div
          className="board-switcher"
          role="tablist"
          aria-label={t("board.selector")}
        >
          {state.home.boards.map((item, index) => (
            <button
              key={item.boardId}
              type="button"
              role="tab"
              aria-selected={item.boardId === board?.boardId}
              tabIndex={item.boardId === board?.boardId ? 0 : -1}
              className={item.boardId === board?.boardId ? "is-current" : ""}
              onKeyDown={(event) => activateAdjacentTab(event, index)}
              onClick={() => void openBoard(item)}
            >
              {item.name}
            </button>
          ))}
        </div>
        <div className="board-toolbar__actions">
          {board ? (
            <>
              <button
                type="button"
                className="icon-action"
                aria-label={t("board.editAction")}
                title={t("board.editAction")}
                onClick={() => setDialog({ kind: "edit-board", board })}
              >
                <EditIcon />
              </button>
              <div className="board-actions">
                <button
                  ref={boardActionsTrigger}
                  type="button"
                  className="icon-action board-actions__trigger"
                  aria-label={t("board.actions")}
                  title={t("board.actions")}
                  aria-haspopup="menu"
                  aria-expanded={boardActionsOpen}
                  onClick={() => setBoardActionsOpen((open) => !open)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    setBoardActionsOpen((open) => !open);
                  }}
                >
                  <MoreIcon />
                </button>
                {boardActionsOpen ? (
                  <div className="board-actions__menu" role="menu">
                    <button
                      ref={boardDeleteAction}
                      type="button"
                      role="menuitem"
                      className="board-actions__danger"
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          event.preventDefault();
                          setBoardActionsOpen(false);
                          boardActionsTrigger.current?.focus();
                          return;
                        }
                        if (event.key !== "Enter" && event.key !== " ") return;
                        event.preventDefault();
                        boardActionsTrigger.current?.focus();
                        setBoardActionsOpen(false);
                        setDialog({ kind: "delete-board", board });
                      }}
                      onClick={() => {
                        boardActionsTrigger.current?.focus();
                        setBoardActionsOpen(false);
                        setDialog({ kind: "delete-board", board });
                      }}
                    >
                      {t("board.delete.action")}
                    </button>
                  </div>
                ) : null}
              </div>
            </>
          ) : null}
          {board ? (
            <button
              type="button"
              className="project-button project-button--primary"
              aria-label={t("board.createAction")}
              onClick={() => setDialog({ kind: "create-board" })}
            >
              + {t("board.createAction")}
            </button>
          ) : null}
        </div>
      </div>
      {boardNotice ? (
        <div className="board-notice" role="alert">
          {t(boardNotice)}
        </div>
      ) : null}
      {moveFailure ? (
        <div className="board-move-error" role="alert">
          <span>{t("board.moveFailed", { title: moveFailure })}</span>
          <button
            type="button"
            className="project-button"
            onClick={() => {
              setMoveFailure(undefined);
              void resolve();
            }}
          >
            {t("board.reload")}
          </button>
        </div>
      ) : null}
      {board ? (
        <BoardCanvas
          key={board.boardId}
          board={board}
          pendingMove={pendingMove}
          focusWorkItemId={focusWorkItemId}
          onDialog={setDialog}
          onOpenWorkItem={(columnId, workItemId) =>
            setWorkItemDetail({ boardId: board.boardId, columnId, workItemId })
          }
          onMove={moveCard}
          getSelection={getSelection}
          onBoard={commitBoard}
          api={api}
          workspaceId={workspaceId}
          projectId={project.projectId}
        />
      ) : (
        <div className="board-state">
          <BoardGlyph />
          <h2>{t("board.emptyTitle")}</h2>
          <p>{t("board.emptyDetail")}</p>
          <button
            type="button"
            className="project-button project-button--primary"
            onClick={() => setDialog({ kind: "create-board" })}
          >
            {t("board.createAction")}
          </button>
        </div>
      )}
      <p className="visually-hidden" aria-live="polite">
        {announcement}
      </p>
      {dialog?.kind === "delete-board" ? (
        <DeleteBoardDialog
          board={dialog.board}
          api={api}
          workspaceId={workspaceId}
          projectId={project.projectId}
          getSelection={getSelection}
          onClose={() => setDialog(undefined)}
          onHome={(home, key, selection, outcome) => {
            if (!commitHome(home, key, selection)) return;
            setDialog(undefined);
            if (outcome === "notDeleted")
              setBoardNotice("board.delete.notDeleted");
          }}
          onResultUnknown={() => {
            setDialog(undefined);
            setState({ kind: "delete-result-unknown" });
          }}
          onCommittedRefreshFailure={() => {
            setDialog(undefined);
            setState({ kind: "delete-committed-refresh-failed" });
          }}
        />
      ) : dialog ? (
        <BoardDialogView
          dialog={dialog}
          api={api}
          workspaceId={workspaceId}
          projectId={project.projectId}
          locale={locale}
          getSelection={getSelection}
          onClose={() => setDialog(undefined)}
          onBoard={(next, key, add, selection) => {
            if (commitBoard(next, key, add, selection, add))
              setDialog(undefined);
          }}
        />
      ) : workItemDetail &&
        board &&
        workItemDetail.boardId === board.boardId ? (
        <WorkItemDetailDialog
          target={workItemDetail}
          board={board}
          api={api}
          workspaceId={workspaceId}
          projectId={project.projectId}
          getSelection={getSelection}
          accepts={accepts}
          onBoard={(next, key, selection) =>
            commitBoard(next, key, false, selection)
          }
          onClose={() => {
            const card = [...document.querySelectorAll<HTMLElement>("[data-work-item-id]")]
              .find(
                (element) =>
                  element.dataset.workItemId === workItemDetail.workItemId,
              )
              ?.querySelector<HTMLElement>("button");
            const fallback =
              document.querySelector<HTMLElement>(
                '.board-switcher [role="tab"][aria-selected="true"]',
              ) ?? document.querySelector<HTMLElement>(".board-add-card");
            (card ?? fallback)?.focus();
            setWorkItemDetail(undefined);
          }}
        />
      ) : null}
    </div>
  );
}

function BoardCanvas({
  board,
  pendingMove,
  focusWorkItemId,
  getSelection,
  onDialog,
  onOpenWorkItem,
  onMove,
  onBoard,
  api,
  workspaceId,
  projectId,
}: {
  board: BoardView;
  pendingMove?: string;
  focusWorkItemId: { current: string | undefined };
  getSelection(): number;
  onDialog(dialog: BoardDialog): void;
  onOpenWorkItem(columnId: string, workItemId: string): void;
  onMove(
    card: CardView,
    sourceColumnId: string,
    targetColumnId: string,
    beforeWorkItemId?: string,
  ): Promise<boolean>;
  onBoard(
    board: BoardView,
    key: BoardResponseKey,
    add?: boolean,
    selection?: number,
  ): boolean;
  api: TaskPilotDesktopApi;
  workspaceId: string;
  projectId: string;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState("");
  const [draggedWorkItemId, setDraggedWorkItemId] = useState<string>();
  const [dropTarget, setDropTarget] = useState<{
    columnId: string;
    beforeWorkItemId?: string;
  }>();
  const [settlingWorkItemId, setSettlingWorkItemId] = useState<string>();
  const canvas = useRef<HTMLElement>(null);
  const dragStartFrame = useRef<number | undefined>(undefined);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const previousCardPositions = useRef<Map<string, DOMRect> | undefined>(
    undefined,
  );
  const layoutAnimations = useRef(new Map<string, Animation>());
  const activeDropTarget = useRef<typeof dropTarget>(undefined);

  useEffect(
    () => () => {
      if (dragStartFrame.current !== undefined)
        cancelAnimationFrame(dragStartFrame.current);
      if (settleTimer.current) clearTimeout(settleTimer.current);
      for (const animation of layoutAnimations.current.values())
        animation.cancel();
      layoutAnimations.current.clear();
    },
    [],
  );

  useLayoutEffect(() => {
    const positions = previousCardPositions.current;
    previousCardPositions.current = undefined;
    if (!positions || prefersReducedMotion()) return;

    for (const element of boardCardsIn(canvas.current)) {
      const workItemId = element.dataset.workItemId;
      const previous = workItemId ? positions.get(workItemId) : undefined;
      if (!workItemId || !previous || workItemId === draggedWorkItemId)
        continue;

      layoutAnimations.current.get(workItemId)?.cancel();
      const current = element.getBoundingClientRect();
      const deltaX = previous.left - current.left;
      const deltaY = previous.top - current.top;
      if (Math.abs(deltaX) < 0.5 && Math.abs(deltaY) < 0.5) continue;
      if (typeof element.animate !== "function") continue;

      const animation = element.animate(
        [
          { transform: `translate3d(${deltaX}px, ${deltaY}px, 0)` },
          { transform: "translate3d(0, 0, 0)" },
        ],
        {
          duration: 180,
          easing: "cubic-bezier(0.22, 1, 0.36, 1)",
        },
      );
      layoutAnimations.current.set(workItemId, animation);
      animation.addEventListener(
        "finish",
        () => {
          if (layoutAnimations.current.get(workItemId) === animation)
            layoutAnimations.current.delete(workItemId);
        },
        { once: true },
      );
      animation.addEventListener(
        "cancel",
        () => {
          if (layoutAnimations.current.get(workItemId) === animation)
            layoutAnimations.current.delete(workItemId);
        },
        { once: true },
      );
    }
  }, [dropTarget, draggedWorkItemId]);

  const captureCardPositions = () => {
    if (prefersReducedMotion()) return;
    previousCardPositions.current = new Map(
      boardCardsIn(canvas.current).flatMap((element) => {
        const workItemId = element.dataset.workItemId;
        return workItemId
          ? ([[workItemId, element.getBoundingClientRect()]] as const)
          : [];
      }),
    );
  };
  const changeDropTarget = (next: typeof dropTarget) => {
    const active = activeDropTarget.current;
    if (
      active?.columnId === next?.columnId &&
      active?.beforeWorkItemId === next?.beforeWorkItemId
    )
      return;
    captureCardPositions();
    activeDropTarget.current = next;
    setDropTarget(next);
  };
  const clearDragState = () => {
    if (dragStartFrame.current !== undefined) {
      cancelAnimationFrame(dragStartFrame.current);
      dragStartFrame.current = undefined;
    }
    setDraggedWorkItemId(undefined);
    changeDropTarget(undefined);
  };
  const showSettled = (workItemId: string) => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
    setSettlingWorkItemId(workItemId);
    settleTimer.current = setTimeout(() => {
      setSettlingWorkItemId(undefined);
      settleTimer.current = undefined;
    }, 200);
  };
  const drop = async (
    event: DragEvent,
    targetColumnId: string,
    beforeWorkItemId?: string,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const payload = readDrag(event);
    clearDragState();
    if (!payload) return;
    if (
      await onMove(
        payload.card,
        payload.sourceColumnId,
        targetColumnId,
        beforeWorkItemId,
      )
    )
      showSettled(payload.card.workItemId);
  };
  const mutate = async (
    identity: string,
    operation: () => Promise<{ value: BoardView; key: BoardResponseKey }>,
  ) => {
    if (busy) return;
    const selection = getSelection();
    setBusy(identity);
    setError("");
    try {
      const result = await operation();
      onBoard(result.value, result.key, false, selection);
    } catch {
      if (selection === getSelection()) setError(t("board.mutationError"));
    } finally {
      if (selection === getSelection()) setBusy(undefined);
    }
  };
  const reorder = (columnId: string, direction: -1 | 1) => {
    const index = board.columns.findIndex(
      (column) => column.columnId === columnId,
    );
    const target = index + direction;
    if (index < 0 || target < 0 || target >= board.columns.length) return;
    const ids = board.columns.map((column) => column.columnId);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    void mutate(`reorder-${columnId}`, () =>
      api.boards.reorderColumns({
        workspaceId,
        projectId,
        boardId: board.boardId,
        expectedBoardVersion: board.version,
        columnIds: ids,
      }),
    );
  };
  const remove = (column: BoardColumnView) => {
    void mutate(`delete-${column.columnId}`, async () => {
      await api.boards.deleteColumn({
        workspaceId,
        projectId,
        boardId: board.boardId,
        columnId: column.columnId,
        expectedBoardVersion: board.version,
        expectedColumnVersion: column.version,
      });
      return api.boards.open({
        workspaceId,
        projectId,
        boardId: board.boardId,
      });
    });
  };

  return (
    <section
      ref={canvas}
      className="board-canvas"
      aria-label={t("board.canvasLabel", { name: board.name })}
    >
      <h2 className="visually-hidden">{board.name}</h2>
      <div className="board-columns">
        {board.columns.map((column, index) => {
          const isDropTarget = dropTarget?.columnId === column.columnId;
          const dropsAtEnd = isDropTarget && !dropTarget.beforeWorkItemId;
          return (
            <article
              key={column.columnId}
              className={`board-column${isDropTarget ? " is-drop-target" : ""}`}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                changeDropTarget({
                  columnId: column.columnId,
                  beforeWorkItemId: resolveDropAnchor(
                    event.currentTarget,
                    event.clientY,
                  ),
                });
              }}
              onDrop={(event) =>
                void drop(
                  event,
                  column.columnId,
                  resolveDropAnchor(event.currentTarget, event.clientY),
                )
              }
            >
              <header className="board-column__header">
                <div>
                  <h2>{column.name}</h2>
                  <span
                    aria-label={t("board.cardCount", {
                      count: column.cards.length,
                    })}
                  >
                    {column.cards.length}
                  </span>
                </div>
                <div className="board-column__actions">
                  <button
                    type="button"
                    className="icon-action"
                    disabled={busy !== undefined || index === 0}
                    aria-label={t("board.moveColumnLeft", {
                      name: column.name,
                    })}
                    onClick={() => reorder(column.columnId, -1)}
                  >
                    ←
                  </button>
                  <button
                    type="button"
                    className="icon-action"
                    disabled={
                      busy !== undefined || index === board.columns.length - 1
                    }
                    aria-label={t("board.moveColumnRight", {
                      name: column.name,
                    })}
                    onClick={() => reorder(column.columnId, 1)}
                  >
                    →
                  </button>
                  <button
                    type="button"
                    className="icon-action"
                    disabled={busy !== undefined}
                    aria-label={t("board.editColumn", { name: column.name })}
                    onClick={() =>
                      onDialog({ kind: "edit-column", board, column })
                    }
                  >
                    <EditIcon />
                  </button>
                  <button
                    type="button"
                    className="icon-action"
                    disabled={
                      busy !== undefined ||
                      board.columns.length === 1 ||
                      column.cards.length > 0
                    }
                    aria-label={t("board.deleteColumn", { name: column.name })}
                    onClick={() => remove(column)}
                  >
                    ×
                  </button>
                </div>
              </header>
              <div className="board-card-list">
                {column.cards.map((card) => {
                  const isDropBefore =
                    isDropTarget &&
                    dropTarget.beforeWorkItemId === card.workItemId;
                  const classes = [
                    "board-card",
                    pendingMove === card.workItemId ? "is-moving" : "",
                    draggedWorkItemId === card.workItemId ? "is-dragging" : "",
                    settlingWorkItemId === card.workItemId ? "is-settling" : "",
                  ]
                    .filter(Boolean)
                    .join(" ");
                  return (
                    <Fragment key={card.workItemId}>
                      {isDropBefore ? (
                        <div className="board-drop-slot" aria-hidden="true" />
                      ) : null}
                      <div
                        data-work-item-id={card.workItemId}
                        className={classes}
                        draggable={pendingMove === undefined}
                        onDragStart={(event) => {
                          writeDrag(event, card, column.columnId);
                          captureCardPositions();
                          const sourceIndex = column.cards.findIndex(
                            (item) => item.workItemId === card.workItemId,
                          );
                          const sourceTarget = {
                            columnId: column.columnId,
                            beforeWorkItemId:
                              column.cards[sourceIndex + 1]?.workItemId,
                          };
                          dragStartFrame.current = requestAnimationFrame(() => {
                            dragStartFrame.current = undefined;
                            setDraggedWorkItemId(card.workItemId);
                            if (!activeDropTarget.current) {
                              activeDropTarget.current = sourceTarget;
                              setDropTarget(sourceTarget);
                            }
                          });
                        }}
                        onDragEnd={(event) => {
                          discardDrag(event);
                          clearDragState();
                        }}
                      >
                        <button
                          ref={(element) => {
                            if (
                              element &&
                              focusWorkItemId.current === card.workItemId
                            ) {
                              focusWorkItemId.current = undefined;
                              element.focus();
                            }
                          }}
                          type="button"
                          className="board-card__body"
                          aria-label={card.title}
                          onClick={() =>
                            onOpenWorkItem(column.columnId, card.workItemId)
                          }
                        >
                          <strong>{card.title}</strong>
                          {card.description ? (
                            <span>{card.description}</span>
                          ) : null}
                        </button>
                      </div>
                    </Fragment>
                  );
                })}
                {dropsAtEnd ? (
                  <div className="board-drop-slot" aria-hidden="true" />
                ) : null}
                {column.cards.length === 0 && !dropsAtEnd ? (
                  <p className="board-column__empty">
                    {t("board.emptyColumn")}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                className="board-add-card"
                aria-label={t("board.addWorkItem")}
                onClick={() => onDialog({ kind: "create-card", board, column })}
              >
                + {t("board.addWorkItem")}
              </button>
            </article>
          );
        })}
        <button
          type="button"
          className="board-add-column"
          aria-label={t("board.addColumn")}
          onClick={() => onDialog({ kind: "create-column", board })}
        >
          + {t("board.addColumn")}
        </button>
      </div>
      {error ? (
        <p className="board-inline-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function BoardDialogView({
  dialog,
  api,
  workspaceId,
  projectId,
  locale,
  getSelection,
  onClose,
  onBoard,
}: {
  dialog: Exclude<BoardDialog, undefined | { kind: "delete-board" }>;
  api: TaskPilotDesktopApi;
  workspaceId: string;
  projectId: string;
  locale: "zh-CN" | "en";
  getSelection(): number;
  onClose(): void;
  onBoard(
    board: BoardView,
    key: BoardResponseKey,
    add: boolean | undefined,
    selection: number,
  ): void;
}) {
  const board = "board" in dialog ? dialog.board : undefined;
  const column = "column" in dialog ? dialog.column : undefined;
  return (
    <EntityDialog
      kind={dialog.kind}
      initialName={
        dialog.kind === "edit-board"
          ? dialog.board.name
          : dialog.kind === "edit-column"
            ? dialog.column.name
            : ""
      }
      initialDescription={
        dialog.kind === "edit-board" ? dialog.board.description : ""
      }
      onClose={onClose}
      onSubmit={async (name, description, requestId) => {
        const selection = getSelection();
        if (dialog.kind === "create-board") {
          const result = await api.boards.create({
            workspaceId,
            projectId,
            requestId,
            name,
            description,
            locale,
          });
          onBoard(result.value, result.key, true, selection);
          return;
        }
        if (dialog.kind === "edit-board") {
          const result = await api.boards.edit({
            workspaceId,
            projectId,
            boardId: dialog.board.boardId,
            expectedVersion: dialog.board.version,
            name,
            description,
          });
          onBoard(result.value, result.key, false, selection);
          return;
        }
        if (dialog.kind === "create-column" && board) {
          const result = await api.boards.createColumn({
            workspaceId,
            projectId,
            boardId: board.boardId,
            requestId,
            expectedBoardVersion: board.version,
            name,
          });
          onBoard(result.value, result.key, false, selection);
          return;
        }
        if (dialog.kind === "edit-column" && board && column) {
          const result = await api.boards.editColumn({
            workspaceId,
            projectId,
            boardId: board.boardId,
            columnId: column.columnId,
            expectedBoardVersion: board.version,
            expectedColumnVersion: column.version,
            name,
          });
          onBoard(result.value, result.key, false, selection);
          return;
        }
        if (dialog.kind === "create-card" && board && column) {
          const result = await api.boards.createWorkItem({
            workspaceId,
            projectId,
            boardId: board.boardId,
            columnId: column.columnId,
            requestId,
            expectedBoardVersion: board.version,
            title: name,
            description,
          });
          onBoard(result.value.board, result.key, false, selection);
          return;
        }
      }}
    />
  );
}

function DeleteBoardDialog({
  board,
  api,
  workspaceId,
  projectId,
  getSelection,
  onClose,
  onHome,
  onResultUnknown,
  onCommittedRefreshFailure,
}: {
  board: BoardView;
  api: TaskPilotDesktopApi;
  workspaceId: string;
  projectId: string;
  getSelection(): number;
  onClose(): void;
  onHome(
    home: BoardHomeView,
    key: BoardResponseKey,
    selection: number,
    outcome: "deleted" | "notDeleted",
  ): void;
  onResultUnknown(): void;
  onCommittedRefreshFailure(): void;
}) {
  const { t } = useTranslation();
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false);
  const [discardPrompt, setDiscardPrompt] = useState(false);
  const [errorCode, setErrorCode] = useState<string>();
  const dirty = confirmation.length > 0;
  const requestClose = () => {
    if (pending) return;
    if (dirty) setDiscardPrompt(true);
    else onClose();
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending || confirmation !== board.name) return;
    const selection = getSelection();
    setPending(true);
    setErrorCode(undefined);
    try {
      const result = await api.boards.permanentlyDelete({
        workspaceId,
        projectId,
        boardId: board.boardId,
        expectedVersion: board.version,
        confirmationName: confirmation,
      });
      onHome(result.value.home, result.key, selection, result.value.outcome);
    } catch (error) {
      const code = (error as CodedError).code;
      if (code === "BOARD_DELETE_RESULT_UNKNOWN") {
        onResultUnknown();
        return;
      }
      if (code === "BOARD_DELETE_COMMITTED_REFRESH_FAILED") {
        onCommittedRefreshFailure();
        return;
      }
      setErrorCode(code ?? "BOARD_DELETE_FAILED");
    } finally {
      setPending(false);
    }
  };
  if (discardPrompt) {
    return (
      <BoardModal
        title={t("board.delete.discardTitle")}
        pending={false}
        danger
        onClose={() => setDiscardPrompt(false)}
      >
        <p className="dialog-copy">{t("board.delete.discardDetail")}</p>
        <div className="dialog-actions">
          <button
            type="button"
            className="project-button"
            autoFocus
            onClick={() => setDiscardPrompt(false)}
          >
            {t("board.delete.continueConfirmation")}
          </button>
          <button
            type="button"
            className="project-button project-button--danger"
            onClick={onClose}
          >
            {t("board.delete.discardAndClose")}
          </button>
        </div>
      </BoardModal>
    );
  }
  return (
    <BoardModal
      title={t("board.delete.title", { name: board.name })}
      pending={pending}
      danger
      onClose={requestClose}
    >
      <div className="board-delete-copy">
        <p>{t("board.delete.irreversible")}</p>
        <ul>
          <li>{t("board.delete.emptyOnly")}</li>
          <li>{t("board.delete.preserveWorkItems")}</li>
        </ul>
      </div>
      <form
        aria-describedby={errorCode ? "board-delete-error" : undefined}
        onSubmit={(event) => void submit(event)}
      >
        <label className="project-field">
          <span>{t("board.delete.confirmation", { name: board.name })}</span>
          <input
            name="boardNameConfirmation"
            autoComplete="off"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
          />
        </label>
        <div className="dialog-actions">
          <button
            type="button"
            className="project-button"
            disabled={pending}
            onClick={requestClose}
          >
            {t("project.cancel")}
          </button>
          <button
            type="submit"
            className="project-button project-button--danger"
            disabled={pending || confirmation !== board.name}
          >
            {pending ? t("board.delete.deleting") : t("board.delete.submit")}
          </button>
        </div>
        {errorCode ? (
          <p id="board-delete-error" className="project-error" role="alert">
            {t(`board.delete.errors.${errorCode}`, {
              defaultValue: t("board.delete.errors.BOARD_DELETE_FAILED"),
            })}
          </p>
        ) : null}
      </form>
    </BoardModal>
  );
}

function EntityDialog({
  kind,
  initialName,
  initialDescription,
  onClose,
  onSubmit,
}: {
  kind: Exclude<BoardDialog, undefined | { kind: "delete-board" }>["kind"];
  initialName: string;
  initialDescription: string;
  onClose(): void;
  onSubmit(
    name: string,
    description: string,
    requestId: string,
    targetColumnId?: string,
  ): Promise<void>;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const request = useRef<{ fingerprint: string; id: string } | undefined>(
    undefined,
  );
  const supportsDescription =
    kind === "create-board" || kind === "edit-board" || kind === "create-card";
  const normalizedName = normalize(name);
  const normalizedDescription = normalize(description);
  const limits =
    kind === "create-column" || kind === "edit-column"
      ? { name: 80, description: 0 }
      : kind === "create-card"
        ? { name: 300, description: 10_000 }
        : { name: 120, description: 2_000 };
  const invalid =
    !normalizedName ||
    [...normalizedName].length > limits.name ||
    [...normalizedDescription].length > limits.description;
  const nameField =
    kind === "create-column" || kind === "edit-column"
      ? "column-name"
      : kind === "create-card"
        ? "work-item-title"
        : "board-name";
  const descriptionField =
    kind === "create-card" ? "work-item-description" : "board-description";
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (invalid || pending) return;
    const fingerprint = JSON.stringify([normalizedName, normalizedDescription]);
    if (request.current?.fingerprint !== fingerprint)
      request.current = { fingerprint, id: crypto.randomUUID() };
    setPending(true);
    setError(false);
    try {
      await onSubmit(normalizedName, normalizedDescription, request.current.id);
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  };
  return (
    <BoardModal
      title={t(`board.dialog.${kind}.title`)}
      pending={pending}
      onClose={onClose}
    >
      <form onSubmit={(event) => void submit(event)}>
        <label className="project-field">
          <span>{t(`board.dialog.${kind}.name`)}</span>
          <input
            name={nameField}
            value={name}
            autoComplete="off"
            required
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        {supportsDescription ? (
          <label className="project-field">
            <span>{t("board.description")}</span>
            <textarea
              name={descriptionField}
              value={description}
              autoComplete="off"
              rows={4}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
        ) : null}
        <div className="dialog-actions">
          <button
            type="button"
            className="project-button"
            disabled={pending}
            onClick={onClose}
          >
            {t("project.cancel")}
          </button>
          <button
            type="submit"
            className="project-button project-button--primary"
            disabled={pending || invalid}
          >
            {pending ? t("board.saving") : t("project.save")}
          </button>
        </div>
        {error ? (
          <p className="project-error" role="alert">
            {t("board.mutationError")}
          </p>
        ) : null}
      </form>
    </BoardModal>
  );
}

function activateAdjacentTab(
  event: ReactKeyboardEvent<HTMLButtonElement>,
  index: number,
) {
  const tabs = [
    ...(event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
      '[role="tab"]',
    ) ?? []),
  ];
  if (tabs.length === 0) return;
  const target =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? tabs.length - 1
        : event.key === "ArrowLeft"
          ? (index - 1 + tabs.length) % tabs.length
          : event.key === "ArrowRight"
            ? (index + 1) % tabs.length
            : undefined;
  if (target === undefined) return;
  event.preventDefault();
  tabs[target]?.focus();
  tabs[target]?.click();
}

function boardCardsIn(root: HTMLElement | null) {
  return root
    ? [...root.querySelectorAll<HTMLElement>(".board-card[data-work-item-id]")]
    : [];
}

function prefersReducedMotion() {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

type DragPayload = { card: CardView; sourceColumnId: string };
const dragPayloads = new Map<string, DragPayload>();
function writeDrag(event: DragEvent, card: CardView, sourceColumnId: string) {
  const key = `${card.workItemId}:${Date.now()}`;
  dragPayloads.set(key, { card, sourceColumnId });
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("application/x-taskpilot-card", key);

  const source = event.currentTarget;
  if (
    !(source instanceof HTMLElement) ||
    typeof event.dataTransfer.setDragImage !== "function"
  )
    return;
  const bounds = source.getBoundingClientRect();
  const preview = source.cloneNode(true) as HTMLElement;
  preview.classList.remove("is-dragging", "is-moving", "is-settling");
  preview.classList.add("board-drag-preview");
  preview.setAttribute("aria-hidden", "true");
  preview.style.width = `${bounds.width}px`;
  preview.style.height = `${bounds.height}px`;
  document.body.append(preview);
  event.dataTransfer.setDragImage(
    preview,
    Math.max(0, Math.min(bounds.width, event.clientX - bounds.left)),
    Math.max(0, Math.min(bounds.height, event.clientY - bounds.top)),
  );
  requestAnimationFrame(() => preview.remove());
}
function readDrag(event: DragEvent) {
  const key = event.dataTransfer.getData("application/x-taskpilot-card");
  const value = dragPayloads.get(key);
  if (key) dragPayloads.delete(key);
  return value;
}
function discardDrag(event: DragEvent) {
  const key = event.dataTransfer.getData("application/x-taskpilot-card");
  if (key) dragPayloads.delete(key);
}
function resolveDropAnchor(column: HTMLElement, pointerY: number) {
  const cards = column.querySelectorAll<HTMLElement>(
    ".board-card[data-work-item-id]:not(.is-dragging)",
  );
  for (const card of cards) {
    const workItemId = card.dataset.workItemId;
    if (!workItemId) continue;
    const bounds = card.getBoundingClientRect();
    if (pointerY < bounds.top + bounds.height / 2) return workItemId;
  }
  return undefined;
}

function isOriginalCardPosition(
  board: BoardView,
  workItemId: string,
  sourceColumnId: string,
  targetColumnId: string,
  beforeWorkItemId?: string,
) {
  if (sourceColumnId !== targetColumnId) return false;
  const sourceCards = board.columns.find(
    (column) => column.columnId === sourceColumnId,
  )?.cards;
  if (!sourceCards) return false;
  const sourceIndex = sourceCards.findIndex(
    (card) => card.workItemId === workItemId,
  );
  if (sourceIndex < 0) return false;
  const remaining = sourceCards.filter(
    (card) => card.workItemId !== workItemId,
  );
  const insertionIndex = beforeWorkItemId
    ? remaining.findIndex((card) => card.workItemId === beforeWorkItemId)
    : remaining.length;
  return (
    (insertionIndex < 0 ? remaining.length : insertionIndex) === sourceIndex
  );
}

function previewMove(
  board: BoardView,
  workItemId: string,
  targetColumnId: string,
  beforeWorkItemId?: string,
): BoardView {
  let moving: CardView | undefined;
  const columns = board.columns.map((column) => ({
    ...column,
    cards: column.cards.filter((card) => {
      if (card.workItemId === workItemId) {
        moving = card;
        return false;
      }
      return true;
    }),
  }));
  if (!moving) return board;
  return {
    ...board,
    columns: columns.map((column) => {
      if (column.columnId !== targetColumnId) return column;
      const cards = [...column.cards];
      const before = beforeWorkItemId
        ? cards.findIndex((card) => card.workItemId === beforeWorkItemId)
        : -1;
      cards.splice(before >= 0 ? before : cards.length, 0, moving!);
      return {
        ...column,
        cards: cards.map((card, position) => ({ ...card, position })),
      };
    }),
  };
}
function findCard(board: BoardView, workItemId: string) {
  for (const column of board.columns) {
    const card = column.cards.find((item) => item.workItemId === workItemId);
    if (card) return { column, card };
  }
  return undefined;
}

function toSummary(board: BoardView): BoardSummary {
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
function normalize(value: string) {
  return value.trim().normalize("NFC");
}
function BoardGlyph() {
  return (
    <svg className="board-glyph" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 5.5h16v13H4zM9 5.5v13m6-13v13" />
    </svg>
  );
}
function MoreIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="3" cy="8" r="1" />
      <circle cx="8" cy="8" r="1" />
      <circle cx="13" cy="8" r="1" />
    </svg>
  );
}
function SettingsIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="2.2" />
      <path d="M8 1.8v1.4M8 12.8v1.4M1.8 8h1.4M12.8 8h1.4M3.6 3.6l1 1M11.4 11.4l1 1M12.4 3.6l-1 1M4.6 11.4l-1 1" />
    </svg>
  );
}
function EditIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="m3 11.8.4-2.5 6.8-6.8 2.3 2.3-6.8 6.8zM9.4 3.3l2.3 2.3" />
    </svg>
  );
}
