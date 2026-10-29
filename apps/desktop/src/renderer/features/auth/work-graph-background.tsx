import { useEffect, useMemo, useRef, useSyncExternalStore, type CSSProperties, type RefObject } from 'react';

import type { WorkGraphConfig, WorkGraphTone } from './work-graph-config';

type GridCell = {
  readonly column: number;
  readonly row: number;
  readonly enteredAt: number;
  readonly activeDurationMs: number;
  readonly tone: WorkGraphTone;
  readonly symbol: string;
};

type GridPosition = Pick<GridCell, 'column' | 'row'>;

export function WorkGraphBackground({ config }: { config: WorkGraphConfig }) {
  const root = useRef<HTMLDivElement | null>(null);
  const trailElements = useRef(new Map<number, HTMLElement>());
  const dynamicFeedback = useDynamicFeedback(config.allowDynamicFeedback);
  const trailSlots = useMemo(
    () => Array.from({ length: config.trailLength }, (_, index) => index),
    [config.trailLength],
  );

  useGridTrail(root, trailElements, config, dynamicFeedback);

  return (
    <div
      ref={root}
      className="work-graph"
      data-testid="work-graph-background"
      aria-hidden="true"
      data-dynamic-feedback={dynamicFeedback ? 'enabled' : 'static'}
      data-flow-mode={dynamicFeedback ? 'pointer-trail' : 'static'}
      style={{ '--work-graph-cell': `${config.cellSizePx}px` } as CSSProperties}
    >
      <div className="work-graph__grid" />
      <div className="work-graph__trail" data-testid="work-graph-trail">
        {trailSlots.map((index) => (
          <i
            key={index}
            ref={(element) => {
              if (element) trailElements.current.set(index, element);
              else trailElements.current.delete(index);
            }}
            className="work-graph__trail-cell"
            data-testid="work-graph-trail-cell"
            data-visible="false"
          />
        ))}
      </div>
    </div>
  );
}

function useDynamicFeedback(allowed: boolean) {
  return useSyncExternalStore(
    (onStoreChange) => {
      if (!allowed || typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
        return () => undefined;
      }

      const finePointer = window.matchMedia('(pointer: fine)');
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
      const visibleBrandPanel = window.matchMedia('(min-width: 761px)');
      const unsubscribeFinePointer = subscribeMediaQuery(finePointer, onStoreChange);
      const unsubscribeReducedMotion = subscribeMediaQuery(reducedMotion, onStoreChange);
      const unsubscribeVisibleBrandPanel = subscribeMediaQuery(visibleBrandPanel, onStoreChange);
      return () => {
        unsubscribeFinePointer();
        unsubscribeReducedMotion();
        unsubscribeVisibleBrandPanel();
      };
    },
    () => readDynamicFeedbackSnapshot(allowed),
    () => false,
  );
}

function readDynamicFeedbackSnapshot(allowed: boolean) {
  if (!allowed || typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }

  return window.matchMedia('(pointer: fine)').matches
    && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    && window.matchMedia('(min-width: 761px)').matches;
}

function subscribeMediaQuery(query: MediaQueryList, listener: () => void) {
  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
}

function useGridTrail(
  root: RefObject<HTMLDivElement | null>,
  trailElements: RefObject<Map<number, HTMLElement>>,
  config: WorkGraphConfig,
  enabled: boolean,
) {
  const frame = useRef<number | undefined>(undefined);

  useEffect(() => {
    const element = root.current;
    const target = element?.parentElement;
    if (!element || !target) return undefined;

    let cells: GridCell[] = [];
    let lastCell: GridPosition | undefined;

    const cancelFrame = () => {
      if (frame.current === undefined) return;
      window.cancelAnimationFrame(frame.current);
      frame.current = undefined;
    };

    const clearTrail = () => {
      cells = [];
      lastCell = undefined;
      trailElements.current.forEach(hideTrailCell);
      element.style.setProperty('--work-graph-active', '0');
    };

    const drawTrail = (timestamp: number) => {
      frame.current = undefined;
      if (document.hidden) {
        clearTrail();
        return;
      }

      cells = cells.filter(
        (cell) => timestamp - cell.enteredAt < cell.activeDurationMs + config.exitDurationMs,
      );
      const firstVisibleSlot = Math.max(0, config.trailLength - cells.length);

      trailElements.current.forEach((trailElement, index) => {
        const cell = cells[index - firstVisibleSlot];
        if (!cell) {
          hideTrailCell(trailElement);
          return;
        }

        const age = Math.max(0, timestamp - cell.enteredAt);
        const { opacity, scale } = resolveCellMotion(age, cell.activeDurationMs, config);
        trailElement.style.left = `${cell.column * config.cellSizePx}px`;
        trailElement.style.top = `${cell.row * config.cellSizePx}px`;
        trailElement.style.opacity = `${round(opacity)}`;
        trailElement.style.transform = `scale(${round(scale)})`;
        trailElement.dataset.tone = cell.tone;
        trailElement.dataset.symbol = cell.symbol;
        trailElement.textContent = cell.symbol;
        trailElement.dataset.visible = 'true';
      });

      element.style.setProperty('--work-graph-active', cells.length > 0 ? '1' : '0');
      if (cells.length > 0) frame.current = window.requestAnimationFrame(drawTrail);
    };

    const onPointerMove = (event: PointerEvent) => {
      const bounds = target.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) return;

      const position = {
        column: Math.floor(clampRange(event.clientX - bounds.left, 0, bounds.width - 1) / config.cellSizePx),
        row: Math.floor(clampRange(event.clientY - bounds.top, 0, bounds.height - 1) / config.cellSizePx),
      };
      if (lastCell?.column === position.column && lastCell.row === position.row) return;

      const now = performance.now();
      const sampled = lastCell ? interpolateGridCells(lastCell, position) : [position];
      const staggerWindow = Math.min(
        config.pathStaggerMaxMs,
        Math.max(0, sampled.length - 1) * 12,
      );
      for (const [index, sample] of sampled.entries()) {
        const previous = cells.at(-1);
        if (previous?.column === sample.column && previous.row === sample.row) continue;
        const progress = (index + 1) / sampled.length;
        cells.push(createGridCell(sample, now - staggerWindow + staggerWindow * progress, config));
      }
      cells = cells.slice(-config.trailLength);
      lastCell = position;
      cancelFrame();
      drawTrail(now);
    };

    const onPointerLeave = () => {
      lastCell = undefined;
    };

    const onBlur = () => {
      cancelFrame();
      clearTrail();
    };

    const onVisibilityChange = () => {
      if (document.hidden) {
        cancelFrame();
        clearTrail();
      }
    };

    clearTrail();
    if (!enabled) return () => cancelFrame();

    target.addEventListener('pointermove', onPointerMove, { passive: true });
    target.addEventListener('pointerleave', onPointerLeave, { passive: true });
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      target.removeEventListener('pointermove', onPointerMove);
      target.removeEventListener('pointerleave', onPointerLeave);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      cancelFrame();
      clearTrail();
    };
  }, [config, enabled, root, trailElements]);
}

function createGridCell(position: GridPosition, enteredAt: number, config: WorkGraphConfig): GridCell {
  return {
    ...position,
    enteredAt,
    activeDurationMs: randomBetween(...config.activeDurationRangeMs),
    tone: pickRandom(config.tones, 'action'),
    symbol: pickRandom(config.symbols, ''),
  };
}

function pickRandom<T>(values: readonly T[], fallback: T): T {
  if (values.length === 0) return fallback;
  return values[Math.floor(Math.random() * values.length)] ?? fallback;
}

function randomBetween(min: number, max: number) {
  return min + Math.random() * Math.max(0, max - min);
}

function resolveCellMotion(age: number, activeDurationMs: number, config: WorkGraphConfig) {
  if (age < config.enterDurationMs) {
    const entered = githubTrailEase(clamp(age / config.enterDurationMs));
    return { opacity: clamp(entered), scale: entered };
  }
  if (age < activeDurationMs) return { opacity: 1, scale: 1 };

  const exitProgress = clamp((age - activeDurationMs) / config.exitDurationMs);
  const exiting = githubTrailEase(exitProgress);
  const fadeProgress = clamp((exitProgress - 0.55) / 0.45);
  return {
    opacity: 1 - smoothstep(fadeProgress),
    scale: clamp(1 - exiting),
  };
}

function interpolateGridCells(from: GridPosition, to: GridPosition): readonly GridPosition[] {
  const distance = Math.max(Math.abs(to.column - from.column), Math.abs(to.row - from.row));
  if (distance === 0) return [];

  return Array.from({ length: distance }, (_, index) => {
    const progress = (index + 1) / distance;
    return {
      column: Math.round(from.column + (to.column - from.column) * progress),
      row: Math.round(from.row + (to.row - from.row) * progress),
    };
  });
}

function hideTrailCell(element: HTMLElement) {
  element.style.opacity = '0';
  element.style.removeProperty('left');
  element.style.removeProperty('top');
  element.style.removeProperty('transform');
  element.removeAttribute('data-tone');
  element.removeAttribute('data-symbol');
  element.textContent = '';
  element.dataset.visible = 'false';
}

function githubTrailEase(progress: number) {
  return cubicBezierAtTime(progress, 0.3, 0.41, 0.04, 1.01);
}

function cubicBezierAtTime(progress: number, x1: number, y1: number, x2: number, y2: number) {
  let lower = 0;
  let upper = 1;
  let parameter = progress;

  for (let iteration = 0; iteration < 10; iteration += 1) {
    parameter = (lower + upper) / 2;
    const x = cubicBezierPoint(parameter, x1, x2);
    if (x < progress) lower = parameter;
    else upper = parameter;
  }

  return cubicBezierPoint(parameter, y1, y2);
}

function cubicBezierPoint(parameter: number, control1: number, control2: number) {
  const inverse = 1 - parameter;
  return 3 * inverse * inverse * parameter * control1
    + 3 * inverse * parameter * parameter * control2
    + parameter * parameter * parameter;
}

function smoothstep(value: number) {
  return value * value * (3 - 2 * value);
}

function round(value: number) {
  return Math.round(value * 1000) / 1000;
}

function clamp(value: number) {
  return clampRange(value, 0, 1);
}

function clampRange(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
