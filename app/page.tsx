/**
 * Placeholder. The real entry point is a run replay at `/run/[id]`, which
 * TICKET-9 (#9) adds once there is a published artifact to load. Until then,
 * `/replay` (TICKET-8, #5) plays the golden fixture log.
 */
export default function Page() {
  return (
    <main>
      <h1>LLM Escape Room</h1>
      <p>Pre-implementation. The v0 contracts live in `lib/schema`, exemplified by `fixtures/`.</p>
      <p>
        <a href="/replay">Watch the canonical replay</a>
      </p>
    </main>
  );
}
