/**
 * The published artifact — TICKET-9 (#9).
 *
 *   buildArtifact        a finished run + its room + a renderer → one frozen artifact
 *   replayFromArtifact   an artifact → the `ReplayData` and FROZEN renderer the player plays
 *   loadArtifact         `published/<id>.json` → a parsed artifact
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
  PublishedArtifactSchema,
  RenderManifestSchema,
  type ArtifactErrorReason,
  type PublishedArtifact,
  type RenderManifest,
} from './schema';
export { findLeaks, LEAK_KINDS, type Leak, type LeakKind } from './scan';
export { buildArtifact, CANONICAL_PUBLISHED_AT, type BuildArtifactInput } from './publish';
export { replayFromArtifact, type FrozenReplay } from './replay';
export { artifactPath, listArtifactIds, loadArtifact, PUBLISHED_DIR } from './store';
