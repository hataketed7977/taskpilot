import { describe, expect, it } from 'vitest';
import type { BoardView, WorkItemView } from '../../src/shared/contracts';
import {
  initialWorkItemDetailState,
  transitionWorkItemDetail,
  type WorkItemDetailConfirmed,
} from '../../src/renderer/work-item-detail-state';

const now = '2026-10-22T00:00:00Z';
const workItem: WorkItemView = {
  workItemId: '77777777-7777-4777-8777-777777777777',
  projectId: '33333333-3333-4333-8333-333333333333',
  title: 'Authoritative title',
  description: 'Authoritative description',
  version: 4,
  createdAt: now,
  updatedAt: now,
};
const board: BoardView = {
  boardId: '44444444-4444-4444-8444-444444444444',
  projectId: workItem.projectId,
  name: 'Delivery',
  description: '',
  version: 7,
  createdAt: now,
  updatedAt: now,
  columns: [{
    columnId: '55555555-5555-4555-8555-555555555555',
    name: 'Todo',
    position: 0,
    version: 0,
    createdAt: now,
    updatedAt: now,
    cards: [{
      workItemId: workItem.workItemId,
      title: 'Stale projection title',
      description: '',
      workItemVersion: 3,
      placementVersion: 2,
      position: 0,
    }],
  }, {
    columnId: '66666666-6666-4666-8666-666666666666',
    name: 'Doing',
    position: 1,
    version: 0,
    createdAt: now,
    updatedAt: now,
    cards: [],
  }],
};
const confirmed: WorkItemDetailConfirmed = {
  workItem,
  board,
  columnId: board.columns[0].columnId,
};

function loaded(token = 1) {
  return transitionWorkItemDetail(
    transitionWorkItemDetail(initialWorkItemDetailState, {
      type: 'open', token, boardId: board.boardId, workItemId: workItem.workItemId,
    }),
    { type: 'loaded', token, confirmed },
  );
}

function dirty(field: 'title' | 'description' = 'title', value = 'Local draft') {
  return transitionWorkItemDetail(
    transitionWorkItemDetail(loaded(), { type: 'edit', field }),
    { type: 'draft', value },
  );
}

describe('work item detail state', () => {
  it('moves through loading, one-field editing, saving, saved feedback, and read-only', () => {
    const editing = dirty();
    const saving = transitionWorkItemDetail(editing, { type: 'submit' });
    expect(saving).toMatchObject({
      kind: 'saving', field: 'title', draft: 'Local draft', pendingIntent: undefined,
    });
    const latest = { ...confirmed, workItem: { ...workItem, title: 'Local draft', version: 5 } };
    const saved = transitionWorkItemDetail(saving, { type: 'saved', confirmed: latest });
    expect(saved).toMatchObject({ kind: 'saved', field: 'title', confirmed: latest });
    expect(transitionWorkItemDetail(saved, { type: 'settle' })).toMatchObject({
      kind: 'read-only', confirmed: latest,
    });
  });

  it('discards only the active draft on Escape and restores the confirmed value', () => {
    const editing = dirty('description');
    expect(transitionWorkItemDetail(editing, { type: 'escape' })).toEqual({
      kind: 'read-only', confirmed,
    });
  });

  it('turns dirty close and field switches into save-first pending intents', () => {
    const editing = dirty('description');
    const closing = transitionWorkItemDetail(editing, { type: 'request-close' });
    expect(closing).toMatchObject({ kind: 'saving', pendingIntent: { kind: 'close' } });
    expect(transitionWorkItemDetail(closing, { type: 'saved', confirmed }).kind).toBe('closed');

    const switching = transitionWorkItemDetail(editing, { type: 'edit', field: 'title' });
    expect(switching).toMatchObject({
      kind: 'saving', field: 'description', pendingIntent: { kind: 'switch', field: 'title' },
    });
    expect(transitionWorkItemDetail(switching, { type: 'saved', confirmed })).toMatchObject({
      kind: 'editing', field: 'title', dirty: false, draft: confirmed.workItem.title,
    });
  });

  it('updates the pending intent without submitting the same saving snapshot again', () => {
    const saving = transitionWorkItemDetail(dirty(), { type: 'submit' });
    const switching = transitionWorkItemDetail(saving, { type: 'edit', field: 'description' });
    expect(switching).toMatchObject({
      kind: 'saving', draft: 'Local draft', pendingIntent: { kind: 'switch', field: 'description' },
    });
    const closing = transitionWorkItemDetail(switching, { type: 'request-close' });
    expect(closing).toMatchObject({
      kind: 'saving', draft: 'Local draft', pendingIntent: { kind: 'close' },
    });
    expect(transitionWorkItemDetail(closing, { type: 'submit' })).toBe(closing);
  });

  it('keeps the draft and pending intent on validation, temporary failure, and conflict', () => {
    const editing = dirty();
    const invalid = transitionWorkItemDetail(editing, {
      type: 'validation-failed', message: 'Required', intent: { kind: 'close' },
    });
    expect(invalid).toMatchObject({
      kind: 'editing', draft: 'Local draft', error: 'Required', pendingIntent: { kind: 'close' },
    });
    const saving = transitionWorkItemDetail(invalid, { type: 'retry' });
    const failed = transitionWorkItemDetail(saving, { type: 'save-failed', message: 'Temporary failure' });
    expect(failed).toMatchObject({
      kind: 'editing', draft: 'Local draft', error: 'Temporary failure', pendingIntent: { kind: 'close' },
    });
    const latest = { ...confirmed, workItem: { ...workItem, title: 'Concurrent title', version: 5 } };
    const conflict = transitionWorkItemDetail(
      transitionWorkItemDetail(failed, { type: 'retry' }),
      { type: 'conflict', confirmed: latest },
    );
    expect(conflict).toMatchObject({
      kind: 'conflict', draft: 'Local draft', confirmed: latest, pendingIntent: { kind: 'close' },
    });
    expect(transitionWorkItemDetail(conflict, { type: 'retry' })).toMatchObject({
      kind: 'saving', draft: 'Local draft', confirmed: latest, pendingIntent: { kind: 'close' },
    });
    expect(transitionWorkItemDetail(conflict, { type: 'use-latest' }).kind).toBe('closed');
  });

  it.each(['close', 'switch'] as const)('resumes %s exactly once after validation, failure, conflict and successful retry', kind => {
    const intent = kind === 'close' ? { kind } as const : { kind, field: 'description' } as const;
    let state = transitionWorkItemDetail(dirty(), { type: 'submit', intent });
    state = transitionWorkItemDetail(state, { type: 'validation-failed', message: 'Invalid' });
    state = transitionWorkItemDetail(state, { type: 'retry' });
    state = transitionWorkItemDetail(state, { type: 'save-failed', message: 'Unavailable' });
    state = transitionWorkItemDetail(state, { type: 'retry' });
    state = transitionWorkItemDetail(state, { type: 'conflict', confirmed });
    state = transitionWorkItemDetail(state, { type: 'retry' });
    const saved = transitionWorkItemDetail(state, { type: 'saved', confirmed });
    expect(saved).toMatchObject(kind === 'close' ? { kind: 'closed' } : { kind: 'editing', field: 'description', dirty: false });
    expect(transitionWorkItemDetail(saved, { type: 'saved', confirmed })).toBe(saved);
  });

  it('keeps the saving snapshot immune to blur, Escape, drafts, or repeated submits', () => {
    const saving = transitionWorkItemDetail(dirty(), { type: 'submit' });
    expect(saving.kind).toBe('saving');
    expect(transitionWorkItemDetail(saving, { type: 'blur' })).toBe(saving);
    expect(transitionWorkItemDetail(saving, { type: 'escape' })).toBe(saving);
    expect(
      transitionWorkItemDetail(saving, { type: 'draft', value: 'Another draft' }),
    ).toBe(saving);
    expect(transitionWorkItemDetail(saving, { type: 'submit' })).toBe(saving);
  });

  it('accepts revised title and description drafts while recovering from a conflict', () => {
    const latest = {
      ...confirmed,
      workItem: { ...workItem, title: 'Concurrent title', version: 6 },
    };
    const titleConflict = transitionWorkItemDetail(
      transitionWorkItemDetail(dirty('title'), { type: 'submit' }),
      { type: 'conflict', confirmed: latest },
    );
    const revisedTitle = transitionWorkItemDetail(titleConflict, {
      type: 'draft', value: 'Revised after conflict',
    });
    expect(revisedTitle).toMatchObject({
      kind: 'conflict',
      field: 'title',
      draft: 'Revised after conflict',
      dirty: true,
      confirmed: latest,
    });
    expect(transitionWorkItemDetail(revisedTitle, { type: 'retry' })).toMatchObject({
      kind: 'saving',
      draft: 'Revised after conflict',
      confirmed: latest,
    });

    const descriptionConflict = transitionWorkItemDetail(
      transitionWorkItemDetail(dirty('description', 'Local description'), { type: 'submit' }),
      { type: 'conflict', confirmed },
    );
    expect(transitionWorkItemDetail(descriptionConflict, {
      type: 'draft', value: 'Revised description',
    })).toMatchObject({
      kind: 'conflict',
      field: 'description',
      draft: 'Revised description',
      dirty: true,
    });
  });

  it('preserves the local draft, field, labels and pending intent while entering conflict', () => {
    const saving = transitionWorkItemDetail(dirty(), {
      type: 'submit',
      intent: { kind: 'close' },
    });
    const latest = {
      ...confirmed,
      workItem: { ...workItem, title: 'Concurrent title', version: 6 },
    };
    const conflict = transitionWorkItemDetail(saving, {
      type: 'conflict',
      confirmed: latest,
    });
    expect(conflict).toMatchObject({
      kind: 'conflict',
      field: 'title',
      draft: 'Local draft',
      dirty: true,
      confirmed: latest,
      pendingIntent: { kind: 'close' },
    });
  });

  it('reuses one save snapshot across rapid field edits and a close before settle', () => {
    let state = dirty('title', 'Draft A');
    state = transitionWorkItemDetail(state, { type: 'edit', field: 'description' });
    expect(state).toMatchObject({
      kind: 'saving',
      field: 'title',
      draft: 'Draft A',
      pendingIntent: { kind: 'switch', field: 'description' },
    });
    state = transitionWorkItemDetail(state, { type: 'edit', field: 'title' });
    state = transitionWorkItemDetail(state, { type: 'request-close' });
    expect(state).toMatchObject({
      kind: 'saving',
      field: 'title',
      draft: 'Draft A',
      pendingIntent: { kind: 'close' },
    });
  });

  it('does not submit Enter while an input-method composition is active', () => {
    const editing = dirty('title');
    const composing = transitionWorkItemDetail(editing, { type: 'composition-start' });
    expect(composing).toMatchObject({ kind: 'editing', composition: true });
    expect(transitionWorkItemDetail(composing, { type: 'submit' })).toBe(composing);
    const settled = transitionWorkItemDetail(composing, { type: 'composition-end' });
    expect(settled).toMatchObject({ kind: 'editing', composition: false });
    expect(transitionWorkItemDetail(settled, { type: 'submit' })).toMatchObject({
      kind: 'saving',
      draft: 'Local draft',
    });
  });

  it('ignores late reads after another Card opens or the detail closes', () => {
    const first = transitionWorkItemDetail(initialWorkItemDetailState, {
      type: 'open', token: 1, boardId: board.boardId, workItemId: workItem.workItemId,
    });
    const second = transitionWorkItemDetail(first, {
      type: 'open', token: 2, boardId: board.boardId, workItemId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    });
    expect(transitionWorkItemDetail(second, { type: 'loaded', token: 1, confirmed })).toBe(second);
    const closed = transitionWorkItemDetail(second, { type: 'request-close' });
    expect(closed.kind).toBe('closed');
    expect(transitionWorkItemDetail(closed, { type: 'loaded', token: 2, confirmed })).toBe(closed);
  });
});
