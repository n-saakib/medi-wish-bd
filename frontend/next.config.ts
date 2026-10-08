import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin();
const nextConfig: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  // Staff pages can show an authenticator secret or backup codes, so neither the browser nor a proxy may keep them.
  async headers() {
    return ['/staff/:path*', '/admin/:path*'].map((source) => ({
      source, headers: [{ key: 'Cache-Control', value: 'no-store' }],
    }));
  },
};

export default withNextIntl(nextConfig);
