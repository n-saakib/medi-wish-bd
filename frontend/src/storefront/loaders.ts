import 'server-only';
import { cache } from 'react';
import { connection } from 'next/server';
import { createStorefrontClient } from '../lib/storefront';

export const loadCategories = cache(async () => {
  await connection();
  return createStorefrontClient().categories();
});

export const loadCategoryPage = cache(async (id: string, apiPage: number) => {
  await connection();
  return createStorefrontClient().categoryPage(id, apiPage);
});

export const loadProduct = cache(async (id: string) => {
  await connection();
  return createStorefrontClient().product(id);
});

export async function categoriesOrNull() {
  try {
    return await loadCategories();
  } catch {
    return null;
  }
}
