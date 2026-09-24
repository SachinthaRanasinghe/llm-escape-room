/**
 * Opt-in live check: one real call per provider whose key is set.
 *
 * Run with: `node --env-file-if-exists=.env --import tsx scripts/smoke-providers.mts`
 *   optional: --groq-model <id> --gemini-model <id>
 *
 * NOT part of validation and never collected by vitest (it is `.mts`, not
 * `.test.ts`). `pnpm test` proves the adapters against scripted responses; this
 * is the one place the live APIs confirm the two things a script cannot —
 * that Gemini accepts minLength/maxLength on STRING parameters, and that the
 * request shapes are accepted at all.
 *
 * Reading `process.env` here is correct: `scripts/` is the harness side, and
 * `secrets.test.ts` deliberately does not sweep it. The key is never printed.
 */
import { parseArgs } from 'node:util';

import { ActionSchema } from '../lib/schema/action';
import { PROVIDERS, type Provider } from '../lib/schema/run';
import { compileRoom, describeRoom } from '../lib/sim';
import { loadCanonicalRoom } from '../fixtures';
import { PROVIDER_KEY_VARS, ProviderError, createAdapter, readProviderKey } from '../lib/providers';

// Model choice is TICKET-7's; these are only defaults for a smoke call.
const { values } = parseArgs({
  options: {
    'groq-model': { type: 'string', default: 'openai/gpt-oss-120b' },
    'gemini-model': { type: 'string', default: 'gemini-flash-latest' },
  },
});
const MODELS: Record<Provider, string> = { groq: values['groq-model']!, gemini: values['gemini-model']! };

const system =
  'You are trapped in a locked room and must escape. Act only by calling one of the tools. ' +
  'Every call needs an intent: one short sentence saying why.';
const room = describeRoom(compileRoom(loadCanonicalRoom()));

let failed = false;
for (const provider of PROVIDERS) {
  if (!process.env[PROVIDER_KEY_VARS[provider]]) {
    console.log(`${provider}: skipped — ${PROVIDER_KEY_VARS[provider]} not set`);
    continue;
  }
  try {
    const adapter = createAdapter(
      { provider, modelId: MODELS[provider], params: { temperature: 0, topP: null } },
      readProviderKey(provider),
    );
    const turn = await adapter.act({ system, transcript: [{ kind: 'user', text: room }] });
    console.log(
      JSON.stringify(
        {
          provider,
          modelId: adapter.modelId,
          anomaly: turn.anomaly,
          rawAction: turn.rawAction,
          parsed: ActionSchema.safeParse(turn.rawAction).success,
          tokens: turn.tokens,
          latencyMs: turn.latencyMs,
          attempts: turn.attempts,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    failed = true;
    console.error(error instanceof ProviderError ? error.message : error);
  }
}

process.exitCode = failed ? 1 : 0;
