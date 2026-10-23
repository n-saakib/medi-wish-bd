import { connection } from 'next/server';
import { CategoryNavLinks } from './CategoryNavLinks';
import { categoriesOrNull } from './loaders';

export async function CategoryNav() {
  await connection();
  const categories = await categoriesOrNull();
  if (!categories?.length) return null;
  return <CategoryNavLinks categories={categories} />;
}
