/** Exact origin and path accepted by the optimizer; configuration never contains credentials. */
export function productImagePattern(apiUrl: string) {
  const url = new URL(apiUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
    throw new Error('The image API URL must be an HTTP origin.');
  const protocol: 'http' | 'https' = url.protocol === 'https:' ? 'https' : 'http';
  return { protocol, hostname: url.hostname, port: url.port, pathname: '/api/public/product-images/**', search: '' };
}

export function allowsLoopbackImages(apiUrl: string): boolean {
  return ['127.0.0.1', 'localhost', '[::1]'].includes(productImagePattern(apiUrl).hostname);
}
