/**
 * The replay's pure core — layout, timeline, beats and room state.
 *
 * `testing.ts` is deliberately not re-exported: builders that value-import the
 * schemas have no business on the client.
 */
export type * from './types';
export { buildSceneLayout, ROOM_HALF } from './layout';
export { buildReplay, ReplayError, REPLAY_ERROR_REASONS, type ReplayErrorReason, type BuildReplayInput } from './timeline';
export {
  ACT_FRACTION,
  BEAT_MS,
  beatStartMs,
  INTRO_MS,
  isSettled,
  LANE_OFFSET_MS,
  laneAt,
  OUTRO_MS,
  planBeats,
  RENDERER_VERSION,
  WALK_FRACTION,
  WATCH_TARGET_MS,
} from './beats';
export { laneStateAt } from './roomState';
export {
  describeAction,
  describeEnd,
  END_LABEL,
  formatThink,
  NO_INTENT,
  REJECTION_LABEL,
  VERB_LABEL,
  VERDICT_TONE,
  type VerdictTone,
} from './labels';
