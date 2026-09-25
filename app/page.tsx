/**
 * Placeholder. The real entry point is a published run at `/run/[id]`
 * (TICKET-9, #9), which plays an artifact frozen by `scripts/publish.mts`.
 * `/replay` (TICKET-8, #5) is the live preview of the current renderer over the
 * golden fixture log.
 */
export default function Page() {
  return (
    <main>
      <h1>LLM Escape Room</h1>
      <p>Pre-implementation. The v0 contracts live in `lib/schema`, exemplified by `fixtures/`.</p>
      <p>
        <a href="/run/canonical">Watch the canonical published run</a>
      </p>
      <p>
        <a href="/replay">Live renderer preview</a>
      </p>
    </main>
  );
}
