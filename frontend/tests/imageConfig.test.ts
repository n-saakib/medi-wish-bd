import { describe, expect, it } from 'vitest';
import { allowsLoopbackImages, productImagePattern } from '../src/lib/imageConfig';
describe('product image optimizer boundary', () => {
  it('limits requests to the exact API origin and public image path without queries', () => {
    expect(productImagePattern('http://127.0.0.1:18080')).toEqual({ protocol: 'http', hostname: '127.0.0.1', port: '18080', pathname: '/api/public/product-images/**', search: '' });
    expect(productImagePattern('https://api.example.test').protocol).toBe('https');
  });
  it.each(['ftp://api.example.test', 'http://user:password@api.example.test', 'https://api.example.test/files', 'https://api.example.test?x=1', 'https://api.example.test#x'])('refuses unsafe API configuration %s', (url) => expect(() => productImagePattern(url)).toThrow());
  it.each(['http://127.0.0.1:18080', 'http://localhost:8115', 'http://[::1]:8115'])('allows loopback only for %s', (url) => expect(allowsLoopbackImages(url)).toBe(true));
  it.each(['https://api.example.test', 'http://10.0.0.5', 'http://127.0.0.1.example.test'])('keeps private IP access disabled for %s', (url) => expect(allowsLoopbackImages(url)).toBe(false));
});
