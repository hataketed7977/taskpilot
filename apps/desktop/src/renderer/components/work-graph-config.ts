export type WorkGraphTone = 'action' | 'agent' | 'human' | 'review';

export type WorkGraphConfig = {
  readonly cellSizePx: number;
  readonly trailLength: number;
  readonly trailLifetimeMs: number;
  readonly tones: readonly WorkGraphTone[];
  readonly allowDynamicFeedback: boolean;
};

export const loginWorkGraphConfig: WorkGraphConfig = {
  cellSizePx: 16,
  trailLength: 30,
  trailLifetimeMs: 620,
  tones: ['action', 'agent', 'human', 'review'],
  allowDynamicFeedback: true,
};
