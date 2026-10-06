import { buildToolSpec, type ToolWords } from '@/lib/providers/vocabulary';
import { ArenaActionSchema, ArenaAnswerSchema } from './schema';

/**
 * The arena's tools — compiled by the SAME provider compilers as the room's,
 * through `TurnRequest.tools`, and proved equivalent across Groq, Gemini and
 * OpenRouter in `lib/providers/equivalence.test.ts`.
 *
 * The words live here and only here, so no player can be given a different
 * sentence. The intent line is the room's, word for word: viewers read it the
 * same way in both games.
 */

const INTENT = 'One short sentence, in your own words, saying why you are taking this action. Shown to viewers beside your character.';

export const DECISION_WORDS: ToolWords = {
  claim: {
    tool: 'Take one Energy Core from the centre. You must first answer a medium-difficulty question correctly; a wrong answer wastes your turn.',
    params: { intent: INTENT },
  },
  steal: {
    tool: 'Take one Energy Core from another player. You must first answer a hard question correctly; a wrong answer wastes your turn.',
    params: { targetId: 'The id of the player to steal from, e.g. player-b.', intent: INTENT },
  },
  pass: {
    tool: 'Do nothing this turn.',
    params: { intent: INTENT },
  },
};

export const ANSWER_WORDS: ToolWords = {
  answer: {
    tool: 'Submit your final answer to the question.',
    params: { answer: 'Only the final answer, in the form the question asks for. No explanation.', intent: INTENT },
  },
};

/** Offered on the DECIDE call of every turn. */
export const DECISION_TOOLS = buildToolSpec(ArenaActionSchema.options, DECISION_WORDS);

/** Offered on the ANSWER call, and only after a legal claim or steal drew a question. */
export const ANSWER_TOOLS = buildToolSpec(ArenaAnswerSchema.options, ANSWER_WORDS);
