import {
  useCallback,
  useRef,
  useState,
  type ChangeEvent,
  type CompositionEvent,
} from 'react';
import {
  createTextEditSession,
  evaluateTextCandidate,
  normalizedCodePointLength,
  shouldShowCharacterCount,
} from '../lib/text-constraints';

export type BoundedTextOptions = Readonly<{
  authoritativeValue?: string;
  onAccepted?(value: string): void;
}>;

export type BoundedTextController = Readonly<{
  value: string;
  count: number;
  limit: number;
  ceiling: number;
  withinProductLimit: boolean;
  showCount: boolean;
  limitReached: boolean;
  setValue(value: string): boolean;
  inputProps: {
    value: string;
    onChange(event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>): void;
    onCompositionStart(): void;
    onCompositionEnd(event: CompositionEvent<HTMLInputElement | HTMLTextAreaElement>): void;
  };
}>;

export function useBoundedText(
  initialValue: string,
  productLimit: number,
  options: BoundedTextOptions = {},
): BoundedTextController {
  const { authoritativeValue, onAccepted } = options;
  const [session] = useState(() =>
    createTextEditSession(authoritativeValue ?? initialValue, productLimit),
  );
  const accepted = useRef(initialValue);
  const composing = useRef(false);
  const [value, updateValue] = useState(initialValue);
  const [rejectedAtLimit, setRejectedAtLimit] = useState(false);

  const acceptCandidate = useCallback((candidate: string) => {
    const decision = evaluateTextCandidate(candidate, session);
    if (!decision.accepted) {
      setRejectedAtLimit(true);
      updateValue(accepted.current);
      return false;
    }
    accepted.current = candidate;
    updateValue(candidate);
    setRejectedAtLimit(decision.atLimit);
    onAccepted?.(candidate);
    return true;
  }, [onAccepted, session]);

  const onChange = useCallback((event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const candidate = event.currentTarget.value;
    if (composing.current) {
      updateValue(candidate);
      return;
    }
    acceptCandidate(candidate);
  }, [acceptCandidate]);

  const onCompositionStart = useCallback(() => {
    composing.current = true;
  }, []);

  const onCompositionEnd = useCallback((event: CompositionEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    composing.current = false;
    acceptCandidate(event.currentTarget.value);
  }, [acceptCandidate]);

  const count = normalizedCodePointLength(value);
  const decision = evaluateTextCandidate(value, session);
  return {
    value,
    count,
    limit: productLimit,
    ceiling: session.ceiling,
    withinProductLimit: decision.withinProductLimit,
    showCount: shouldShowCharacterCount(count, session),
    limitReached: rejectedAtLimit || count >= productLimit,
    setValue: acceptCandidate,
    inputProps: { value, onChange, onCompositionStart, onCompositionEnd },
  };
}
