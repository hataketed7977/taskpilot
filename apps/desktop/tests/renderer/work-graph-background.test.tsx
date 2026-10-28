// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkGraphBackground } from '../../src/renderer/components/work-graph-background';
import { loginWorkGraphConfig } from '../../src/renderer/components/work-graph-config';

const enabledMedia = {
  '(pointer: fine)': true,
  '(prefers-reduced-motion: reduce)': false,
  '(min-width: 761px)': true,
};

function installMatchMedia(matches: Record<string, boolean>) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn((query: string): MediaQueryList => ({
      matches: matches[query] ?? false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

function installAnimationFrame() {
  let nextFrameId = 1;
  const callbacks = new Map<number, FrameRequestCallback>();
  const request = vi.fn((callback: FrameRequestCallback) => {
    const frameId = nextFrameId++;
    callbacks.set(frameId, callback);
    return frameId;
  });
  const cancel = vi.fn((frameId: number) => callbacks.delete(frameId));
  Object.defineProperty(window, 'requestAnimationFrame', { configurable: true, writable: true, value: request });
  Object.defineProperty(window, 'cancelAnimationFrame', { configurable: true, writable: true, value: cancel });
  return {
    request,
    cancel,
    pending: () => callbacks.size,
    flush: (timestamp: number) => {
      const pending = [...callbacks.values()];
      callbacks.clear();
      pending.forEach((callback) => callback(timestamp));
    },
  };
}

function mountWorkGraph() {
  return render(
    <div data-testid="brand-panel">
      <WorkGraphBackground config={loginWorkGraphConfig} />
    </div>,
  );
}

function rect(): DOMRect {
  return {
    x: 0, y: 0, left: 0, top: 0, width: 400, height: 200, right: 400, bottom: 200,
    toJSON: () => ({}),
  };
}

function visibleCells() {
  return screen.getAllByTestId('work-graph-trail-cell').filter((cell) => cell.dataset.visible === 'true');
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('WorkGraphBackground', () => {
  it('renders an inert static grid without an autonomous particle loop', async () => {
    installMatchMedia(enabledMedia);
    const frames = installAnimationFrame();
    mountWorkGraph();

    const graph = await screen.findByTestId('work-graph-background');
    expect(graph).toHaveAttribute('aria-hidden', 'true');
    expect(graph).toHaveAttribute('data-dynamic-feedback', 'enabled');
    expect(graph).toHaveAttribute('data-flow-mode', 'pointer-trail');
    expect(graph).not.toHaveAttribute('tabindex');
    expect(screen.getAllByTestId('work-graph-trail-cell')).toHaveLength(loginWorkGraphConfig.trailLength);
    expect(visibleCells()).toHaveLength(0);
    expect(frames.request).not.toHaveBeenCalled();
  });

  it('snaps pointer movement to the grid and fills skipped cells as a visible trail', async () => {
    installMatchMedia(enabledMedia);
    const frames = installAnimationFrame();
    mountWorkGraph();

    const graph = await screen.findByTestId('work-graph-background');
    const brandPanel = screen.getByTestId('brand-panel');
    vi.spyOn(brandPanel, 'getBoundingClientRect').mockReturnValue(rect());
    const now = vi.spyOn(performance, 'now').mockReturnValueOnce(100).mockReturnValueOnce(120);
    await waitFor(() => expect(graph).toHaveAttribute('data-flow-mode', 'pointer-trail'));

    fireEvent.pointerMove(brandPanel, { clientX: 33, clientY: 33 });
    fireEvent.pointerMove(brandPanel, { clientX: 113, clientY: 65 });
    expect(now).toHaveBeenCalledTimes(2);

    const cells = visibleCells();
    expect(cells.length).toBeGreaterThan(5);
    expect(cells.at(-1)?.style.left).toBe('113px');
    expect(cells.at(-1)?.style.top).toBe('65px');
    expect(graph.style.getPropertyValue('--work-graph-active')).toBe('1');
    expect(frames.pending()).toBe(1);
  });

  it('does not add another cell while the pointer remains inside the same grid cell', async () => {
    installMatchMedia(enabledMedia);
    installAnimationFrame();
    mountWorkGraph();

    const brandPanel = screen.getByTestId('brand-panel');
    vi.spyOn(brandPanel, 'getBoundingClientRect').mockReturnValue(rect());
    vi.spyOn(performance, 'now').mockReturnValue(100);
    fireEvent.pointerMove(brandPanel, { clientX: 33, clientY: 33 });
    const initial = visibleCells().length;
    fireEvent.pointerMove(brandPanel, { clientX: 39, clientY: 38 });
    expect(visibleCells()).toHaveLength(initial);
  });

  it('fades the trail completely and stops scheduling frames after the configured lifetime', async () => {
    installMatchMedia(enabledMedia);
    const frames = installAnimationFrame();
    mountWorkGraph();

    const graph = await screen.findByTestId('work-graph-background');
    const brandPanel = screen.getByTestId('brand-panel');
    vi.spyOn(brandPanel, 'getBoundingClientRect').mockReturnValue(rect());
    vi.spyOn(performance, 'now').mockReturnValue(100);
    fireEvent.pointerMove(brandPanel, { clientX: 33, clientY: 33 });
    expect(frames.pending()).toBe(1);

    act(() => frames.flush(100 + loginWorkGraphConfig.trailLifetimeMs + 1));

    expect(visibleCells()).toHaveLength(0);
    expect(graph.style.getPropertyValue('--work-graph-active')).toBe('0');
    expect(frames.pending()).toBe(0);
  });

  it('clears the trail on blur and cancels pending animation work on unmount', async () => {
    installMatchMedia(enabledMedia);
    const frames = installAnimationFrame();
    const { unmount } = mountWorkGraph();

    const brandPanel = screen.getByTestId('brand-panel');
    vi.spyOn(brandPanel, 'getBoundingClientRect').mockReturnValue(rect());
    vi.spyOn(performance, 'now').mockReturnValue(100);
    fireEvent.pointerMove(brandPanel, { clientX: 33, clientY: 33 });
    expect(frames.pending()).toBe(1);

    act(() => window.dispatchEvent(new Event('blur')));
    expect(visibleCells()).toHaveLength(0);
    expect(frames.pending()).toBe(0);
    expect(frames.cancel).toHaveBeenCalled();

    fireEvent.pointerMove(brandPanel, { clientX: 65, clientY: 65 });
    unmount();
    expect(frames.pending()).toBe(0);
  });

  it.each([
    ['reduced motion', { ...enabledMedia, '(prefers-reduced-motion: reduce)': true }],
    ['coarse pointer', { ...enabledMedia, '(pointer: fine)': false }],
    ['narrow hidden brand panel', { ...enabledMedia, '(min-width: 761px)': false }],
  ])('keeps the pointer trail disabled for %s', async (_label, media) => {
    installMatchMedia(media);
    const frames = installAnimationFrame();
    mountWorkGraph();

    const graph = await screen.findByTestId('work-graph-background');
    const brandPanel = screen.getByTestId('brand-panel');
    vi.spyOn(brandPanel, 'getBoundingClientRect').mockReturnValue(rect());
    await waitFor(() => expect(graph).toHaveAttribute('data-flow-mode', 'static'));
    fireEvent.pointerMove(brandPanel, { clientX: 120, clientY: 80 });

    expect(visibleCells()).toHaveLength(0);
    expect(frames.request).not.toHaveBeenCalled();
  });
});
