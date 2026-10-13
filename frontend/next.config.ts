import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';
import { allowsLoopbackImages, productImagePattern } from './src/lib/imageConfig';

const withNextIntl = createNextIntlPlugin();
const nextConfig: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  images: {
    localPatterns: [],
    remotePatterns: [productImagePattern(process.env.NEXT_PUBLIC_MEDI_WISH_API_URL ?? 'http://127.0.0.1:8080')],
    qualities: [75], formats: ['image/webp'], maximumRedirects: 0, maximumResponseBody: 4 * 1024 * 1024,
    dangerouslyAllowLocalIP: allowsLoopbackImages(process.env.NEXT_PUBLIC_MEDI_WISH_API_URL ?? 'http://127.0.0.1:8080'),
    minimumCacheTTL: 60, maximumDiskCacheSize: 0,
  },
  // Staff pages can show an authenticator secret or backup codes, so neither the browser nor a proxy may keep them.
  async headers() {
    return ['/staff/:path*', '/admin/:path*'].map((source) => ({
      source, headers: [{ key: 'Cache-Control', value: 'no-store' }],
    }));
  },
};

export default withNextIntl(nextConfig);
