import Link from 'next/link';
import styles from './home.module.css';

/**
 * The landing page. The real entry point is a published run at `/run/[id]`
 * (TICKET-9, #9), which plays an artifact frozen by `scripts/publish.mts`.
 * `/replay` (TICKET-8, #5) is the live preview of the current renderer over the
 * golden fixture log. `/race` races two free models picked in the browser, under
 * `next dev` only.
 */

const STEPS = [
  {
    n: '01',
    title: 'A fresh room',
    body: 'Every room is generated, then proven solvable by a solver before any model sees it. No memorised walkthroughs.',
  },
  {
    n: '02',
    title: 'Same tools, same rules',
    body: 'Both models get the identical room, action budget and tool schema. Each move is judged by the simulator, not by a model.',
  },
  {
    n: '03',
    title: 'Watch every thought',
    body: 'The replay quotes each model’s intent verbatim, beat by beat, then shows an honest scorecard with the caveats up front.',
  },
] as const;

export default function Page() {
  return (
    <main className={styles.root}>
      <div className={styles.glow} aria-hidden="true" />

      <nav className={styles.nav}>
        <Link href="/" className={styles.brand}>
          <span className={styles.mark} aria-hidden="true">
            <span />
            <span />
          </span>
          LLM Escape Room
        </Link>
        <div className={styles.navLinks}>
          <Link href="/run/canonical">Watch</Link>
          <Link href="/race">Race</Link>
          <Link href="/replay">Preview</Link>
        </div>
      </nav>

      <section className={styles.hero}>
        <p className={styles.eyebrow}>
          <span className={styles.dot} aria-hidden="true" /> A benchmark you can watch
        </p>
        <h1 className={styles.headline}>
          Two models.
          <br />
          <span className={styles.b}>One locked room.</span>
        </h1>
        <p className={styles.lede}>
          Two language models race through the same freshly generated escape room, side by side in 3D. You see
          everything they meant, every move they made and what the room said back.
        </p>
        <div className={styles.ctas}>
          <Link href="/run/canonical" className={styles.primary}>
            <PlayIcon /> Watch the canonical run
          </Link>
          <Link href="/race" className={styles.secondary}>
            Race two models
            <span className={styles.tag}>local</span>
          </Link>
        </div>

        <div className={styles.duel} aria-hidden="true">
          <div className={`${styles.door} ${styles.doorA}`}>
            <span className={styles.doorPanel} />
            <span className={styles.doorPanel} />
            <span className={styles.knob} />
          </div>
          <span className={styles.vs}>vs</span>
          <div className={`${styles.door} ${styles.doorB}`}>
            <span className={styles.doorPanel} />
            <span className={styles.doorPanel} />
            <span className={styles.knob} />
          </div>
        </div>
      </section>

      <section className={styles.steps} aria-label="How it works">
        {STEPS.map((step) => (
          <article key={step.n} className={styles.step}>
            <span className={styles.stepN}>{step.n}</span>
            <h2 className={styles.stepTitle}>{step.title}</h2>
            <p className={styles.stepBody}>{step.body}</p>
          </article>
        ))}
      </section>

      <footer className={styles.footer}>
        <span>
          Racing runs locally on the keys in your <code>.env</code>. Published runs are frozen and play with no backend.
        </span>
        <Link href="/replay">Live renderer preview →</Link>
      </footer>
    </main>
  );
}

function PlayIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <path d="M3 1.8v10.4a.6.6 0 0 0 .9.5l8.6-5.2a.6.6 0 0 0 0-1L3.9 1.3a.6.6 0 0 0-.9.5Z" fill="currentColor" />
    </svg>
  );
}
