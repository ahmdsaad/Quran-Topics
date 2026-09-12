import type { NextConfig } from 'next';

// VERCEL_URL is unique for every deployment, including direct CLI deploys.
// Embedding it in both the browser bundle and /api/version lets an already-open
// app detect when the production alias starts serving a newer build.
const appVersion = process.env.VERCEL_URL ?? `local-${Date.now()}`;

const nextConfig: NextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_APP_VERSION: appVersion,
  },
  async headers() {
    return [
      {
        source: '/',
        headers: [{ key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate' }],
      },
      {
        source: '/fonts/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
      {
        source: '/data/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
      {
        source: '/mushaf-svg/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
    ];
  },
};

export default nextConfig;
