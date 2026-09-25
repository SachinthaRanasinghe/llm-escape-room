/**
 * The published artifact — TICKET-9 (#9).
 *
 *   buildArtifact        a finished run + its room + a renderer → one frozen artifact
 *   replayFromArtifact   an artifact → the `ReplayData` and FROZEN renderer the player plays
 *   loadArtifact         `published/<id>.json` → a parsed artifact
 *   comparisonFromArtifact  an artifact → the post-run comparison's strings (TICKET-10, #10)
 *
 * SERVER- AND SCRIPT-SIDE ONLY. It reads the filesystem and value-imports the
 * schemas. The client never imports this: the `/run/[id]` server page calls it
 * and hands the player plain props (`lib/artifact/boundary.test.ts`).
 */
export {
  ARTIFACT_ERROR_REASONS,
  ARTIFACT_ID,
  ArtifactError,
  ArtifactSchemaError,
  parseArtifact,
  OutcomeSchema,
  PublishedArtifactSchema,
  RenderManifestSchema,
  RepeatsSchema,
  type ArtifactErrorReason,
  type PublishedArtifact,
  type RenderManifest,
  type RepeatRecord,
} from './schema';
export { buildRepeatRecord, checkRepeats, type RepeatInput } from './repeats';
export { findLeaks, LEAK_KINDS, type Leak, type LeakKind } from './scan';
export { buildArtifact, CANONICAL_PUBLISHED_AT, type BuildArtifactInput } from './publish';
export { replayFromArtifact, type FrozenReplay } from './replay';
export { comparisonFromArtifact } from './comparison';
export { artifactPath, listArtifactIds, loadArtifact, PUBLISHED_DIR } from './store';
