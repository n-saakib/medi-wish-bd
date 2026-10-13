import path from 'node:path';
import type { APIResponse } from '@playwright/test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, realpathSync } from 'node:fs';
import { expectImage, expectImageSuccess, imagePath, optimizerUrl, publicImage, storageDirectory, type ImageView } from './browser/productImageSupport';
import { apiUrl, frontendUrl, testSchemaVariable, testStorageVariable } from './browser/testApi';

vi.mock('node:fs', () => ({ existsSync: vi.fn(() => false), realpathSync: vi.fn(), readdirSync: vi.fn() }));
const id = '01234567-89ab-4def-8123-456789abcdef';
const schema = 'mw_browser_0123456789ab';
const directory = path.resolve(import.meta.dirname, '../../backend/target/test-object-storage/test-browser-0123456789ab');
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); vi.mocked(existsSync).mockReturnValue(false); });

function ownedStorage() {
  vi.stubEnv(testSchemaVariable, schema);
  vi.stubEnv(testStorageVariable, directory);
}

describe('image endpoint helpers', () => {
  it('successful image responses require correlation and no-store, including empty successful responses', () => {
    function response(headers: Record<string, string>, ok = true): APIResponse {
      return { ok: () => ok, headers: () => headers } as APIResponse;
    }
    expect(() => expectImageSuccess(response({ 'x-request-id': 'synthetic-request', 'cache-control': 'no-store' }))).not.toThrow();
    expect(() => expectImageSuccess(response({ 'cache-control': 'no-store' }))).toThrow();
    expect(() => expectImageSuccess(response({ 'x-request-id': '', 'cache-control': 'no-store' }))).toThrow();
    expect(() => expectImageSuccess(response({ 'x-request-id': 'synthetic-request' }))).toThrow();
    expect(() => expectImageSuccess(response({ 'x-request-id': 'synthetic-request', 'cache-control': 'no-store' }, false))).toThrow();
  });

  it('public URL is derived on the API origin; the optimizer request uses the frontend origin', () => {
    const relative = `/api/public/product-images/${id}.png`;
    expect(publicImage(relative)).toBe(`${apiUrl}${relative}`);
    const optimized = new URL(optimizerUrl(relative, 640, 75));
    expect(optimized.origin).toBe(frontendUrl);
    expect(optimized.pathname).toBe('/_next/image');
    expect(Object.fromEntries(optimized.searchParams)).toEqual({ url: `${apiUrl}${relative}`, w: '640', q: '75' });
  });

  it.each(['//evil.test/a.png', '/api/staff/products/a.png', `/api/public/product-images/${id}.png?x=1`,
    `/api/public/product-images/${id.toUpperCase()}.png`, '/api/public/product-images/------------------------------------.png',
    `/api/public/product-images/${id}.svg`, '/api/public/product-images/../a.png'])('refuses unsafe public path %s', (url) => {
    expect(() => publicImage(url)).toThrow('public image path');
  });

  it('keeps explicit attack URLs intact for optimizer allowlist tests', () => {
    expect(new URL(optimizerUrl('http://169.254.169.254/')).searchParams.get('url')).toBe('http://169.254.169.254/');
  });
});

describe('image alt projection follows existing Java catalog rules', () => {
  function image(altText: string | null): ImageView {
    return { id, url: `/api/public/product-images/${id}.png`, contentType: 'image/png', width: 1, height: 1,
      byteSize: 68, altText, position: 0, version: 0, createdAt: '2026-10-11T00:00:00Z' };
  }

  it.each([null, 'Synthetic description', '\u00a0Description\u00a0', '\ufeffDescription\ufeff', '😀'.repeat(80)])(
    'accepts normalized alt text including preserved Unicode edges and 160 UTF-16 units: %s', (altText) => {
      expect(() => expectImage(image(altText))).not.toThrow();
    });

  it.each(['', ' Description', 'Description ', '\tDescription', 'Description\u0085', '😀'.repeat(80) + 'a'])(
    'rejects blank, ASCII-padded, ISO-control or over-160 UTF-16-unit projection: %s', (altText) => {
      expect(() => expectImage(image(altText))).toThrow();
    });
});

describe('owned storage guards', () => {
  it('requires a test schema and the matching owned namespace', () => {
    ownedStorage();
    expect(storageDirectory()).toBe(directory);
    expect(imagePath(id, { id, contentType: 'image/png' })).toBe(path.join(directory, 'products', id, `${id}.png`));
    expect(imagePath(id, { id, contentType: 'image/jpeg' })).toBe(path.join(directory, 'products', id, `${id}.jpg`));
  });

  it.each([undefined, 'relative/test-browser-0123456789ab', path.resolve('/tmp/prod-0123456789ab'),
    path.resolve('/tmp/test-browser-aaaaaaaaaaaa'), path.resolve('/tmp/test-browser-0123456789ab')])('rejects missing, non-test or unowned storage %s', (value) => {
    ownedStorage();
    vi.stubEnv(testStorageVariable, value);
    expect(() => storageDirectory()).toThrow();
  });

  it('refuses filesystem access without the run schema', () => {
    ownedStorage();
    vi.stubEnv(testSchemaVariable, 'public');
    expect(() => storageDirectory()).toThrow('needs the schema');
    expect(existsSync).not.toHaveBeenCalled();
  });

  it('refuses a namespace redirected through a symbolic link', () => {
    ownedStorage();
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(realpathSync).mockReturnValue(path.resolve('/tmp/unrelated-storage'));
    expect(() => storageDirectory()).toThrow('symbolic link');
  });

  it('refuses a symlink in the Product directory before any object mutation', () => {
    ownedStorage();
    const productDirectory = path.join(directory, 'products', id);
    vi.mocked(existsSync).mockImplementation((candidate) => String(candidate) === productDirectory);
    vi.mocked(realpathSync).mockReturnValue(path.resolve('/tmp/unrelated-product'));
    expect(() => imagePath(id, { id, contentType: 'image/png' })).toThrow('symbolic link');
  });

  it.each(['../escape', id.toUpperCase(), '------------------------------------'])('rejects unsafe object identity %s', (value) => {
    ownedStorage();
    expect(() => imagePath(value, { id, contentType: 'image/png' })).toThrow('lowercase UUIDs');
    expect(() => imagePath(id, { id: value, contentType: 'image/png' })).toThrow('lowercase UUIDs');
  });
});
