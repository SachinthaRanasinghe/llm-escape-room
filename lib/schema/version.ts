import { z } from 'zod';

/**
 * THESE ARE v0 AND DELIBERATELY UNPINNED.
 *
 * `llm-escape-room.prd.md` names the room spec and the event log as one-way
 * doors: everything downstream depends on their shape and they are expensive to
 * change once runs exist. They cannot be designed well, though, until the gate
 * spike reports which puzzle substrate actually separates two models — so they
 * ship as v0 now and are promoted to v1 in TICKET-7 (#8), through
 * `lib/schema/migrations/`.
 *
 * Downstream tickets should expect exactly ONE migration. Code against v0
 * freely; do not build a version-tolerant reader in anticipation.
 *
 * TICKET-7 (#8) widened v0 IN PLACE during the spike — a `key` puzzle kind and a
 * `wrong_key` verdict — rather than bumping twice. That is what "unpinned" is
 * for: the one migration still happens once, after the spike reports.
 */
export const SPEC_VERSION = 0;

/**
 * Versioned separately from `SPEC_VERSION` on purpose: a change to how a room is
 * described does not necessarily change how a run is recorded, and coupling them
 * would force pointless migrations of published logs.
 */
export const LOG_VERSION = 0;

/**
 * The run envelope — competitors, budget, summaries — versioned separately again.
 * Adding a field to how a run is summarised should not invalidate published logs,
 * and changing how an action is recorded should not invalidate run records.
 */
export const RUN_VERSION = 0;

/**
 * Written as a `z.literal` wherever it appears in a schema, so a payload from a
 * future version fails LOUDLY on read instead of half-parsing. A silent partial
 * read of a changed contract is the exact failure mode the version exists to
 * prevent — an old reader must refuse a new log, not quietly drop its new fields.
 */
export const SpecVersionSchema = z.literal(SPEC_VERSION);
export const LogVersionSchema = z.literal(LOG_VERSION);
export const RunVersionSchema = z.literal(RUN_VERSION);

/**
 * Base for the named error each schema module throws from its parse function.
 * Carrying the issue list rather than a flattened string keeps the failure
 * machine-readable — TICKET-5 (#6) rejects generated rooms in a loop and needs
 * to know WHICH field failed, not just that something did.
 */
export class SchemaError extends Error {
  readonly issues: z.core.$ZodIssue[];

  constructor(message: string, issues: z.core.$ZodIssue[]) {
    super(`${message}: ${issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
    this.name = new.target.name;
    this.issues = issues;
  }
}
