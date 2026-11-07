/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createTextEditSession,
  evaluateTextCandidate,
  normalizedCodePointLength,
  shouldShowCharacterCount,
} from '../../../../src/renderer/shared/lib/text-constraints';
import { useBoundedText } from '../../../../src/renderer/shared/ui/use-bounded-text';

afterEach(cleanup);

function Harness({ initial = '', limit = 4 }: { initial?: string; limit?: number }) {
  const field = useBoundedText(initial, limit);
  const undo = useRef(initial);
  return <>
    <input aria-label="name" {...field.inputProps} onBeforeInput={() => { undo.current = field.value; }} />
    <button type="button" onClick={() => field.setValue(undo.current)}>undo</button>
    <output>{field.count}:{String(field.limitReached)}:{String(field.withinProductLimit)}</output>
  </>;
}

describe('persisted text constraints', () => {
  it('counts trimmed NFC Unicode code points rather than UTF-16 units', () => {
    expect(normalizedCodePointLength('  e\u0301😀  ')).toBe(2);
    const session = createTextEditSession('', 2);
    expect(evaluateTextCandidate('é😀', session).accepted).toBe(true);
    expect(evaluateTextCandidate('é😀x', session).accepted).toBe(false);
  });

  it('shows a count from the 80 percent threshold and for historical values', () => {
    expect(shouldShowCharacterCount(7, createTextEditSession('', 10))).toBe(false);
    expect(shouldShowCharacterCount(8, createTextEditSession('', 10))).toBe(true);
    expect(shouldShowCharacterCount(1, createTextEditSession('historical', 4))).toBe(true);
  });

  it('accepts through the limit and atomically rejects typing, paste, and selection growth', () => {
    render(<Harness />);
    const input = screen.getByRole('textbox', { name: 'name' });
    fireEvent.change(input, { target: { value: '😀😀😀😀' } });
    expect(input).toHaveValue('😀😀😀😀');
    fireEvent.change(input, { target: { value: '😀😀😀😀x' } });
    expect(input).toHaveValue('😀😀😀😀');
    fireEvent.change(input, { target: { value: 'pasted-value' } });
    expect(input).toHaveValue('😀😀😀😀');
    fireEvent.change(input, { target: { value: 'ab' } });
    expect(input).toHaveValue('ab');
  });

  it('does not interfere with IME intermediates and rejects an oversized commit without slicing', () => {
    render(<Harness initial="ok" limit={2} />);
    const input = screen.getByRole('textbox', { name: 'name' });
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: '中文候' } });
    expect(input).toHaveValue('中文候');
    fireEvent.compositionEnd(input, { data: '中文候' });
    expect(input).toHaveValue('ok');
  });

  it('uses the initial historical length as a temporary ceiling while allowing convergence', () => {
    render(<Harness initial="abcdef" limit={4} />);
    const input = screen.getByRole('textbox', { name: 'name' });
    fireEvent.change(input, { target: { value: 'abcde' } });
    expect(input).toHaveValue('abcde');
    expect(screen.getByText('5:true:false')).toBeInTheDocument();
    fireEvent.change(input, { target: { value: 'abcdefg' } });
    expect(input).toHaveValue('abcde');
    fireEvent.change(input, { target: { value: 'abcd' } });
    expect(screen.getByText('4:true:true')).toBeInTheDocument();
  });
});
