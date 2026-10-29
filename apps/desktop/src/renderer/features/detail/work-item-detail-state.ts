import type { BoardView, WorkItemView } from '../../../shared/contracts';

export type WorkItemDetailField = 'title' | 'description';
export type WorkItemDetailConfirmed = {
  workItem: WorkItemView;
  board: BoardView;
  columnId: string;
};
export type WorkItemDetailIntent =
  | { kind: 'close' }
  | { kind: 'switch'; field: WorkItemDetailField };

type EditSnapshot = {
  field: WorkItemDetailField;
  draft: string;
  dirty: boolean;
  confirmed: WorkItemDetailConfirmed;
  pendingIntent?: WorkItemDetailIntent;
};
type Editable = EditSnapshot & { error?: string; composition?: boolean };

export type WorkItemDetailState =
  | { kind: 'closed' }
  | { kind: 'loading'; token: number; boardId: string; workItemId: string }
  | { kind: 'error'; token: number; boardId: string; workItemId: string; message?: string }
  | { kind: 'read-only'; confirmed: WorkItemDetailConfirmed }
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
  | { type: 'submit'; intent?: WorkItemDetailIntent }
  | { type: 'validation-failed'; message: string; intent?: WorkItemDetailIntent }
  | { type: 'saved'; confirmed: WorkItemDetailConfirmed }
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

function editing(
  confirmed: WorkItemDetailConfirmed,
  field: WorkItemDetailField,
): WorkItemDetailState {
  return {
    kind: 'editing',
    field,
    draft: valueFor(confirmed, field),
    dirty: false,
    composition: false,
    confirmed,
  };
}

function saving(state: Editable, intent = state.pendingIntent): WorkItemDetailState {
  return {
    kind: 'saving',
    field: state.field,
    draft: state.draft,
    dirty: state.dirty,
    confirmed: state.confirmed,
    pendingIntent: intent,
  };
}

function afterIntent(
  confirmed: WorkItemDetailConfirmed,
  intent: WorkItemDetailIntent | undefined,
  field: WorkItemDetailField,
): WorkItemDetailState {
  if (intent?.kind === 'close') return initialWorkItemDetailState;
  if (intent?.kind === 'switch') return editing(confirmed, intent.field);
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
    if (state.kind === 'editing' && state.dirty) {
      return saving(state, { kind: 'close' });
    }
    if (state.kind === 'saving' || state.kind === 'conflict') {
      return { ...state, pendingIntent: { kind: 'close' } };
    }
    return initialWorkItemDetailState;
  }
  if (action.type === 'edit') {
    if (state.kind === 'read-only' || state.kind === 'saved') {
      return editing(state.confirmed, action.field);
    }
    if (state.kind === 'editing') {
      if (state.field === action.field) return state;
      return state.dirty
        ? saving(state, { kind: 'switch', field: action.field })
        : editing(state.confirmed, action.field);
    }
    if (state.kind === 'saving' || state.kind === 'conflict') {
      return { ...state, pendingIntent: { kind: 'switch', field: action.field } };
    }
    return state;
  }
  if (action.type === 'draft' && (state.kind === 'editing' || state.kind === 'conflict')) {
    const draft = action.value;
    const dirty = draft !== valueFor(state.confirmed, state.field);
    return state.kind === 'editing'
      ? { ...state, draft, dirty, error: undefined }
      : { ...state, draft, dirty };
  }
  if (action.type === 'composition-start' && state.kind === 'editing') {
    return state.composition ? state : { ...state, composition: true };
  }
  if (action.type === 'composition-end' && state.kind === 'editing') {
    return state.composition ? { ...state, composition: false } : state;
  }
  if (action.type === 'escape' && state.kind === 'editing') {
    return { kind: 'read-only', confirmed: state.confirmed };
  }
  if (action.type === 'blur' && state.kind === 'editing') {
    return state.dirty
      ? saving(state)
      : { kind: 'read-only', confirmed: state.confirmed };
  }
  if (action.type === 'submit' && state.kind === 'editing' && state.dirty) {
    if (state.composition) return state;
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
    return afterIntent(action.confirmed, state.pendingIntent, state.field);
  }
  if (action.type === 'settle' && state.kind === 'saved') {
    return { kind: 'read-only', confirmed: state.confirmed };
  }
  if (action.type === 'save-failed' && state.kind === 'saving') {
    return { ...state, kind: 'editing', error: action.message };
  }
  if (action.type === 'conflict' && state.kind === 'saving') {
    return { ...state, kind: 'conflict', confirmed: action.confirmed };
  }
  if (action.type === 'retry') {
    if (state.kind === 'conflict') return { ...state, kind: 'saving' };
    if (state.kind === 'editing' && state.dirty) return saving(state);
  }
  if (action.type === 'use-latest' && state.kind === 'conflict') {
    return afterIntent(state.confirmed, state.pendingIntent, state.field);
  }
  return state;
}
