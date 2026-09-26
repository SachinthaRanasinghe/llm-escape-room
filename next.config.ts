import type { NextConfig } from 'next';

/**
 * Deliberately empty. `architecture.md` decides there is no server, no database
 * and no auth in the MVP: Next is here for its static output and its
 * conventions, not as a backend. A run replays from a published JSON artifact.
 * The one request-handling exception is the local race page (`/race`,
 * `app/api/`), which is off in a production build — `docs/decisions/local-race.md`.
 */
const nextConfig: NextConfig = {};

export default nextConfig;
