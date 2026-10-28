export type WorkGraphTone = 'action' | 'agent' | 'human' | 'review' | 'danger' | 'focus';

export type WorkGraphConfig = {
  readonly cellSizePx: number;
  readonly trailLength: number;
  readonly enterDurationMs: number;
  readonly activeDurationRangeMs: readonly [min: number, max: number];
  readonly exitDurationMs: number;
  readonly pathStaggerMaxMs: number;
  readonly tones: readonly WorkGraphTone[];
  readonly symbols: readonly string[];
  readonly allowDynamicFeedback: boolean;
};

export const loginWorkGraphConfig: WorkGraphConfig = {
  cellSizePx: 16,
  trailLength: 30,
  enterDurationMs: 100,
  activeDurationRangeMs: [100, 400],
  exitDurationMs: 100,
  pathStaggerMaxMs: 72,
  tones: ['action', 'agent', 'human', 'review', 'danger', 'focus'],
  symbols: ['', '', '', '', '', '', '>', '<', '=', '+', '-', '/', '\\', ':', '*', '(', ')', '[', ']'],
  allowDynamicFeedback: true,
};
