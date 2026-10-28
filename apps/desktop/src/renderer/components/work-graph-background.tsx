import { useEffect, useMemo, useRef, useSyncExternalStore, type CSSProperties, type RefObject } from 'react';

import type { WorkGraphConfig } from './work-graph-config';

type GridCell = {
  readonly column: number;
  readonly row: number;
  readonly enteredAt: number;
};

type GridPosition = Pick<GridCell, 'column' | 'row'>;

export function WorkGraphBackground({ config }: { config: WorkGraphConfig }) {
  const root = useRef<HTMLDivElement | null>(null);
  const trailElements = useRef(new Map<number, HTMLElement>());
  const dynamicFeedback = useDynamicFeedback(config.allowDynamicFeedback);
  const trailSlots = useMemo(
    () => Array.from({ length: config.trailLength }, (_, index) => ({
      index,
      tone: config.tones[index % config.tones.length] ?? 'action',
    })),
    [config.tones, config.trailLength],
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
        {trailSlots.map(({ index, tone }) => (
          <i
            key={index}
            ref={(element) => {
              if (element) trailElements.current.set(index, element);
              else trailElements.current.delete(index);
            }}
            className={`work-graph__trail-cell work-graph__trail-cell--${tone}`}
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

      cells = cells.filter((cell) => timestamp - cell.enteredAt < config.trailLifetimeMs);
      const firstVisibleSlot = Math.max(0, config.trailLength - cells.length);

      trailElements.current.forEach((trailElement, index) => {
        const cell = cells[index - firstVisibleSlot];
        if (!cell) {
          hideTrailCell(trailElement);
          return;
        }

        const age = Math.max(0, timestamp - cell.enteredAt);
        const freshness = clamp(1 - age / config.trailLifetimeMs);
        const sequence = cells.length <= 1 ? 1 : (index - firstVisibleSlot + 1) / cells.length;
        const opacity = Math.pow(freshness, 1.35) * (0.28 + sequence * 0.72);
        const scale = 0.62 + Math.min(1, opacity) * 0.38;
        trailElement.style.left = `${cell.column * config.cellSizePx + 1}px`;
        trailElement.style.top = `${cell.row * config.cellSizePx + 1}px`;
        trailElement.style.opacity = `${round(opacity)}`;
        trailElement.style.transform = `scale(${round(scale)})`;
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
      for (const sample of sampled) {
        const previous = cells.at(-1);
        if (previous?.column === sample.column && previous.row === sample.row) continue;
        cells.push({ ...sample, enteredAt: now });
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
  }, [config.cellSizePx, config.trailLifetimeMs, config.trailLength, enabled, root, trailElements]);
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
  element.dataset.visible = 'false';
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
