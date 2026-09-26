'use client';

import type { ReactNode, RefObject } from 'react';
import type { ComparisonData, ComparisonRow } from '@/lib/comparison';
import styles from './comparison.module.css';

/**
 * The post-run comparison — TICKET-10 (#10).
 *
 * Lays out strings `buildComparison` already wrote; it decides nothing. A real
 * table (metrics as rows, the two models as columns — three columns fit a phone
 * without scrolling), then the variance statement and the limitation.
 *
 * ── Never in a tooltip ─────────────────────────────────────────────────────
 * The variance statement and the limitation are body text at full width: no
 * `title` attribute, no disclosure widget, no truncation. "Don't bury it in a
 * tooltip" is the ticket's one hard rule, and `e2e/run.spec.ts` checks it.
 *
 * Lane colours come from the player's `--lane-a` / `--lane-b`, which the
 * results inherit because they render inside it.
 */

interface Metric {
  readonly key: string;
  readonly label: string;
  readonly cell: (row: ComparisonRow) => ReactNode;
}

const METRICS: readonly Metric[] = [
  { key: 'result', label: 'Result', cell: (r) => r.result },
  { key: 'escape-time', label: 'Escape time', cell: (r) => r.escapeTime },
  { key: 'actions', label: 'Actions', cell: (r) => r.actions },
  { key: 'puzzles', label: 'Puzzles solved', cell: (r) => r.puzzles },
  { key: 'failed', label: 'Failed attempts', cell: (r) => r.failedAttempts },
  { key: 'invalid', label: 'Invalid actions', cell: (r) => r.invalidActions },
  {
    key: 'tokens',
    label: 'Tokens',
    cell: (r) => (
      <>
        {r.tokens}
        <span className={styles.detail}>{r.tokensDetail}</span>
      </>
    ),
  },
  { key: 'cost', label: 'Cost', cell: (r) => r.cost },
];

const LANE_CLASSES = [styles.laneA, styles.laneB];

const WARNING_KINDS = new Set(['atypical', 'all_dropped', 'stopped']);

interface Props {
  readonly data: ComparisonData;
  readonly headingRef?: RefObject<HTMLHeadingElement | null>;
}

export function Comparison({ data, headingRef }: Props) {
  return (
    <section className={styles.results} data-testid="results" aria-labelledby="results-heading">
      <p className={styles.eyebrow}>Results</p>
      <h2 id="results-heading" ref={headingRef} tabIndex={-1} className={styles.headline} data-testid="results-heading">
        {data.headline}
      </h2>

      <div className={styles.card}>
        <table className={styles.table}>
          <caption className={styles.caption}>How each model did</caption>
          <thead>
            <tr>
              <th scope="col" className={styles.metric}>
                Metric
              </th>
              {data.rows.map((row, i) => (
                <th
                  key={row.competitorId}
                  scope="col"
                  className={`${styles.model} ${LANE_CLASSES[i % 2]}`}
                  data-testid={`column-${row.competitorId}`}
                >
                  <span className={styles.modelName}>{row.label}</span>
                  {row.isWinner && (
                    <span className={styles.winner} data-testid="winner">
                      <TrophyIcon /> Winner
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {METRICS.map((metric) => (
              <tr key={metric.key}>
                <th scope="row" className={styles.metric}>
                  {metric.label}
                </th>
                {data.rows.map((row) => (
                  <td key={row.competitorId} className={styles.value} data-testid={`cell-${metric.key}-${row.competitorId}`}>
                    {metric.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className={styles.note}>{data.escapeTimeNote}</p>

      <div
        className={`${styles.variance} ${WARNING_KINDS.has(data.variance.kind) ? styles.warning : ''}`}
        data-testid="variance"
        data-kind={data.variance.kind}
      >
        <h3 className={styles.varianceTitle}>{data.variance.title}</h3>
        <p className={styles.varianceBody}>{data.variance.body}</p>
      </div>

      <p className={styles.limitation} data-testid="limitation">
        {data.limitation}
      </p>
    </section>
  );
}

function TrophyIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M4 1.5h8v1.8h2.5v1.4A3.3 3.3 0 0 1 11.6 8 4 4 0 0 1 8.8 10v1.8h2.4v2.7H4.8v-2.7h2.4V10A4 4 0 0 1 4.4 8 3.3 3.3 0 0 1 1.5 4.7V3.3H4V1.5Zm0 3.2H3a1.9 1.9 0 0 0 1.1 1.6 7 7 0 0 1-.1-1.6Zm8 0c0 .6 0 1.1-.1 1.6A1.9 1.9 0 0 0 13 4.7h-1Z"
        fill="currentColor"
      />
    </svg>
  );
}
