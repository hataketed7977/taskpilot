import { z } from 'zod';
import type { DesktopError, DesktopResult } from '../shared/contracts.js';
import { OutcomeUnknownError, TransportError } from './api/transport.js';

const categories = new Set<DesktopError['category']>([
  'validation', 'authentication', 'authorization', 'conflict', 'temporary', 'unknown',
]);
const recoveries = new Set<NonNullable<DesktopError['recovery']>>(['RETRY', 'SIGN_IN', 'CHOOSE_WORKSPACE']);

export function toDesktopError(error: unknown): DesktopError {
  if (error instanceof z.ZodError) return { code: 'IPC_INPUT_INVALID', category: 'validation' };
  if (error instanceof TransportError) return error.detail;
  if (error instanceof OutcomeUnknownError) return { code: 'REQUEST_RESULT_UNKNOWN', category: 'unknown', recovery: 'RETRY' };
  if (error instanceof TypeError || (error instanceof DOMException && error.name === 'AbortError')) {
    return { code: 'NETWORK_UNAVAILABLE', category: 'temporary', recovery: 'RETRY' };
  }
  if (typeof error === 'object' && error !== null) {
    const value = error as Record<string, unknown>;
    if (typeof value.code === 'string') {
      return {
        code: value.code,
        category: categories.has(value.category as DesktopError['category']) ? value.category as DesktopError['category'] : inferCategory(value.code),
        ...(typeof value.path === 'string' ? { path: value.path } : {}),
        ...(typeof value.retryAfterSeconds === 'number' ? { retryAfterSeconds: value.retryAfterSeconds } : {}),
        ...(recoveries.has(value.recovery as NonNullable<DesktopError['recovery']>) ? { recovery: value.recovery as NonNullable<DesktopError['recovery']> } : {}),
      };
    }
  }
  return { code: 'UNEXPECTED_DESKTOP_ERROR', category: 'unknown' };
}

function inferCategory(code: string): DesktopError['category'] {
  if (/AUTHENTICATION|CREDENTIAL|SESSION|CONTEXT_EXPIRED/.test(code)) return 'authentication';
  if (/FORBIDDEN|NOT_AUTHORIZED|POLICY/.test(code)) return 'authorization';
  if (/CONFLICT|IDEMPOTENCY/.test(code)) return 'conflict';
  if (/TEMPORAR|UNAVAILABLE|NETWORK|RATE_LIMIT/.test(code)) return 'temporary';
  if (/INVALID|VALIDATION|MISMATCH/.test(code)) return 'validation';
  return 'unknown';
}

export function unwrapDesktopResult<T>(result: DesktopResult<T>): T {
  if (result.ok) return result.value;
  throw result.error;
}
