import { vi } from 'vitest';
import type { BoardCapabilities, BoardProjectInput, BoardResponseKey } from '../../src/shared/contracts';

export function boardTestApi(key: Omit<BoardResponseKey, 'boardId' | 'boardGeneration'>): BoardCapabilities {
  const responseKey = (input: BoardProjectInput): BoardResponseKey => ({
    sessionGeneration: key.sessionGeneration,
    userId: key.userId,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
  });
  return {
    resolveHome: vi.fn().mockImplementation((input: BoardProjectInput) => Promise.resolve({ key: responseKey(input), value: { boards: [] } })),
    list: vi.fn().mockImplementation((input: BoardProjectInput) => Promise.resolve({ key: responseKey(input), value: [] })),
    open: vi.fn(), create: vi.fn(), edit: vi.fn(), permanentlyDelete: vi.fn(), createColumn: vi.fn(), editColumn: vi.fn(),
    reorderColumns: vi.fn(), deleteColumn: vi.fn(), createWorkItem: vi.fn(), openWorkItem: vi.fn(),
    editWorkItem: vi.fn(), moveCard: vi.fn(),
  };
}
