import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useReducer,
  useRef,
  type FocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import type {
  BoardResponseKey,
  BoardView,
  TaskPilotDesktopApi,
} from "../../../shared/contracts";
import { useLocale } from "../../i18n/locale-state";
import {
  initialWorkItemDetailState,
  transitionWorkItemDetail,
} from "./work-item-detail-state";

export type WorkItemDetailTarget = {
  boardId: string;
  columnId: string;
  workItemId: string;
};

type CodedError = { code?: string; recovery?: string };

function normalize(value: string) {
  return value.trim().normalize("NFC");
}

export function WorkItemDetailDialog({
  target,
  board,
  api,
  workspaceId,
  projectId,
  getSelection,
  accepts,
  onBoard,
  onClose,
}: {
  target: WorkItemDetailTarget;
  board: BoardView;
  api: TaskPilotDesktopApi;
  workspaceId: string;
  projectId: string;
  getSelection(): number;
  accepts(key: BoardResponseKey, boardId?: string): boolean;
  onBoard(board: BoardView, key: BoardResponseKey, selection: number): boolean;
  onClose(): void;
}) {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const [detail, dispatch] = useReducer(
    transitionWorkItemDetail,
    initialWorkItemDetailState,
  );
  const detailRef = useRef(detail);
  const requestSequence = useRef(0);
  const mounted = useRef(true);
  const boardRef = useRef(board);
  const saveInFlight = useRef(false);
  const closeRequested = useRef(false);
  const fieldTriggers = useRef<
    Partial<Record<"title" | "description", HTMLButtonElement | null>>
  >({});
  const restoreFieldFocus = useRef<"title" | "description" | undefined>(undefined);
  const decisionFocus = useRef<HTMLButtonElement>(null);
  const fieldErrorId = useId();

  useLayoutEffect(() => {
    boardRef.current = board;
  }, [board]);

  useLayoutEffect(() => {
    detailRef.current = detail;
  }, [detail]);

  useLayoutEffect(() => {
    const field = restoreFieldFocus.current;
    if ((detail.kind !== "read-only" && detail.kind !== "saved") || !field) return;
    restoreFieldFocus.current = undefined;
    fieldTriggers.current[field]?.focus();
  }, [detail.kind]);

  useLayoutEffect(() => {
    if (detail.kind === "conflict") decisionFocus.current?.focus();
  }, [detail.kind]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      requestSequence.current += 1;
    };
  }, []);

  const load = useCallback(async () => {
    const token = ++requestSequence.current;
    const selection = getSelection();
    dispatch({
      type: "open",
      token,
      boardId: target.boardId,
      workItemId: target.workItemId,
    });
    try {
      const result = await api.boards.openWorkItem({
        workspaceId,
        projectId,
        boardId: target.boardId,
        workItemId: target.workItemId,
      });
      if (
        !mounted.current ||
        token !== requestSequence.current ||
        selection !== getSelection() ||
        board.boardId !== target.boardId ||
        !accepts(result.key, target.boardId)
      ) return;
      const currentBoard = boardRef.current;
      const column = currentBoard.columns.find(
        (item) =>
          item.columnId === target.columnId &&
          item.cards.some((card) => card.workItemId === target.workItemId),
      );
      if (!column) {
        dispatch({ type: "load-failed", token });
        return;
      }
      dispatch({
        type: "loaded",
        token,
        confirmed: {
          workItem: result.value,
          board: currentBoard,
          columnId: column.columnId,
        },
      });
    } catch (error) {
      if (
        mounted.current &&
        token === requestSequence.current &&
        selection === getSelection() &&
        (error as CodedError).recovery !== "SIGN_IN"
      ) dispatch({ type: "load-failed", token });
    }
  }, [accepts, api.boards, board.boardId, getSelection, projectId, target, workspaceId]);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  useEffect(() => {
    if (detail.kind !== "saved") return;
    const timer = window.setTimeout(() => dispatch({ type: "settle" }), 1600);
    return () => window.clearTimeout(timer);
  }, [detail]);

  useEffect(() => {
    if (detail.kind !== "saving" || saveInFlight.current) return;
    saveInFlight.current = true;
    const snapshot = detail;
    const title = normalize(
      snapshot.field === "title" ? snapshot.draft : snapshot.confirmed.workItem.title,
    );
    const description = normalize(
      snapshot.field === "description"
        ? snapshot.draft
        : snapshot.confirmed.workItem.description,
    );
    const failValidation = (message: string) => {
      saveInFlight.current = false;
      dispatch({ type: "validation-failed", message });
    };
    if (!title) {
      failValidation(t("board.workItemDetail.validation.titleRequired"));
      return;
    }
    if ([...title].length > 300) {
      failValidation(t("board.workItemDetail.validation.titleTooLong"));
      return;
    }
    if ([...description].length > 10_000) {
      failValidation(t("board.workItemDetail.validation.descriptionTooLong"));
      return;
    }
    const targetColumnId = snapshot.confirmed.columnId;
    const placement = findCard(
      snapshot.confirmed.board,
      snapshot.confirmed.workItem.workItemId,
    );
    if (!placement) {
      saveInFlight.current = false;
      dispatch({
        type: "save-failed",
        message: t(`board.workItemDetail.saveError.${snapshot.field}`),
      });
      return;
    }
    const selection = getSelection();
    void api.boards.editWorkItem({
      workspaceId,
      projectId,
      boardId: snapshot.confirmed.board.boardId,
      workItemId: snapshot.confirmed.workItem.workItemId,
      currentColumnId: snapshot.confirmed.columnId,
      targetColumnId,
      ...(targetColumnId === snapshot.confirmed.columnId
        ? {}
        : {
            expectedBoardVersion: snapshot.confirmed.board.version,
            expectedPlacementVersion: placement.card.placementVersion,
          }),
      expectedVersion: snapshot.confirmed.workItem.version,
      title,
      description,
    }).then((result) => {
      if (!mounted.current || selection !== getSelection()) return;
      if (!onBoard(result.value.board, result.key, selection)) {
        saveInFlight.current = false;
        dispatch({
          type: "save-failed",
          message: t(`board.workItemDetail.saveError.${snapshot.field}`),
        });
        return;
      }
      saveInFlight.current = false;
      dispatch({
        type: "saved",
        confirmed: {
          workItem: result.value.workItem,
          board: result.value.board,
          columnId: targetColumnId,
        },
      });
    }).catch(async (error: CodedError) => {
      if (!mounted.current || selection !== getSelection() || error.recovery === "SIGN_IN") return;
      if (isWorkItemConflict(error.code)) {
        try {
          const [workItemResult, boardResult] = await Promise.all([
            api.boards.openWorkItem({
              workspaceId,
              projectId,
              boardId: snapshot.confirmed.board.boardId,
              workItemId: snapshot.confirmed.workItem.workItemId,
            }),
            api.boards.open({
              workspaceId,
              projectId,
              boardId: snapshot.confirmed.board.boardId,
            }),
          ]);
          if (!mounted.current || selection !== getSelection()) return;
          if (
            !accepts(workItemResult.key, snapshot.confirmed.board.boardId) ||
            !accepts(boardResult.key, snapshot.confirmed.board.boardId)
          ) throw new Error("conflict refresh superseded");
          const latestPlacement = findCard(
            boardResult.value,
            snapshot.confirmed.workItem.workItemId,
          );
          if (!latestPlacement) throw new Error("placement unavailable");
          if (!onBoard(boardResult.value, boardResult.key, selection)) {
            throw new Error("conflict board superseded");
          }
          saveInFlight.current = false;
          dispatch({
            type: "conflict",
            confirmed: {
              workItem: workItemResult.value,
              board: boardResult.value,
              columnId: latestPlacement.column.columnId,
            },
          });
          return;
        } catch {
          // Preserve the draft and fall through to field-local recovery.
        }
      }
      saveInFlight.current = false;
      dispatch({
        type: "save-failed",
        message: t(`board.workItemDetail.saveError.${snapshot.field}`),
      });
    });
  }, [accepts, api.boards, detail, getSelection, onBoard, projectId, t, workspaceId]);

  const close = () => {
    closeRequested.current = true;
    requestSequence.current += 1;
    dispatch({ type: "request-close" });
  };

  useEffect(() => {
    if (detail.kind !== "closed" || !closeRequested.current) return;
    closeRequested.current = false;
    onClose();
  }, [detail.kind, onClose]);

  const confirmed =
    detail.kind === "read-only" ||
    detail.kind === "editing" ||
    detail.kind === "saving" ||
    detail.kind === "conflict" ||
    detail.kind === "saved"
      ? detail.confirmed
      : undefined;
  const fieldActive =
    detail.kind === "editing" ||
    detail.kind === "saving" ||
    detail.kind === "conflict";
  const activeState = fieldActive ? detail : undefined;
  const activeField = activeState?.field;
  const pending = detail.kind === "saving";
  const fieldError = detail.kind === "editing" ? detail.error : undefined;

  const descriptionAreaRef = useRef<HTMLTextAreaElement>(null);
  const descriptionDraft = activeState?.draft ?? "";
  useLayoutEffect(() => {
    const area = descriptionAreaRef.current;
    if (!area) return;
    area.style.height = "auto";
    area.style.height = `${area.scrollHeight}px`;
  }, [activeField, descriptionDraft, detail.kind]);

  const beginEdit = (field: "title" | "description") => {
    restoreFieldFocus.current = field;
    dispatch({ type: "edit", field });
  };
  const escapeField = (event: ReactKeyboardEvent) => {
    event.preventDefault();
    event.stopPropagation();
    dispatch({ type: "escape" });
  };
  const blurField = (event: FocusEvent<HTMLElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    dispatch({ type: "blur" });
  };
  const useLatest = () => {
    if (detail.kind !== "conflict") return;
    dispatch({ type: "use-latest" });
  };
  const compositionEvents = {
    onCompositionStart: () => dispatch({ type: "composition-start" }),
    onCompositionEnd: () => dispatch({ type: "composition-end" }),
  };

  const statusText = pending
    ? t("board.workItemDetail.saving")
    : detail.kind === "saved"
      ? t("board.workItemDetail.saved")
      : "";

  const feedbackNode = (field: "title" | "description") =>
    (pending || detail.kind === "saved") && detail.field === field ? (
      <span className="work-item-detail__save-status" role="status" aria-live="polite">
        {statusText}
      </span>
    ) : null;

  const attachTitleTrigger = useCallback((element: HTMLButtonElement | null) => {
    fieldTriggers.current.title = element;
  }, []);
  const attachDescriptionTrigger = useCallback(
    (element: HTMLButtonElement | null) => {
      fieldTriggers.current.description = element;
    },
    [],
  );


  const titleContent =
    confirmed && activeField !== "title" ? (
      <button
        type="button"
        ref={attachTitleTrigger}
        className="work-item-detail__field work-item-detail__title"
        aria-label={t("board.workItemDetail.editTitle")}
        onClick={() => beginEdit("title")}
      >
        <span className="work-item-detail__value">{confirmed.workItem.title}</span>
      </button>
    ) : undefined;

  const titleEditor =
    confirmed && activeField === "title" ? (
      <input
        type="text"
        className="work-item-detail__title-input"
        autoFocus
        name="workItemTitle"
        autoComplete="off"
        aria-label={t("board.workItemDetail.titleLabel")}
        aria-invalid={Boolean(fieldError)}
        aria-describedby={fieldError ? fieldErrorId : undefined}
        value={activeState?.draft ?? ""}
        readOnly={pending}
        onChange={(event) => dispatch({ type: "draft", value: event.target.value })}
        onBlur={blurField}
        {...compositionEvents}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Escape") escapeField(event);
          else if (event.key === "Enter") {
            event.preventDefault();
            dispatch({ type: "submit" });
          }
        }}
      />
    ) : undefined;

  const descriptionLabel = t("board.workItemDetail.descriptionLabel");
  const descriptionEditor = activeField === "description";
  const descriptionNode = confirmed ? (
    <div className="work-item-detail__surface">
      {descriptionEditor ? (
        <textarea
          ref={descriptionAreaRef}
          className="work-item-detail__textarea"
          rows={1}
          autoFocus
          name="workItemDescription"
          autoComplete="off"
          aria-label={descriptionLabel}
          aria-invalid={Boolean(fieldError)}
          aria-describedby={fieldError ? fieldErrorId : undefined}
          value={activeState?.draft ?? ""}
          readOnly={pending}
          onChange={(event) => dispatch({ type: "draft", value: event.target.value })}
          onBlur={blurField}
          {...compositionEvents}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Escape") escapeField(event);
            else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              dispatch({ type: "submit" });
            }
          }}
        />
      ) : (
        <button
          type="button"
          ref={attachDescriptionTrigger}
          className={`work-item-detail__field work-item-detail__description${
            confirmed.workItem.description ? "" : " work-item-detail__description--empty"
          }`}
          aria-label={t("board.workItemDetail.editDescription")}
          onClick={() => beginEdit("description")}
        >
          <span className="work-item-detail__value">
            {confirmed.workItem.description || t("board.workItemDetail.emptyDescription")}
          </span>
        </button>
      )}
    </div>
  ) : null;



  const headingTitle =
    confirmed?.workItem.title ??
    findCard(board, target.workItemId)?.card.title ??
    t("board.workItemDetail.loading");

  const footer = confirmed ? (
    <footer className="work-item-detail__audit">
      <dl className="work-item-detail__metadata">
        <div>
          <dt>{t("board.workItemDetail.createdAtLabel")}</dt>
          <dd>{formatAuditTime(confirmed.workItem.createdAt, locale)}</dd>
        </div>
        <div>
          <dt>{t("board.workItemDetail.updatedAtLabel")}</dt>
          <dd>{formatAuditTime(confirmed.workItem.updatedAt, locale)}</dd>
        </div>
      </dl>
    </footer>
  ) : undefined;

  return (
    <DetailModal
      title={headingTitle}
      onClose={close}
      titleContent={titleContent}
      titleEditor={titleEditor}
      titleFeedback={
        <div className="work-item-detail__feedback">{feedbackNode("title")}</div>
      }
      footer={footer}
    >
      {detail.kind === "loading" || detail.kind === "closed" ? (
        <p className="work-item-detail__status">{t("board.workItemDetail.loading")}</p>
      ) : detail.kind === "error" ? (
        <div className="work-item-detail__status">
          <p className="project-error" role="alert">
            {t("board.workItemDetail.loadError")}
          </p>
          <button type="button" className="project-button" onClick={() => void load()}>
            {t("common.retry")}
          </button>
        </div>
      ) : confirmed ? (
        <div className="work-item-detail">
          <div className="work-item-detail__content">
            {fieldError ? (
              <FieldRecovery
                error={fieldError}
                errorId={fieldErrorId}
                onRetry={() => dispatch({ type: "retry" })}
              />
            ) : null}
            <section className="work-item-detail__row work-item-detail__row--description">
              <div className="work-item-detail__row-heading">
                <span className="work-item-detail__label">{descriptionLabel}</span>
                <div className="work-item-detail__feedback">
                  {feedbackNode("description")}
                </div>
              </div>
              {descriptionNode}
            </section>
            {detail.kind === "conflict" ? (
              <div
                className="work-item-detail__gate"
                role="group"
                aria-label={t(`board.workItemDetail.conflict.${detail.field}.title`)}
              >
                <p>
                  {t("board.workItemDetail.conflict.latest", {
                    value:
                      detail.field === "title"
                        ? detail.confirmed.workItem.title
                        : detail.confirmed.workItem.description,
                  })}
                </p>
                <p>
                  {t("board.workItemDetail.conflict.draft", {
                    value: detail.draft,
                  })}
                </p>
                <div className="work-item-detail__recovery-actions">
                  <button
                    type="button"
                    ref={decisionFocus}
                    className="project-button"
                    onClick={useLatest}
                  >
                    {t("board.workItemDetail.conflict.useLatest")}
                  </button>
                  <button
                    type="button"
                    className="project-button project-button--primary"
                    onClick={() => dispatch({ type: "retry" })}
                  >
                    {t("board.workItemDetail.conflict.retry")}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </DetailModal>
  );
}

function formatAuditTime(value: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function findCard(board: BoardView, workItemId: string) {
  for (const column of board.columns) {
    const card = column.cards.find((item) => item.workItemId === workItemId);
    if (card) return { column, card };
  }
  return undefined;
}

function isWorkItemConflict(code?: string) {
  return (
    code === "RESOURCE_VERSION_CONFLICT" ||
    code === "BOARD_VERSION_CONFLICT" ||
    code === "PLACEMENT_CONFLICT"
  );
}

function FieldRecovery({
  error,
  errorId,
  onRetry,
}: {
  error?: string;
  errorId: string;
  onRetry(): void;
}) {
  const { t } = useTranslation();
  if (!error) return null;
  return (
    <div className="work-item-detail__field-error">
      <p id={errorId} className="project-error" role="alert">{error}</p>
      <button type="button" className="project-button" onClick={onRetry}>
        {t("common.retry")}
      </button>
    </div>
  );
}


function DetailModal({
  title,
  children,
  titleContent,
  titleEditor,
  titleFeedback,
  footer,
  onClose,
}: {
  title: string;
  children: ReactNode;
  titleContent?: ReactNode;
  titleEditor?: ReactNode;
  titleFeedback?: ReactNode;
  footer?: ReactNode;
  onClose(): void;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const dialog = useRef<HTMLElement>(null);
  const titleElement = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const returnTo =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : undefined;
    const element = dialog.current;
    titleElement.current?.focus();
    return () => {
      const active = document.activeElement;
      if (
        returnTo?.isConnected &&
        (active === document.body || element?.contains(active))
      )
        returnTo.focus();
    };
  }, []);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab" || !dialog.current) return;
      const items = [
        ...dialog.current.querySelectorAll<HTMLElement>(
          "button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled])",
        ),
      ];
      const first = items[0];
      const last = items.at(-1);
      if (
        event.shiftKey &&
        (document.activeElement === first ||
          document.activeElement === titleElement.current)
      ) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [onClose]);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={dialog}
        className="project-dialog board-dialog work-item-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header>
          <div className="board-dialog__heading">
            <h2
              ref={titleElement}
              id={titleId}
              className={titleEditor ? "visually-hidden" : undefined}
              tabIndex={-1}
            >
              {titleContent ?? title}
            </h2>
            {titleEditor}
            {titleFeedback}
          </div>
          <button
            type="button"
            className="icon-action"
            aria-label={t("project.close")}
            onClick={onClose}
          >
            ×
          </button>
        </header>
        {children}
        {footer}
      </section>
    </div>
  );
}
