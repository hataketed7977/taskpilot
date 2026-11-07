import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import type {
  AssigneePatch,
  AssigneeTarget,
  BoardResponseKey,
  BoardView,
  PersonSummary,
  ProjectMemberSummary,
  TaskPilotDesktopApi,
} from "../../../shared/contracts";
import { useLocale } from "../../i18n/locale-state";
import {
  PRODUCT_TEXT_LIMITS,
  normalizePersistedText,
  normalizedCodePointLength,
} from "../../shared/lib/text-constraints";
import { TextFeedback } from "../../shared/ui/text-feedback";
import { useBoundedText } from "../../shared/ui/use-bounded-text";
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
type ProjectMembersState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; members: ProjectMemberSummary[] }
  | { kind: "error" };

const ASSIGNEE_DEFAULT_MEMBER_LIMIT = 6;
const ASSIGNEE_SEARCH_MEMBER_LIMIT = 8;


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
  const memberRequestSequence = useRef(0);
  const assigneeRequestSequence = useRef(0);
  const closeRequested = useRef(false);
  const fieldTriggers = useRef<
    Partial<Record<"title" | "description", HTMLButtonElement | null>>
  >({});
  const restoreFieldFocus = useRef<"title" | "description" | undefined>(undefined);
  const decisionFocus = useRef<HTMLButtonElement>(null);
  const fieldErrorId = useId();
  const [projectMembers, setProjectMembers] = useState<ProjectMembersState>({ kind: "idle" });
  const [assigneeSaving, setAssigneeSaving] = useState(false);
  const [assigneeError, setAssigneeError] = useState<string>();
  const closeGateOpen = detail.kind === "paused-invalid" && detail.closeGate;

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
    if (detail.kind === "conflict" || closeGateOpen) decisionFocus.current?.focus();
  }, [closeGateOpen, detail.kind]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      requestSequence.current += 1;
      memberRequestSequence.current += 1;
      assigneeRequestSequence.current += 1;
    };
  }, []);

  const loadProjectMembers = useCallback(async () => {
    const token = ++memberRequestSequence.current;
    const selection = getSelection();
    setProjectMembers({ kind: "loading" });
    try {
      const result = await api.boards.listProjectMembers({ workspaceId, projectId });
      if (
        !mounted.current ||
        token !== memberRequestSequence.current ||
        selection !== getSelection() ||
        !accepts(result.key)
      ) return;
      setProjectMembers({ kind: "ready", members: result.value });
    } catch (error) {
      if (
        mounted.current &&
        token === memberRequestSequence.current &&
        selection === getSelection() &&
        (error as CodedError).recovery !== "SIGN_IN"
      ) setProjectMembers({ kind: "error" });
    }
  }, [accepts, api.boards, getSelection, projectId, workspaceId]);

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
    void Promise.resolve().then(loadProjectMembers);
  }, [loadProjectMembers]);

  useEffect(() => {
    if (detail.kind !== "saved") return;
    const timer = window.setTimeout(() => dispatch({ type: "settle" }), 1600);
    return () => window.clearTimeout(timer);
  }, [detail]);

  useEffect(() => {
    if (detail.kind !== "saving" || saveInFlight.current) return;
    saveInFlight.current = true;
    const snapshot = detail;
    const value = normalizePersistedText(snapshot.draft);
    const failValidation = (message: string) => {
      saveInFlight.current = false;
      dispatch({ type: "validation-failed", message });
    };
    if (snapshot.field === "title" && !value) {
      failValidation(t("board.workItemDetail.validation.titleRequired"));
      return;
    }
    if (
      snapshot.field === "title" &&
      normalizedCodePointLength(value) > PRODUCT_TEXT_LIMITS.workItemTitle
    ) {
      failValidation(t("board.workItemDetail.validation.titleTooLong"));
      return;
    }
    if (
      snapshot.field === "description" &&
      normalizedCodePointLength(value) > PRODUCT_TEXT_LIMITS.workItemDescription
    ) {
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
      ...(snapshot.field === "title" ? { title: value } : {
        descriptionPatch: value ? { action: "SET", value } : { action: "CLEAR" },
      }),
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
          if (!latestPlacement) {
            throw new Error("placement unavailable", { cause: error });
          }
          if (!onBoard(boardResult.value, boardResult.key, selection)) {
            throw new Error("conflict board superseded", { cause: error });
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

  const changeAssignee = useCallback(async (patch: AssigneePatch) => {
    const snapshot = detailRef.current;
    if (
      snapshot.kind !== "read-only" &&
      snapshot.kind !== "saved" &&
      snapshot.kind !== "assignee-open" &&
      snapshot.kind !== "paused-invalid"
    ) return;
    const confirmed = snapshot.confirmed;
    const currentAssignee = confirmed.workItem.assignee;
    if (
      patch.action === "CLEAR" &&
      !currentAssignee
    ) return;
    if (
      patch.action === "SET" &&
      currentAssignee?.targetType === "PROJECT_MEMBER" &&
      currentAssignee.projectMemberId === patch.target.projectMemberId
    ) return;

    const token = ++assigneeRequestSequence.current;
    const selection = getSelection();
    const placement = findCard(confirmed.board, confirmed.workItem.workItemId);
    if (!placement) {
      setAssigneeError(t("board.workItemDetail.assignee.saveError"));
      return;
    }
    setAssigneeSaving(true);
    setAssigneeError(undefined);
    try {
      const result = await api.boards.editWorkItem({
        workspaceId,
        projectId,
        boardId: confirmed.board.boardId,
        workItemId: confirmed.workItem.workItemId,
        currentColumnId: confirmed.columnId,
        targetColumnId: confirmed.columnId,
        expectedVersion: confirmed.workItem.version,
        assigneePatch: patch,
      });
      if (
        !mounted.current ||
        token !== assigneeRequestSequence.current ||
        selection !== getSelection()
      ) return;
      if (!onBoard(result.value.board, result.key, selection)) {
        setAssigneeError(t("board.workItemDetail.assignee.saveError"));
        return;
      }
      dispatch({
        type: "assignee-saved",
        confirmed: {
          workItem: result.value.workItem,
          board: result.value.board,
          columnId: confirmed.columnId,
        },
      });
    } catch (error) {
      if (
        !mounted.current ||
        token !== assigneeRequestSequence.current ||
        selection !== getSelection() ||
        (error as CodedError).recovery === "SIGN_IN"
      ) return;
      if (isWorkItemConflict((error as CodedError).code)) {
        try {
          const [workItemResult, boardResult] = await Promise.all([
            api.boards.openWorkItem({
              workspaceId,
              projectId,
              boardId: confirmed.board.boardId,
              workItemId: confirmed.workItem.workItemId,
            }),
            api.boards.open({
              workspaceId,
              projectId,
              boardId: confirmed.board.boardId,
            }),
          ]);
          if (
            !mounted.current ||
            token !== assigneeRequestSequence.current ||
            selection !== getSelection() ||
            !accepts(workItemResult.key, confirmed.board.boardId) ||
            !accepts(boardResult.key, confirmed.board.boardId)
          ) return;
          const latestPlacement = findCard(
            boardResult.value,
            confirmed.workItem.workItemId,
          );
          if (!latestPlacement) {
            throw new Error("placement unavailable", { cause: error });
          }
          if (!onBoard(boardResult.value, boardResult.key, selection)) {
            throw new Error("conflict board superseded", { cause: error });
          }
          dispatch({
            type: "assignee-saved",
            confirmed: {
              workItem: workItemResult.value,
              board: boardResult.value,
              columnId: latestPlacement.column.columnId,
            },
          });
          setAssigneeError(t("board.workItemDetail.assignee.conflict"));
          return;
        } catch {
          // Fall through to field-local recovery.
        }
      }
      setAssigneeError(t("board.workItemDetail.assignee.saveError"));
    } finally {
      if (mounted.current && token === assigneeRequestSequence.current) {
        setAssigneeSaving(false);
      }
    }
  }, [accepts, api.boards, getSelection, onBoard, projectId, t, workspaceId]);

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
    detail.kind === "assignee-open" ||
    detail.kind === "editing" ||
    detail.kind === "saving" ||
    detail.kind === "conflict" ||
    detail.kind === "saved" ||
    detail.kind === "paused-invalid"
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
  const assigneeDisabled = assigneeSaving;
  const assigneeOpen = detail.kind === "assignee-open" || (detail.kind === "paused-invalid" && detail.assigneeOpen);
  const pausedDraft = detail.kind === "paused-invalid"
    ? detail.paused
    : activeState?.suspended;

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
  const requestAssignee = useCallback(() => {
    restoreFieldFocus.current = undefined;
    dispatch({ type: "request-assignee" });
  }, []);
  const acknowledgeAssigneeOpen = useCallback(() => {
    dispatch({ type: "close-assignee" });
  }, []);
  const statusText = pending
    ? t("board.workItemDetail.saving")
    : detail.kind === "saved"
      ? t("board.workItemDetail.saved")
      : "";

  const feedbackNode = (field: "title" | "description") => {
    if (pausedDraft?.field === field) {
      return (
        <button
          type="button"
          className="work-item-detail__paused-status"
          onClick={() => beginEdit(field)}
        >
          {t("board.workItemDetail.paused.status")}
        </button>
      );
    }
    return (pending || detail.kind === "saved") && detail.field === field ? (
      <span className="work-item-detail__save-status" role="status" aria-live="polite">
        {statusText}
      </span>
    ) : null;
  };

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
        <span className="work-item-detail__value">
          {pausedDraft?.field === "title" ? pausedDraft.draft : confirmed.workItem.title}
        </span>
      </button>
    ) : undefined;

  const titleEditor =
    confirmed && activeField === "title" && activeState ? (
      <BoundedDetailEditor
        key={`title:${activeState.baseline}`}
        field="title"
        draft={activeState.draft}
        baseline={activeState.baseline}
        pending={pending}
        error={fieldError}
        errorId={fieldErrorId}
        onDraft={(value) => dispatch({ type: "draft", value })}
        onBlur={blurField}
        onEscape={escapeField}
        onSubmit={() => dispatch({ type: "submit" })}
      />
    ) : undefined;

  const descriptionLabel = t("board.workItemDetail.descriptionLabel");
  const descriptionEditor = activeField === "description";
  const descriptionNode = confirmed ? (
    <div className="work-item-detail__surface">
      {descriptionEditor && activeState ? (
        <BoundedDetailEditor
          key={`description:${activeState.baseline}`}
          field="description"
          draft={activeState.draft}
          baseline={activeState.baseline}
          pending={pending}
          error={fieldError}
          errorId={fieldErrorId}
          onDraft={(value) => dispatch({ type: "draft", value })}
          onBlur={blurField}
          onEscape={escapeField}
          onSubmit={() => dispatch({ type: "submit" })}
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
            {(pausedDraft?.field === "description"
              ? pausedDraft.draft
              : confirmed.workItem.description) || t("board.workItemDetail.emptyDescription")}
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
      <div className="work-item-detail__creator-audit">
        <span className="work-item-detail__creator-label">
          {t("board.workItemDetail.creatorLabel")}
        </span>
        <PersonPill person={confirmed.workItem.createdBy} />
      </div>
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
            <section className="work-item-detail__meta-strip" aria-label={t("board.workItemDetail.metadataLabel")}>
              <div className="work-item-detail__meta-field work-item-detail__meta-field--assignee">
                <span className="work-item-detail__label">
                  {t("board.workItemDetail.assignee.label")}
                </span>
                <AssigneePicker
                  assignee={confirmed.workItem.assignee ?? null}
                  disabled={assigneeDisabled}
                  error={assigneeError}
                  membersState={projectMembers}
                  saving={assigneeSaving}
                  open={assigneeOpen}
                  onOpenRequested={requestAssignee}
                  onClose={acknowledgeAssigneeOpen}
                  onChange={changeAssignee}
                  onRetryMembers={() => void loadProjectMembers()}
                />
              </div>
            </section>
            <section className="work-item-detail__row work-item-detail__row--description">
              <div className="work-item-detail__row-heading">
                <span className="work-item-detail__label">{descriptionLabel}</span>
                <div className="work-item-detail__feedback">
                  {feedbackNode("description")}
                </div>
              </div>
              {descriptionNode}
            </section>
            {detail.kind === "paused-invalid" && detail.closeGate ? (
              <div
                className="work-item-detail__gate"
                role="alertdialog"
                aria-labelledby={`${fieldErrorId}-paused-title`}
                aria-describedby={`${fieldErrorId}-paused-detail`}
              >
                <p id={`${fieldErrorId}-paused-title`}>
                  <strong>{t("board.workItemDetail.paused.closeTitle")}</strong>
                </p>
                <p id={`${fieldErrorId}-paused-detail`}>
                  {t("board.workItemDetail.paused.closeDetail")}
                </p>
                <div className="work-item-detail__recovery-actions">
                  <button
                    type="button"
                    ref={decisionFocus}
                    className="project-button"
                    onClick={() => dispatch({ type: "continue-editing" })}
                  >
                    {t("board.workItemDetail.paused.continueEditing")}
                  </button>
                  <button
                    type="button"
                    className="project-button project-button--danger"
                    onClick={() => dispatch({ type: "discard-and-close" })}
                  >
                    {t("board.workItemDetail.paused.discardAndClose")}
                  </button>
                </div>
              </div>
            ) : null}
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


function BoundedDetailEditor({
  field,
  draft,
  baseline,
  pending,
  error,
  errorId,
  onDraft,
  onBlur,
  onEscape,
  onSubmit,
}: {
  field: "title" | "description";
  draft: string;
  baseline: string;
  pending: boolean;
  error?: string;
  errorId: string;
  onDraft(value: string): void;
  onBlur(event: FocusEvent<HTMLElement>): void;
  onEscape(event: ReactKeyboardEvent): void;
  onSubmit(): void;
}) {
  const { t } = useTranslation();
  const limit = field === "title"
    ? PRODUCT_TEXT_LIMITS.workItemTitle
    : PRODUCT_TEXT_LIMITS.workItemDescription;
  const bounded = useBoundedText(draft, limit, {
    authoritativeValue: baseline,
    onAccepted: onDraft,
  });
  const feedbackId = `${errorId}-${field}-feedback`;
  const common = {
    autoFocus: true,
    name: field === "title" ? "workItemTitle" : "workItemDescription",
    autoComplete: "off",
    "aria-label": t(`board.workItemDetail.${field}Label`),
    "aria-invalid": Boolean(error) || !bounded.withinProductLimit,
    "aria-describedby": error ? `${feedbackId} ${errorId}` : feedbackId,
    readOnly: pending,
    onBlur,
    ...bounded.inputProps,
  };
  const feedback = (
    <TextFeedback
      id={feedbackId}
      count={bounded.count}
      limit={bounded.limit}
      showCount={bounded.showCount}
      limitReached={bounded.limitReached}
      error={undefined}
    />
  );
  if (field === "title") {
    return (
      <>
        <input
          type="text"
          className="work-item-detail__title-input"
          {...common}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Escape") onEscape(event);
            else if (event.key === "Enter") {
              event.preventDefault();
              onSubmit();
            }
          }}
        />
        {feedback}
      </>
    );
  }
  return (
    <>
      <textarea
        className="work-item-detail__textarea"
        rows={1}
        {...common}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Escape") onEscape(event);
          else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            onSubmit();
          }
        }}
      />
      {feedback}
    </>
  );
}


function AssigneePicker({
  assignee,
  disabled,
  error,
  membersState,
  saving,
  open,
  onOpenRequested,
  onClose,
  onChange,
  onRetryMembers,
}: {
  assignee: AssigneeTarget | null;
  disabled: boolean;
  error?: string;
  membersState: ProjectMembersState;
  saving: boolean;
  open: boolean;
  onOpenRequested(): void;
  onClose(): void;
  onChange(patch: AssigneePatch): void;
  onRetryMembers(): void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const options = useRef<Array<HTMLButtonElement | null>>([]);
  const menuId = useId();
  const currentName = assignee?.user.displayName ?? t("board.workItemDetail.assignee.unassigned");
  const trimmedQuery = query.trim();
  const hasQuery = trimmedQuery.length > 0;
  const members = useMemo(
    () => (membersState.kind === "ready" ? membersState.members : []),
    [membersState],
  );
  const filteredMembers = useMemo(() => {
    const needle = trimmedQuery.toLocaleLowerCase();
    if (!needle) return members;
    return members.filter((member) => (
      member.user.displayName.toLocaleLowerCase().includes(needle) ||
      t(`board.workItemDetail.assignee.role.${member.role}`).toLocaleLowerCase().includes(needle)
    ));
  }, [members, t, trimmedQuery]);
  const visibleMemberLimit = hasQuery ? ASSIGNEE_SEARCH_MEMBER_LIMIT : ASSIGNEE_DEFAULT_MEMBER_LIMIT;
  const visibleMembers = filteredMembers.slice(0, visibleMemberLimit);
  const hiddenMemberCount = Math.max(0, filteredMembers.length - visibleMembers.length);

  const closePicker = useCallback(() => {
    onClose();
    setQuery("");
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const listener = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (menu.current?.contains(target) || trigger.current?.contains(target)) return;
      closePicker();
    };
    window.addEventListener("mousedown", listener, true);
    return () => window.removeEventListener("mousedown", listener, true);
  }, [closePicker, open]);

  useLayoutEffect(() => {
    if (!open) return;
    options.current = options.current.slice(0, visibleMembers.length + 1);
    search.current?.focus();
  }, [open, visibleMembers.length]);

  const focusOption = (index: number) => {
    const next = Math.max(0, Math.min(index, options.current.length - 1));
    options.current[next]?.focus();
  };
  const onMenuKeyDown = (event: ReactKeyboardEvent) => {
    const index = options.current.findIndex((item) => item === document.activeElement);
    if (event.key === "Escape") {
      event.preventDefault();
      closePicker();
      trigger.current?.focus();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      focusOption(index < 0 ? 0 : index + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      focusOption(index <= 0 ? options.current.length - 1 : index - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusOption(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusOption(options.current.length - 1);
    }
  };

  const choose = (patch: AssigneePatch) => {
    closePicker();
    onChange(patch);
    trigger.current?.focus();
  };

  const onSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closePicker();
      trigger.current?.focus();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      focusOption(0);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (filteredMembers.length === 1) {
        const [member] = filteredMembers;
        choose({
          action: "SET",
          target: { targetType: "PROJECT_MEMBER", projectMemberId: member.projectMemberId },
        });
      }
    }
  };

  return (
    <div className="assignee-picker">
      <button
        ref={trigger}
        type="button"
        className="assignee-picker__trigger"
        data-assigned={assignee ? "true" : "false"}
        disabled={disabled}
        aria-busy={saving}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={t("board.workItemDetail.assignee.change", { name: currentName })}
        onClick={() => {
          if (open) closePicker();
          else onOpenRequested();
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " " || event.key === "ArrowDown") {
            event.preventDefault();
            if (!open) onOpenRequested();
          }
        }}
      >
        <span className="assignee-picker__avatar-slot" aria-hidden="true">
          {assignee ? (
            <AssigneeAvatar person={assignee.user} />
          ) : (
            <span className="assignee-picker__unassigned-avatar">
              <svg viewBox="0 0 16 16" focusable="false">
                <circle cx="8" cy="5.25" r="2.25" />
                <path d="M3.75 13c.38-2.18 1.8-3.4 4.25-3.4s3.87 1.22 4.25 3.4" />
              </svg>
            </span>
          )}
        </span>
        <span className="assignee-picker__trigger-text">{currentName}</span>
        <span className="assignee-picker__chevron" aria-hidden="true">
          {saving ? (
            <svg className="assignee-picker__spinner" viewBox="0 0 16 16" focusable="false">
              <circle cx="8" cy="8" r="5.25" />
            </svg>
          ) : (
            <svg viewBox="0 0 16 16" focusable="false">
              <path d="m5.25 6.75 2.75 2.75 2.75-2.75" />
            </svg>
          )}
        </span>
      </button>
      {saving ? (
        <span className="visually-hidden" role="status" aria-live="polite">
          {t("board.workItemDetail.assignee.saving")}
        </span>
      ) : null}
      {error ? <p className="assignee-picker__error" role="alert">{error}</p> : null}
      {open ? (
        <div
          ref={menu}
          className="assignee-picker__menu"
          onKeyDown={onMenuKeyDown}
        >
          <label className="assignee-picker__search">
            <span className="visually-hidden">
              {t("board.workItemDetail.assignee.searchLabel")}
            </span>
            <input
              ref={search}
              type="search"
              name="work-item-assignee-search"
              autoComplete="off"
              value={query}
              placeholder={t("board.workItemDetail.assignee.searchPlaceholder")}
              aria-label={t("board.workItemDetail.assignee.searchLabel")}
              onChange={(event) => setQuery(event.currentTarget.value)}
              onKeyDown={onSearchKeyDown}
            />
          </label>
          <div id={menuId} role="listbox" aria-label={t("board.workItemDetail.assignee.options")}>
            <button
              ref={(element) => { options.current[0] = element; }}
              type="button"
              className="assignee-picker__option"
              role="option"
              aria-selected={!assignee}
              onClick={() => choose({ action: "CLEAR" })}
            >
              <span className="assignee-picker__option-main assignee-picker__option-main--unassigned">
                <span>{t("board.workItemDetail.assignee.unassigned")}</span>
                <small>{t("board.workItemDetail.assignee.clearHint")}</small>
              </span>
            </button>
            {membersState.kind === "idle" || membersState.kind === "loading" ? (
              <p className="assignee-picker__message">
                {t("board.workItemDetail.assignee.loading")}
              </p>
            ) : membersState.kind === "error" ? (
              <div className="assignee-picker__message assignee-picker__message--error">
                <p>{t("board.workItemDetail.assignee.loadError")}</p>
                <button type="button" className="project-button" onClick={onRetryMembers}>
                  {t("common.retry")}
                </button>
              </div>
            ) : members.length === 0 ? (
              <p className="assignee-picker__message">
                {t("board.workItemDetail.assignee.empty")}
              </p>
            ) : filteredMembers.length === 0 ? (
              <p className="assignee-picker__message">
                {t("board.workItemDetail.assignee.noResults")}
              </p>
            ) : (
              <>
                {visibleMembers.map((member, index) => (
                  <button
                    ref={(element) => { options.current[index + 1] = element; }}
                    key={member.projectMemberId}
                    type="button"
                    className="assignee-picker__option"
                    role="option"
                    aria-selected={assignee?.projectMemberId === member.projectMemberId}
                    onClick={() => choose({
                      action: "SET",
                      target: { targetType: "PROJECT_MEMBER", projectMemberId: member.projectMemberId },
                    })}
                  >
                    <AssigneeAvatar person={member.user} />
                    <span className="assignee-picker__option-main">
                      <span>{member.user.displayName}</span>
                      <small>{t(`board.workItemDetail.assignee.role.${member.role}`)}</small>
                    </span>
                  </button>
                ))}
                {hiddenMemberCount > 0 ? (
                  <p className="assignee-picker__message assignee-picker__message--overflow">
                    {t(hasQuery
                      ? "board.workItemDetail.assignee.moreSearchResults"
                      : "board.workItemDetail.assignee.moreDefaultResults", {
                        count: hiddenMemberCount,
                        shown: visibleMembers.length,
                        total: filteredMembers.length,
                      })}
                  </p>
                ) : null}
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PersonPill({ person }: { person: PersonSummary }) {
  return (
    <span className="person-pill">
      <AssigneeAvatar person={person} />
      <span className="person-pill__name">{person.displayName}</span>
    </span>
  );
}

function AssigneeAvatar({ person }: { person: PersonSummary }) {
  return (
    <span className="assignee-avatar" aria-hidden="true">
      {person.avatarUrl ? <img src={person.avatarUrl} alt="" width={24} height={24} /> : initials(person.displayName)}
    </span>
  );
}

function initials(value: string) {
  const parts = Array.from(value.trim());
  return (parts[0] ?? "—").toLocaleUpperCase();
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
