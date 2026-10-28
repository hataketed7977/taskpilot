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
    expect(cells.at(-1)?.style.left).toBe('112px');
    expect(cells.at(-1)?.style.top).toBe('64px');
    expect(graph.style.getPropertyValue('--work-graph-active')).toBe('1');
    expect(frames.pending()).toBe(1);
  });

  it('assigns random tone and optional symbols per record without changing them on later frames', async () => {
    installMatchMedia(enabledMedia);
    const frames = installAnimationFrame();
    mountWorkGraph();

    const brandPanel = screen.getByTestId('brand-panel');
    vi.spyOn(brandPanel, 'getBoundingClientRect').mockReturnValue(rect());
    vi.spyOn(performance, 'now').mockReturnValue(100);
    const randomValues = [
      0, 0, 0,
      0.5, 0.4, 0.9,
      0.6, 0.8, 0.7,
    ];
    let randomIndex = 0;
    vi.spyOn(Math, 'random').mockImplementation(
      () => randomValues[randomIndex++ % randomValues.length] ?? 0,
    );

    fireEvent.pointerMove(brandPanel, { clientX: 17, clientY: 17 });
    fireEvent.pointerMove(brandPanel, { clientX: 49, clientY: 17 });

    const cells = visibleCells();
    expect(new Set(cells.map((cell) => cell.dataset.tone)).size).toBeGreaterThan(1);
    expect(cells.some((cell) => cell.dataset.symbol === '')).toBe(true);
    expect(cells.some((cell) => cell.dataset.symbol !== '')).toBe(true);
    const attributes = cells.map((cell) => ({
      left: cell.style.left,
      tone: cell.dataset.tone,
      symbol: cell.dataset.symbol,
      text: cell.textContent,
    }));

    act(() => frames.flush(180));

    expect(visibleCells().map((cell) => ({
      left: cell.style.left,
      tone: cell.dataset.tone,
      symbol: cell.dataset.symbol,
      text: cell.textContent,
    }))).toEqual(attributes);
  });

  it('stagger-interpolates skipped cells and gives each cell a visible grow, hold, and shrink phase', async () => {
    installMatchMedia(enabledMedia);
    const frames = installAnimationFrame();
    mountWorkGraph();

    const brandPanel = screen.getByTestId('brand-panel');
    vi.spyOn(brandPanel, 'getBoundingClientRect').mockReturnValue(rect());
    const now = vi.spyOn(performance, 'now').mockReturnValueOnce(100).mockReturnValueOnce(200);
    const randomValues = [1 / 3, 0.2, 0.1];
    let randomIndex = 0;
    vi.spyOn(Math, 'random').mockImplementation(
      () => randomValues[randomIndex++ % randomValues.length] ?? 0,
    );

    fireEvent.pointerMove(brandPanel, { clientX: 17, clientY: 17 });
    fireEvent.pointerMove(brandPanel, { clientX: 145, clientY: 17 });
    expect(now).toHaveBeenCalledTimes(2);

    const interpolated = visibleCells().slice(-8);
    expect(interpolated).toHaveLength(8);
    expect(new Set(interpolated.map((cell) => cell.style.transform)).size).toBeGreaterThan(2);
    expect(Number.parseFloat(interpolated.at(-1)?.style.opacity ?? '1')).toBeLessThan(0.01);
    expect(Number.parseFloat(interpolated.at(-1)?.style.transform.slice(6) ?? '1')).toBeLessThan(0.01);

    act(() => frames.flush(250));
    const growingScale = Number.parseFloat(visibleCells().at(-1)?.style.transform.slice(6) ?? '0');
    expect(growingScale).toBeGreaterThan(0.5);
    expect(growingScale).toBeLessThan(1);

    act(() => frames.flush(300));
    expect(visibleCells().at(-1)?.style.transform).toBe('scale(1)');
    expect(visibleCells().at(-1)?.style.opacity).toBe('1');

    act(() => frames.flush(350));
    expect(visibleCells().at(-1)?.style.transform).toBe('scale(1)');
    expect(visibleCells().at(-1)?.style.opacity).toBe('1');

    act(() => frames.flush(450));
    expect(Number.parseFloat(visibleCells().at(-1)?.style.transform.slice(6) ?? '1')).toBeLessThan(0.5);
    expect(visibleCells().at(-1)?.style.opacity).toBe('1');

    act(() => frames.flush(490));
    expect(Number.parseFloat(visibleCells().at(-1)?.style.opacity ?? '1')).toBeLessThan(0.2);
    expect(Number.parseFloat(visibleCells().at(-1)?.style.transform.slice(6) ?? '1')).toBeLessThan(0.1);
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
    vi.spyOn(Math, 'random').mockReturnValue(0);
    fireEvent.pointerMove(brandPanel, { clientX: 33, clientY: 33 });
    expect(frames.pending()).toBe(1);

    const shortestActiveDuration = loginWorkGraphConfig.activeDurationRangeMs[0];
    act(() => frames.flush(100 + shortestActiveDuration + loginWorkGraphConfig.exitDurationMs + 1));

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
