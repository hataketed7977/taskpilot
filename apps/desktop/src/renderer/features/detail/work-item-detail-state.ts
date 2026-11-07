import type { BoardView, WorkItemView } from '../../../shared/contracts';
import {
  normalizedCodePointLength,
  PRODUCT_TEXT_LIMITS,
} from '../../shared/lib/text-constraints';

export type WorkItemDetailField = 'title' | 'description';
export type WorkItemDetailConfirmed = {
  workItem: WorkItemView;
  board: BoardView;
  columnId: string;
};
export type WorkItemDetailIntent =
  | { kind: 'close' }
  | { kind: 'switch'; field: WorkItemDetailField }
  | { kind: 'open-assignee' };

type PausedDraft = {
  field: WorkItemDetailField;
  draft: string;
  baseline: string;
};

type EditSnapshot = {
  field: WorkItemDetailField;
  draft: string;
  baseline: string;
  dirty: boolean;
  withinProductLimit: boolean;
  confirmed: WorkItemDetailConfirmed;
  pendingIntent?: WorkItemDetailIntent;
  suspended?: PausedDraft;
};
type Editable = EditSnapshot & { error?: string; composition?: boolean };

type PausedInvalid = {
  kind: 'paused-invalid';
  confirmed: WorkItemDetailConfirmed;
  paused: PausedDraft;
  assigneeOpen: boolean;
  closeGate: boolean;
};

export type WorkItemDetailState =
  | { kind: 'closed' }
  | { kind: 'loading'; token: number; boardId: string; workItemId: string }
  | { kind: 'error'; token: number; boardId: string; workItemId: string; message?: string }
  | { kind: 'read-only'; confirmed: WorkItemDetailConfirmed }
  | { kind: 'assignee-open'; confirmed: WorkItemDetailConfirmed }
  | PausedInvalid
  | ({ kind: 'editing' } & Editable)
  | ({ kind: 'saving' } & EditSnapshot)
  | ({ kind: 'conflict' } & EditSnapshot)
  | { kind: 'saved'; field: WorkItemDetailField; confirmed: WorkItemDetailConfirmed };

export type WorkItemDetailAction =
  | { type: 'open'; token: number; boardId: string; workItemId: string }
  | { type: 'loaded'; token: number; confirmed: WorkItemDetailConfirmed }
  | { type: 'load-failed'; token: number; message?: string }
  | { type: 'edit'; field: WorkItemDetailField }
  | { type: 'draft'; value: string }
  | { type: 'composition-start' }
  | { type: 'composition-end' }
  | { type: 'escape' }
  | { type: 'blur' }
  | { type: 'request-close' }
  | { type: 'continue-editing' }
  | { type: 'discard-and-close' }
  | { type: 'request-assignee' }
  | { type: 'close-assignee' }
  | { type: 'submit'; intent?: WorkItemDetailIntent }
  | { type: 'validation-failed'; message: string; intent?: WorkItemDetailIntent }
  | { type: 'saved'; confirmed: WorkItemDetailConfirmed }
  | { type: 'assignee-saved'; confirmed: WorkItemDetailConfirmed }
  | { type: 'settle' }
  | { type: 'save-failed'; message: string }
  | { type: 'conflict'; confirmed: WorkItemDetailConfirmed }
  | { type: 'retry' }
  | { type: 'use-latest' };

export const initialWorkItemDetailState: WorkItemDetailState = { kind: 'closed' };

function valueFor(confirmed: WorkItemDetailConfirmed, field: WorkItemDetailField) {
  return field === 'title'
    ? confirmed.workItem.title
    : confirmed.workItem.description;
}

function withinProductLimit(field: WorkItemDetailField, value: string) {
  const limit = field === 'title'
    ? PRODUCT_TEXT_LIMITS.workItemTitle
    : PRODUCT_TEXT_LIMITS.workItemDescription;
  return normalizedCodePointLength(value) <= limit;
}

function editing(
  confirmed: WorkItemDetailConfirmed,
  field: WorkItemDetailField,
  suspended?: PausedDraft,
  restored?: PausedDraft,
): WorkItemDetailState {
  const draft = restored?.draft ?? valueFor(confirmed, field);
  const baseline = restored?.baseline ?? valueFor(confirmed, field);
  return {
    kind: 'editing',
    field,
    draft,
    baseline,
    dirty: draft !== valueFor(confirmed, field),
    withinProductLimit: withinProductLimit(field, draft),
    composition: false,
    confirmed,
    suspended,
  };
}

function paused(
  confirmed: WorkItemDetailConfirmed,
  draft: PausedDraft,
  options: { assigneeOpen?: boolean; closeGate?: boolean } = {},
): PausedInvalid {
  return {
    kind: 'paused-invalid',
    confirmed,
    paused: draft,
    assigneeOpen: options.assigneeOpen ?? false,
    closeGate: options.closeGate ?? false,
  };
}

function pausedFromEditable(
  state: Editable,
  options?: { assigneeOpen?: boolean; closeGate?: boolean },
): PausedInvalid {
  return paused(state.confirmed, {
    field: state.field,
    draft: state.draft,
    baseline: state.baseline,
  }, options);
}

function reconcilePaused(
  confirmed: WorkItemDetailConfirmed,
  draft: PausedDraft,
  intent?: WorkItemDetailIntent,
): WorkItemDetailState {
  if (valueFor(confirmed, draft.field) !== draft.baseline) {
    return {
      kind: 'conflict',
      ...draft,
      dirty: true,
      withinProductLimit: withinProductLimit(draft.field, draft.draft),
      confirmed,
      pendingIntent: intent,
    };
  }
  return paused(confirmed, draft, {
    assigneeOpen: intent?.kind === 'open-assignee',
    closeGate: intent?.kind === 'close',
  });
}

function saving(state: Editable, intent = state.pendingIntent): WorkItemDetailState {
  return {
    kind: 'saving',
    field: state.field,
    draft: state.draft,
    baseline: state.baseline,
    dirty: state.dirty,
    withinProductLimit: state.withinProductLimit,
    confirmed: state.confirmed,
    pendingIntent: intent,
    suspended: state.suspended,
  };
}

function afterIntent(
  confirmed: WorkItemDetailConfirmed,
  intent: WorkItemDetailIntent | undefined,
  field: WorkItemDetailField,
  suspended?: PausedDraft,
): WorkItemDetailState {
  if (suspended) return reconcilePaused(confirmed, suspended, intent);
  if (intent?.kind === 'close') return initialWorkItemDetailState;
  if (intent?.kind === 'switch') return editing(confirmed, intent.field);
  if (intent?.kind === 'open-assignee') return { kind: 'assignee-open', confirmed };
  return { kind: 'saved', field, confirmed };
}

export function transitionWorkItemDetail(
  state: WorkItemDetailState,
  action: WorkItemDetailAction,
): WorkItemDetailState {
  if (action.type === 'open') return { kind: 'loading', ...action };
  if (action.type === 'loaded') {
    return state.kind === 'loading' && state.token === action.token
      ? { kind: 'read-only', confirmed: action.confirmed }
      : state;
  }
  if (action.type === 'load-failed') {
    return state.kind === 'loading' && state.token === action.token
      ? { ...state, kind: 'error', message: action.message }
      : state;
  }
  if (action.type === 'request-close') {
    if (state.kind === 'closed') return state;
    if (state.kind === 'paused-invalid') {
      return { ...state, assigneeOpen: false, closeGate: true };
    }
    if (state.kind === 'editing' && state.dirty) {
      return state.withinProductLimit
        ? saving(state, { kind: 'close' })
        : pausedFromEditable(state, { closeGate: true });
    }
    if (state.kind === 'editing' && state.suspended) {
      return reconcilePaused(state.confirmed, state.suspended, { kind: 'close' });
    }
    if (state.kind === 'saving' || state.kind === 'conflict') {
      return { ...state, pendingIntent: { kind: 'close' } };
    }
    return initialWorkItemDetailState;
  }
  if (action.type === 'continue-editing' && state.kind === 'paused-invalid') {
    return editing(state.confirmed, state.paused.field, undefined, state.paused);
  }
  if (action.type === 'discard-and-close' && state.kind === 'paused-invalid' && state.closeGate) {
    return initialWorkItemDetailState;
  }
  if (action.type === 'request-assignee') {
    const intent = { kind: 'open-assignee' } as const;
    if (state.kind === 'paused-invalid') {
      return { ...state, assigneeOpen: true, closeGate: false };
    }
    if (state.kind === 'read-only' || state.kind === 'saved') {
      return { kind: 'assignee-open', confirmed: state.confirmed };
    }
    if (state.kind === 'editing') {
      if (state.dirty) {
        return state.withinProductLimit
          ? saving(state, intent)
          : pausedFromEditable(state, { assigneeOpen: true });
      }
      if (state.suspended) return reconcilePaused(state.confirmed, state.suspended, intent);
      return { kind: 'assignee-open', confirmed: state.confirmed };
    }
    if (state.kind === 'saving' || state.kind === 'conflict') {
      return { ...state, pendingIntent: intent };
    }
    return state;
  }
  if (action.type === 'close-assignee') {
    if (state.kind === 'assignee-open') {
      return { kind: 'read-only', confirmed: state.confirmed };
    }
    if (state.kind === 'paused-invalid') {
      return { ...state, assigneeOpen: false };
    }
  }
  if (action.type === 'edit') {
    if (state.kind === 'paused-invalid') {
      if (state.paused.field === action.field) {
        return editing(state.confirmed, action.field, undefined, state.paused);
      }
      return editing(state.confirmed, action.field, state.paused);
    }
    if (
      state.kind === 'read-only' ||
      state.kind === 'saved' ||
      state.kind === 'assignee-open'
    ) {
      return editing(state.confirmed, action.field);
    }
    if (state.kind === 'editing') {
      if (state.field === action.field) return state;
      if (state.dirty) {
        return state.withinProductLimit
          ? saving(state, { kind: 'switch', field: action.field })
          : editing(state.confirmed, action.field, {
              field: state.field,
              draft: state.draft,
              baseline: state.baseline,
            });
      }
      return editing(state.confirmed, action.field, state.suspended);
    }
    if (state.kind === 'saving' || state.kind === 'conflict') {
      return { ...state, pendingIntent: { kind: 'switch', field: action.field } };
    }
    return state;
  }
  if (action.type === 'draft' && (state.kind === 'editing' || state.kind === 'conflict')) {
    const draft = action.value;
    const dirty = draft !== valueFor(state.confirmed, state.field);
    const limitOk = withinProductLimit(state.field, draft);
    return state.kind === 'editing'
      ? { ...state, draft, dirty, withinProductLimit: limitOk, error: undefined }
      : { ...state, draft, dirty, withinProductLimit: limitOk };
  }
  if (action.type === 'composition-start' && state.kind === 'editing') {
    return state.composition ? state : { ...state, composition: true };
  }
  if (action.type === 'composition-end' && state.kind === 'editing') {
    return state.composition ? { ...state, composition: false } : state;
  }
  if (action.type === 'escape') {
    if (state.kind === 'paused-invalid') {
      return { kind: 'read-only', confirmed: state.confirmed };
    }
    if (state.kind === 'editing') {
      return state.suspended
        ? reconcilePaused(state.confirmed, state.suspended)
        : { kind: 'read-only', confirmed: state.confirmed };
    }
  }
  if (action.type === 'blur' && state.kind === 'editing') {
    if (state.dirty) {
      return state.withinProductLimit ? saving(state) : pausedFromEditable(state);
    }
    return state.suspended
      ? reconcilePaused(state.confirmed, state.suspended)
      : { kind: 'read-only', confirmed: state.confirmed };
  }
  if (action.type === 'submit' && state.kind === 'editing' && state.dirty) {
    if (state.composition || !state.withinProductLimit) return state;
    return saving(state, action.intent ?? state.pendingIntent);
  }
  if (action.type === 'validation-failed' && (state.kind === 'editing' || state.kind === 'saving')) {
    return {
      ...state,
      kind: 'editing',
      error: action.message,
      pendingIntent: action.intent ?? state.pendingIntent,
    };
  }
  if (action.type === 'saved' && state.kind === 'saving') {
    return afterIntent(
      action.confirmed,
      state.pendingIntent,
      state.field,
      state.suspended,
    );
  }
  if (action.type === 'settle' && state.kind === 'saved') {
    return { kind: 'read-only', confirmed: state.confirmed };
  }
  if (action.type === 'assignee-saved') {
    if (state.kind === 'paused-invalid') {
      return reconcilePaused(action.confirmed, state.paused);
    }
    if (
      state.kind === 'read-only' ||
      state.kind === 'saved' ||
      state.kind === 'assignee-open'
    ) {
      return { kind: 'read-only', confirmed: action.confirmed };
    }
    if (state.kind === 'editing' || state.kind === 'saving' || state.kind === 'conflict') {
      return { ...state, confirmed: action.confirmed };
    }
  }
  if (action.type === 'save-failed' && state.kind === 'saving') {
    return { ...state, kind: 'editing', error: action.message };
  }
  if (action.type === 'conflict' && state.kind === 'saving') {
    return { ...state, kind: 'conflict', confirmed: action.confirmed };
  }
  if (action.type === 'retry') {
    if (state.kind === 'conflict' && state.withinProductLimit) return { ...state, kind: 'saving' };
    if (state.kind === 'editing' && state.dirty && state.withinProductLimit) return saving(state);
  }
  if (action.type === 'use-latest' && state.kind === 'conflict') {
    return afterIntent(
      state.confirmed,
      state.pendingIntent,
      state.field,
      state.suspended,
    );
  }
  return state;
}
