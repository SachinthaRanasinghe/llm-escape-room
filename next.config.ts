import type { NextConfig } from 'next';

/**
 * Deliberately empty. `architecture.md` decides there is no server, no database
 * and no auth in the MVP: Next is here for its static output and its
 * conventions, not as a backend. A run replays from a published JSON artifact,
 * so nothing here should grow into request handling.
 */
const nextConfig: NextConfig = {};

export default nextConfig;
