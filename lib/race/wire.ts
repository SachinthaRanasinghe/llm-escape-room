import type { ComparisonData } from '@/lib/comparison';
import type { RendererSnapshot, ReplayBeat, ReplayData, SceneLayout } from '@/lib/replay';
import type { EndReason, Provider } from '@/lib/schema/run';

/**
 * What crosses the wire between the race page and `/api/*` — types only.
 *
 * The one file of `lib/race` the browser may import: `lib/race/index.ts` holds
 * the keys' call path, and `secrets.test.ts` keeps it out of `components/`.
 * Everything here is plain data the server has already reduced to what a viewer
 * may see — model ids and counts, never a key, an endpoint or the room.
 */

export interface CatalogueEntry {
  readonly modelId: string;
  readonly label: string;
  readonly contextWindow: number | null;
  /** USD per million tokens, from the provider's live listing. `null` for a free model. */
  readonly price: { readonly promptPerMTok: number; readonly completionPerMTok: number } | null;
}

export interface ProviderCatalogue {
  readonly provider: Provider;
  readonly name: string;
  /** The environment variable to set — a name, never a value. */
  readonly keyVar: string;
  readonly keySet: boolean;
  readonly models: readonly CatalogueEntry[];
  readonly excluded: readonly { readonly modelId: string; readonly reason: string }[];
  /** Why the live listing failed, when it did. Already redacted. */
  readonly error: string | null;
}

export interface RoomOption {
  readonly id: string;
  readonly label: string;
}

export interface CatalogueResponse {
  readonly providers: readonly ProviderCatalogue[];
  readonly rooms: readonly RoomOption[];
  readonly maxRepeats: number;
  readonly defaultRepeats: number;
  /**
   * The public, hosted race (`PUBLIC_RACE=1`): free models only, rate-limited,
   * nothing saved. The page drops its `.env` and publish hints, and follows the
   * race by polling `GET /api/race/<id>` instead of reading one long stream.
   */
  readonly hosted: boolean;
}

/** `POST /api/race` on the hosted site: the race was queued; follow it at `GET /api/race/<raceId>`. */
export interface HostedRaceStarted {
  readonly raceId: string;
}

/** `GET /api/race/<raceId>?from=<n>`: the race's messages from index `n` on. */
export interface HostedRacePoll {
  readonly messages: readonly RaceMessage[];
  /** Index to ask for next. */
  readonly next: number;
  /** True once a `done` or `error` message has been sent: stop polling. */
  readonly finished: boolean;
}

export interface ModelPick {
  readonly provider: Provider;
  readonly modelId: string;
}

export interface RaceRequest {
  readonly a: ModelPick;
  readonly b: ModelPick;
  readonly roomId: string;
  readonly repeats: number;
}

export type RacePhase = { readonly kind: 'hero' } | { readonly kind: 'repeat'; readonly index: number; readonly of: number };

/** One line of the `/api/race` NDJSON stream. */
export type RaceMessage =
  | {
      readonly type: 'started';
      readonly runId: string;
      readonly roomLabel: string;
      readonly competitors: readonly { readonly id: string; readonly provider: Provider; readonly modelId: string }[];
      readonly budget: { readonly maxActions: number };
      readonly repeats: number;
      /** The room's public projection — what the published replay carries, never the spec. */
      readonly layout: SceneLayout;
      /** How the live scene is drawn: the current renderer. */
      readonly renderer: RendererSnapshot;
    }
  | { readonly type: 'phase'; readonly phase: RacePhase }
  /** A model call returned. `actions` counts this competitor's calls in the current phase. */
  | { readonly type: 'action'; readonly competitorId: string; readonly actions: number }
  | { readonly type: 'dropped'; readonly index: number }
  /**
   * One action of the MAIN run, the moment the room judged it — what plays live.
   * `ended` is set on the action that ended this competitor's run. The silent
   * repeats send no beats: they are never watched.
   */
  | { readonly type: 'beat'; readonly competitorId: string; readonly beat: ReplayBeat; readonly ended: EndReason | null }
  /**
   * The main run's result, the moment it ends — before the silent repeats run —
   * so the page can show it at once. Final except for its variance statement,
   * which says the repeats are still running; `done` carries the settled one.
   */
  | { readonly type: 'result'; readonly comparison: ComparisonData }
  | {
      readonly type: 'done';
      readonly runId: string;
      /** Relative to the repo root, e.g. `runs/race-…`. `null` on the hosted site, which saves nothing. */
      readonly savedTo: string | null;
      /** The CLI line that publishes this run to `/run/<id>`. `null` when nothing was saved. */
      readonly publishCommand: string | null;
      readonly data: ReplayData;
      readonly renderer: RendererSnapshot;
      readonly comparison: ComparisonData;
      readonly providerCalls: number;
      readonly unpriced: readonly string[];
    }
  | {
      readonly type: 'error';
      readonly message: string;
      readonly savedTo: string | null;
      /**
       * When a provider stopped the MAIN run part-way: the results so far, in the
       * finished race's table, with no winner. `null` for anything else.
       */
      readonly comparison: ComparisonData | null;
    };
