/**
 * Does a full publishable matchup fit the free tier? — TICKET-7 (#8).
 *
 * `architecture.md` → Spikes · 2: extrapolate calls and tokens for one hero run
 * plus its silent repeats plus the rejected generation candidates, and compare
 * with free-tier quota. If it does not fit, cut in this order — repeat count,
 * then generation retries, then puzzle chain length. The 60–90 second watch
 * target is cut LAST, which here means NEVER: it is not a quota lever at all
 * (the replay paces on beats, not on wall clock), so no cut below touches it.
 *
 * ── Unknown is not "fits" ──────────────────────────────────────────────────
 * Gemini publishes no free-tier numbers; they are per project in AI Studio. A
 * limit this table does not know is `null`, and any model whose verdict needs a
 * `null` gets `'unknown'` — never `true`. A quota verdict that guesses is the
 * failure this spike exists to prevent.
 *
 * ── The model is an approximation, and says so ─────────────────────────────
 * Cost scales linearly: duels by count, duel tokens by chain length, generation
 * cost by how many attempts the cap still allows. Real prompt tokens grow with
 * the transcript, so a shorter chain saves somewhat MORE than linear; the
 * estimate errs toward not fitting.
 */

export interface Limits {
  readonly rpm: number | null;
  readonly rpd: number | null;
  readonly tpm: number | null;
  readonly tpd: number | null;
  /** Where the numbers came from, and when they were read. Data, not an endpoint. */
  readonly source: string;
  readonly readOn: string;
}

const GROQ_FREE = {
  rpm: 30,
  rpd: 1_000,
  tpm: 8_000,
  tpd: 200_000,
  source: 'https://console.groq.com/docs/rate-limits (Free Plan Limits)',
  readOn: '2026-09-23',
} as const;

/** Keyed by `provider/modelId` (`modelKeyOf`). Re-read the source before trusting an old verdict. */
export const FREE_TIER_LIMITS: Readonly<Record<string, Limits>> = {
  'groq/openai/gpt-oss-120b': GROQ_FREE,
  'groq/openai/gpt-oss-20b': GROQ_FREE,
  'gemini/gemini-flash-latest': {
    rpm: null,
    rpd: null,
    tpm: null,
    tpd: null,
    source: 'https://ai.google.dev/gemini-api/docs/rate-limits (no numbers published; see AI Studio)',
    readOn: '2026-09-23',
  },
};

/** What the spike measured, per matchup ingredient. All means. */
export interface Measured {
  /** Per competitor model, for ONE duel. */
  readonly duel: Readonly<Record<string, { readonly calls: number; readonly tokens: number }>>;
  readonly generation: {
    readonly modelKey: string;
    /** Every attempt's cost, spread over the rooms that certified. */
    readonly callsPerRoom: number;
    readonly tokensPerRoom: number;
    /** Mean attempts per certified room (failed generations included). */
    readonly attemptsPerRoom: number;
  };
  readonly chainLength: number;
}

export interface MatchupConfig {
  readonly repeats: number;
  readonly maxAttempts: number;
  readonly chainLength: number;
}

export type Fit = true | false | 'unknown';

export interface ModelUsage {
  readonly calls: number;
  readonly tokens: number;
  readonly fits: Fit;
  /** Minimum wall clock one duel needs under this model's TPM; `null` if unknown or not a competitor. */
  readonly minDuelSeconds: number | null;
}

export interface MatchupEstimate {
  readonly config: MatchupConfig;
  readonly perModel: Readonly<Record<string, ModelUsage>>;
  readonly fits: Fit;
}

function fitOf(usage: { calls: number; tokens: number }, limits: Limits | undefined): Fit {
  if (limits === undefined || limits.rpd === null || limits.tpd === null) return 'unknown';
  return usage.calls <= limits.rpd && usage.tokens <= limits.tpd;
}

function combine(fits: readonly Fit[]): Fit {
  if (fits.includes(false)) return false;
  return fits.includes('unknown') ? 'unknown' : true;
}

/** One matchup's usage per model: one room generated, then (1 + repeats) duels on it. */
export function estimateMatchup(
  measured: Measured,
  config: MatchupConfig,
  limits: Readonly<Record<string, Limits>> = FREE_TIER_LIMITS,
): MatchupEstimate {
  const duels = 1 + config.repeats;
  const chainScale = config.chainLength / measured.chainLength;
  const g = measured.generation;
  const genScale = g.attemptsPerRoom === 0 ? 1 : Math.min(g.attemptsPerRoom, config.maxAttempts) / g.attemptsPerRoom;

  const usage = new Map<string, { calls: number; tokens: number; duelTokens: number }>();
  const add = (key: string, calls: number, tokens: number, duelTokens: number) => {
    const u = usage.get(key) ?? { calls: 0, tokens: 0, duelTokens: 0 };
    usage.set(key, { calls: u.calls + calls, tokens: u.tokens + tokens, duelTokens: u.duelTokens + duelTokens });
  };
  for (const [key, d] of Object.entries(measured.duel)) {
    const tokens = d.tokens * chainScale;
    add(key, d.calls * chainScale * duels, tokens * duels, tokens);
  }
  add(g.modelKey, g.callsPerRoom * genScale, g.tokensPerRoom * genScale, 0);

  const perModel: Record<string, ModelUsage> = {};
  for (const [key, u] of usage) {
    const calls = Math.ceil(u.calls);
    const tokens = Math.ceil(u.tokens);
    const tpm = limits[key]?.tpm ?? null;
    perModel[key] = {
      calls,
      tokens,
      fits: fitOf({ calls, tokens }, limits[key]),
      minDuelSeconds: u.duelTokens === 0 || tpm === null ? null : Math.ceil((u.duelTokens / tpm) * 60),
    };
  }
  return { config, perModel, fits: combine(Object.values(perModel).map((m) => m.fits)) };
}

export interface CutPlan {
  readonly start: MatchupEstimate;
  /** The first config with no model definitely over; the last one tried if none gets there. */
  readonly chosen: MatchupEstimate;
  /** Human-readable, in the order applied. Empty when the start config already fits. */
  readonly cuts: readonly string[];
}

export const DEFAULT_START: Omit<MatchupConfig, 'chainLength'> = { repeats: 3, maxAttempts: 5 };

/**
 * Walk the cut order until no model is definitely over its limits.
 *
 * Cutting stops on `'unknown'` as well as `true`: no cut changes a limit
 * nobody published, so cutting further would trade product for nothing.
 */
export function planCuts(
  measured: Measured,
  limits: Readonly<Record<string, Limits>> = FREE_TIER_LIMITS,
  start: MatchupConfig = { ...DEFAULT_START, chainLength: Math.round(measured.chainLength) },
): CutPlan {
  const first = estimateMatchup(measured, start, limits);
  let current = first;
  const cuts: string[] = [];
  const settled = () => current.fits !== false;

  const steps: { label: string; next: (c: MatchupConfig) => MatchupConfig | null }[] = [
    { label: 'repeats', next: (c) => (c.repeats > 0 ? { ...c, repeats: c.repeats - 1 } : null) },
    { label: 'generation retries', next: (c) => (c.maxAttempts > 2 ? { ...c, maxAttempts: c.maxAttempts === 5 ? 3 : 2 } : null) },
    { label: 'chain length', next: (c) => (c.chainLength > 2 ? { ...c, chainLength: c.chainLength - 1 } : null) },
  ];

  for (const step of steps) {
    while (!settled()) {
      const next = step.next(current.config);
      if (next === null) break;
      current = estimateMatchup(measured, next, limits);
      cuts.push(`${step.label} → ${step.label === 'repeats' ? next.repeats : step.label === 'chain length' ? next.chainLength : next.maxAttempts}`);
    }
    if (settled()) break;
  }
  return { start: first, chosen: current, cuts };
}
