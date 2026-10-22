import Link from 'next/link';
import { Icon } from '../shell/Icon';
import type { PublicCategory } from '../lib/storefront';

export function CategoryTiles({ categories }: { categories: PublicCategory[] }) {
  if (categories.length === 0) return null;
  return (
    <div className="cat-grid">
      {categories.map((category) => (
        <Link className="cat-tile" key={category.id} href={`/categories/${category.id}`}>
          <span className="cat-icon"><Icon name="grid" /></span>
          <span>{category.name}</span>
        </Link>
      ))}
    </div>
  );
}
