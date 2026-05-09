/** @type {import('next').NextConfig} */

const isDev = process.env.NODE_ENV === 'development';

// safe: CLAUDE.md Part 8 — Security Agent owns this file
// CSP notes:
//   unsafe-eval  — Next.js hot module replacement requires it in dev only
//   unsafe-inline — Tailwind CSS requires it for style injection
//   ws:/wss:     — Next.js dev server uses WebSocket for HMR
//   img-src https: — og:images load from any HTTPS source (Phase 2)
const ContentSecurityPolicy = `
  default-src 'self';
  script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''};
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: https:;
  font-src 'self';
  connect-src 'self'${isDev ? ' ws: wss:' : ''};
  frame-ancestors 'none';
  object-src 'none';
  base-uri 'self';
`.replace(/\n/g, '').replace(/\s{2,}/g, ' ').trim();

const securityHeaders = [
  {
    key: 'Content-Security-Policy',
    value: ContentSecurityPolicy,
  },
  {
    key: 'X-Frame-Options',
    value: 'DENY',
  },
  {
    key: 'X-Content-Type-Options',
    value: 'nosniff',
  },
  {
    key: 'Referrer-Policy',
    value: 'strict-origin-when-cross-origin',
  },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=()',
  },
];

const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'image.pollinations.ai',
      },
    ],
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
