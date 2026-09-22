/**
 * The closed answer domains a prose puzzle's answer must come from.
 *
 * ── Why a lexicon exists at all ────────────────────────────────────────────
 * A `code` puzzle is self-checking: the answer is digits, and digits can be
 * found in a clue mechanically. A `kind: 'answer'` puzzle is prose — the
 * canonical room's third puzzle answers "north" off the line *"departed, as
 * always, to the north."* — and proving that a clue yields ONE answer and not
 * two means knowing what else would have counted.
 *
 * The committed corpus makes the problem concrete. `fixtures/rooms/invalid/
 * ambiguous-answer.json` differs from the canonical room in exactly one clue:
 * half the entries depart north, half depart south. Nothing structural
 * separates the two rooms. Only a notion of "what else could this clue have
 * meant" does, and with no LLM available (this ticket is pure by requirement)
 * that notion has to be enumerated.
 *
 * ── Why it is deliberately tiny ────────────────────────────────────────────
 * The lexicon's ONLY job is to supply the competitors for an answer already
 * known — see `derivation.ts`, which scans just the answer's own domain. A
 * bigger lexicon therefore buys nothing and costs precision: every extra word
 * is another chance to declare a room ambiguous because a clue happened to
 * mention it. Two domains cover the corpus and the fuzzer. Resist growing it
 * without a room that needs it.
 *
 * ── This file is TICKET-7's (#8) extension point ───────────────────────────
 * `architecture.md` leaves the puzzle substrate deliberately undecided, and #8
 * picks it after the divergence spike. When a new substrate needs richer
 * answers, ADD A DOMAIN HERE. Do not special-case it in `derivation.ts`: that
 * module is substrate-agnostic by construction and should stay that way, so
 * that swapping substrates is a data change rather than a logic change.
 */

/**
 * Domains are mutually exclusive — no word appears in two — because `domainOf`
 * returns one domain and the whole check depends on picking the right set of
 * competitors. `lexicon.test.ts` asserts that invariant so a careless addition
 * fails the build rather than silently narrowing a room's ambiguity check.
 */
export const ANSWER_DOMAINS: Readonly<Record<string, readonly string[]>> = {
  direction: ['north', 'south', 'east', 'west', 'northeast', 'northwest', 'southeast', 'southwest'],
  colour: ['black', 'white', 'red', 'green', 'blue', 'yellow', 'orange', 'purple', 'brown', 'grey'],
};

export type AnswerDomain = keyof typeof ANSWER_DOMAINS;

/**
 * Split text into comparable tokens: lowercase, and broken on anything that is
 * not a letter or a digit.
 *
 * ── Trim and lowercase, and NOTHING else ───────────────────────────────────
 * This is the same normalisation `lib/sim/resolve.ts` applies when it decides
 * whether a competitor's answer is correct, and its comment there explains why
 * it must not grow: stripping punctuation, accents or plurals would quietly
 * widen what counts as correct, and this module certifies uniqueness against
 * that same comparison. Splitting is not normalising — a token boundary is
 * structural — but stemming or singularising here WOULD be, so do neither.
 *
 * Splitting (rather than `String.includes`) is what makes matching whole-token:
 * "northern" must not count as "north", or a clue about a northern wall would
 * make an unrelated room ambiguous.
 */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0);
}

/**
 * The domain an answer belongs to, or `null` when no domain claims it.
 *
 * `null` is a rejection in `derivation.ts`, not a pass: an answer this module
 * cannot enumerate competitors for is an answer whose uniqueness cannot be
 * proved, and certifying it would make the guarantee a guess.
 */
export function domainOf(answer: string): AnswerDomain | null {
  const normalised = answer.trim().toLowerCase();
  for (const [domain, members] of Object.entries(ANSWER_DOMAINS)) {
    if (members.includes(normalised)) return domain;
  }
  return null;
}

/** The members of a domain, or an empty list for a domain that does not exist. */
export function membersOf(domain: AnswerDomain): readonly string[] {
  return ANSWER_DOMAINS[domain] ?? [];
}
