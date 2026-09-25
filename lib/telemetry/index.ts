/**
 * Watch-through telemetry — TICKET-11 (#11).
 *
 *   TELEMETRY_EVENTS     the four event names a published run may send
 *   createWatchTracker   playback progress → at-most-once events           (client-safe)
 *   createUmamiTransport one event → one fire-and-forget beacon            (client-safe)
 *   readTelemetryConfig  `UMAMI_WEBSITE_ID` at build time                  (SERVER ONLY)
 *   fetchRunEventCounts  the Umami read API, for the readout script        (SCRIPT ONLY)
 *   summariseFunnel      counts → survival, watch-through, the PRD target
 *
 * The client imports the specific files — `./tracker`, `./umami`, `./events` —
 * and NEVER this barrel, which would pull `config.ts`'s environment read and the
 * read API into the browser graph (`boundary.test.ts`).
 *
 * `testing.ts` is deliberately not re-exported.
 */
export { T30_MS, TELEMETRY_EVENTS, type TelemetryEvent } from './events';
export { createWatchTracker, type WatchTracker } from './tracker';
export {
  buildUmamiPayload,
  createUmamiTransport,
  runPath,
  UMAMI_API_BASE,
  UMAMI_PAYLOAD_KEYS,
  UMAMI_SEND_URL,
  type TelemetryPage,
  type UmamiEventBody,
} from './umami';
export { readTelemetryConfig, TELEMETRY_ENV_VARS, TelemetryConfigError, type TelemetryConfig } from './config';
export { summariseFunnel, WATCH_THROUGH_TARGET, type EventCounts, type Funnel } from './funnel';
export {
  fetchRunEventCounts,
  TELEMETRY_READ_ERROR_REASONS,
  TelemetryReadError,
  type ReadQuery,
  type TelemetryReadErrorReason,
} from './readout';
