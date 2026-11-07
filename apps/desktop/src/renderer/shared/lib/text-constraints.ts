export const PRODUCT_TEXT_LIMITS = {
  displayName: 80,
  projectName: 100,
  projectDescription: 1_000,
  boardName: 80,
  boardDescription: 1_000,
  columnName: 50,
  workItemTitle: 160,
  workItemDescription: 5_000,
} as const;

export function normalizePersistedText(value: string): string {
  return value.trim().normalize('NFC');
}

export function normalizedCodePointLength(value: string): number {
  return [...normalizePersistedText(value)].length;
}

export type TextEditSession = Readonly<{
  productLimit: number;
  ceiling: number;
  authoritativeValue: string;
}>;

export function createTextEditSession(authoritativeValue: string, productLimit: number): TextEditSession {
  return {
    productLimit,
    ceiling: Math.max(productLimit, normalizedCodePointLength(authoritativeValue)),
    authoritativeValue,
  };
}

export type TextCandidateDecision = Readonly<{
  accepted: boolean;
  count: number;
  atLimit: boolean;
  withinProductLimit: boolean;
}>;

export function evaluateTextCandidate(candidate: string, session: TextEditSession): TextCandidateDecision {
  const count = normalizedCodePointLength(candidate);
  return {
    accepted: count <= session.ceiling,
    count,
    atLimit: count >= session.productLimit,
    withinProductLimit: count <= session.productLimit,
  };
}

export function shouldShowCharacterCount(count: number, session: TextEditSession): boolean {
  return session.ceiling > session.productLimit || count >= Math.ceil(session.productLimit * 0.8);
}
