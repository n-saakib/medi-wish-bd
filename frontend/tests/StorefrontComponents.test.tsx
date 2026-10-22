// @vitest-environment jsdom
import { act, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RootNotFound from '../src/app/not-found';
import { Breadcrumb } from '../src/storefront/Breadcrumb';
import { CategoryNavLinks, CurrentCategoryMark, CurrentCategoryProvider } from '../src/storefront/CategoryNavLinks';
import { CategoryTiles } from '../src/storefront/CategoryTiles';
import { EmptyState } from '../src/storefront/EmptyState';
import { NotFoundView } from '../src/storefront/NotFoundView';
import { Pager } from '../src/storefront/Pager';
import { PriceBlock } from '../src/storefront/PriceBlock';
import { ProductAbout } from '../src/storefront/ProductAbout';
import { ProductCard } from '../src/storefront/ProductCard';
import { ProductDetailsView } from '../src/storefront/ProductDetailsView';
import { ProductGallery } from '../src/storefront/ProductGallery';
import { StorefrontError } from '../src/storefront/StorefrontError';
import type { PublicCard, PublicCategory, PublicProductDetails } from '../src/lib/storefront';
import { renderWithSession, requiredElement, unmountAll } from './renderWithSession';

const productPath = '/products/7d1c3a90-2b8e-4c7f-9e11-0a4b5c6d7e01';
const navigation = vi.hoisted(() => ({ pathname: '' }));
vi.mock('next/navigation', () => ({ usePathname: () => navigation.pathname }));
vi.mock('next/link', () => ({ default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) =>
  createElement('a', { href, ...props }, children) }));
vi.mock('next/image', () => ({ default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => createElement('img', props) }));

beforeEach(() => { navigation.pathname = productPath; });
afterEach(unmountAll);

const category = (index: number): PublicCategory => ({
  id: `${String(index).padStart(8, '0')}-0000-4000-8000-000000000001`, name: `Category ${index}`,
});
const firstImage = {
  url: '/api/public/product-images/2e7a9c11-5b3d-4f8e-a0c2-9d8e7f6a5b01.jpg',
  altText: null, width: 800, height: 800,
};
const secondImage = {
  url: '/api/public/product-images/4c5d6e7f-8091-4a2b-9c3d-4e5f6a7b8c02.png',
  altText: 'Back of the box', width: 600, height: 600,
};
const price = {
  sellingPrice: '150.00', mrp: '160.00', price: '135.00', saving: '15.00',
  discount: { targetType: 'CATEGORY' as const, kind: 'PERCENTAGE' as const, value: '10' },
};
const card: PublicCard = {
  id: '7d1c3a90-2b8e-4c7f-9e11-0a4b5c6d7e01', name: 'Paracetin 500', genericName: 'Paracetamol 500 mg',
  saleUnit: 'Strip of 10 tablets', image: firstImage, price,
};
const details: PublicProductDetails = {
  id: card.id, name: card.name, brandName: 'Acme', genericName: card.genericName, dosageForm: 'Tablet',
  manufacturer: 'Meghna Labs', saleUnit: card.saleUnit, description: 'First line\nSecond line', requireValidation: true,
  category: category(1), images: [firstImage, secondImage], price,
};

async function render(element: React.ReactElement): Promise<HTMLElement> {
  return renderWithSession(element);
}

describe('storefront cards and prices', () => {
  it('links a public Product card to its details and shows its public label and price', async () => {
    const view = await render(createElement(ProductCard, { product: card }));
    expect(requiredElement<HTMLAnchorElement>(view, '.product-card .name').getAttribute('href')).toBe(`/products/${card.id}`);
    expect(view.textContent).toContain('Paracetin 500');
    expect(view.textContent).toContain('Paracetamol 500 mg');
    expect(view.textContent).toContain('Strip of 10 tablets');
    expect(view.textContent).toContain('৳135.00');
    expect(requiredElement<HTMLImageElement>(view, '.product-card img').alt).toBe('Paracetin 500, image 1');
    expect(view.querySelector('button, input')).toBeNull();
    expect(view.textContent).not.toMatch(/stock|availab|add to cart/i);
  });

  it('uses the existing image placeholder when a card has no main image', async () => {
    const view = await render(createElement(ProductCard, { product: { ...card, image: null } }));
    expect(view.querySelector('.product-card img')).toBeNull();
    expect(view.querySelector('.product-card [role="img"]')).not.toBeNull();
  });

  it('shows discounted price, accessible former price, badge and unstruck MRP', async () => {
    const view = await render(createElement(PriceBlock, { price, size: 'card' }));
    expect(requiredElement(view, 's.price-was').textContent).toContain('৳150.00');
    expect(requiredElement(view, '.badge-sale').textContent).toBe('10% OFF');
    expect(requiredElement(view, '.mrp-label').textContent).toBe('MRP ৳160.00');
    expect(requiredElement(view, '.mrp-label').closest('s')).toBeNull();
    const flat = await render(createElement(PriceBlock, {
      price: { ...price, discount: { targetType: 'PRODUCT', kind: 'FLAT', value: '15.00' } }, size: 'large',
    }));
    expect(requiredElement(flat, '.badge-sale').textContent).toBe('৳15.00 OFF');
  });
});

describe('storefront navigation and states', () => {
  it('shows the first eight categories and the all-categories link', async () => {
    const view = await render(createElement(CategoryNavLinks, { categories: Array.from({ length: 12 }, (_, i) => category(i + 1)) }));
    const links = [...view.querySelectorAll('nav a')];
    expect(links).toHaveLength(9);
    expect(links.slice(0, 8).map((link) => link.textContent)).toEqual(Array.from({ length: 8 }, (_, i) => `Category ${i + 1}`));
    expect(links[8].textContent).toBe('All categories');
    expect(links[8].getAttribute('href')).toBe('/categories');
    expect(requiredElement(view, 'nav').getAttribute('aria-label')).toBe('Categories');
    expect(view.querySelector('nav a[aria-current], nav a.is-active')).toBeNull();
  });

  it('marks the category bar link that the rendered page declares as current', async () => {
    const withMark = (href: string, categories: PublicCategory[]) => createElement(CurrentCategoryProvider, null,
      createElement(CategoryNavLinks, { categories }), createElement(CurrentCategoryMark, { href }));
    const view = await render(withMark(`/categories/${category(2).id}`, [category(1), category(2)]));
    const current = [...view.querySelectorAll('nav a[aria-current="page"]')];
    expect(current.map((link) => link.textContent)).toEqual(['Category 2']);
    expect(current[0].classList.contains('is-active')).toBe(true);
    const all = await render(withMark('/categories', [category(1)]));
    expect([...all.querySelectorAll('nav a[aria-current="page"]')].map((link) => link.textContent)).toEqual(['All categories']);
  });

  it('marks no category when a store 404 renders on a listed category URL', async () => {
    navigation.pathname = `/categories/${category(1).id}`;
    const view = await render(createElement(CurrentCategoryProvider, null,
      createElement(CategoryNavLinks, { categories: [category(1), category(2)] }), createElement(NotFoundView)));
    expect(view.querySelectorAll('nav a')).toHaveLength(3);
    expect(view.querySelector('nav a[aria-current], nav a.is-active')).toBeNull();
  });

  it('hides category navigation and renders the shared empty state for no categories', async () => {
    const nav = await render(createElement(CategoryNavLinks, { categories: [] }));
    expect(nav.querySelector('nav')).toBeNull();
    const empty = await render(createElement(EmptyState, { title: 'No categories yet', text: 'Try another page.', href: '/', linkText: 'Go to the home page' }));
    expect(empty.textContent).toContain('No categories yet');
    expect(requiredElement<HTMLAnchorElement>(empty, 'a').getAttribute('href')).toBe('/');
  });

  it('renders category tiles as labelled links to their category pages', async () => {
    const view = await render(createElement(CategoryTiles, { categories: [category(1), category(2)] }));
    expect([...view.querySelectorAll('.cat-tile')].map((link) => [link.getAttribute('href'), link.textContent]))
      .toEqual([
        ['/categories/00000001-0000-4000-8000-000000000001', 'Category 1'],
        ['/categories/00000002-0000-4000-8000-000000000001', 'Category 2'],
      ]);
  });

  it('builds pager links for first, middle and last pages and hides a one-page pager', async () => {
    const first = await render(createElement(Pager, { basePath: '/categories/cat-id', page: 1, totalPages: 3 }));
    expect(first.querySelector('a[rel="prev"]')).toBeNull();
    expect(requiredElement<HTMLAnchorElement>(first, 'a[rel="next"]').getAttribute('href')).toBe('/categories/cat-id?page=2');
    expect(requiredElement(first, 'nav').getAttribute('aria-label')).toBe('Pagination');
    const middle = await render(createElement(Pager, { basePath: '/categories/cat-id', page: 2, totalPages: 3 }));
    expect(requiredElement<HTMLAnchorElement>(middle, 'a[rel="prev"]').getAttribute('href')).toBe('/categories/cat-id');
    expect(requiredElement<HTMLAnchorElement>(middle, 'a[rel="next"]').getAttribute('href')).toBe('/categories/cat-id?page=3');
    const last = await render(createElement(Pager, { basePath: '/categories/cat-id', page: 3, totalPages: 3 }));
    expect(last.querySelector('a[rel="next"]')).toBeNull();
    const onePage = await render(createElement(Pager, { basePath: '/categories/cat-id', page: 1, totalPages: 1 }));
    expect(onePage.querySelector('nav')).toBeNull();
  });

  it('shows Home and an optional category breadcrumb', async () => {
    const withCategory = await render(createElement(Breadcrumb, { category: category(1) }));
    expect([...withCategory.querySelectorAll('a')].map((link) => link.textContent)).toEqual(['Home', 'Category 1']);
    expect(withCategory.querySelector('a[href="/categories/00000001-0000-4000-8000-000000000001"]')).not.toBeNull();
    const withoutCategory = await render(createElement(Breadcrumb, { category: null }));
    expect([...withoutCategory.querySelectorAll('a')].map((link) => link.textContent)).toEqual(['Home']);
    expect(withCategory.querySelector('a[aria-current]')).toBeNull();
    const onCategoryPage = await render(createElement(Breadcrumb, { category: category(1), current: true }));
    expect([...onCategoryPage.querySelectorAll('a[aria-current="page"]')].map((link) => link.textContent)).toEqual(['Category 1']);
  });

  it('shows one home link in not-found content', async () => {
    const view = await render(createElement(NotFoundView));
    expect(view.textContent).toContain("We couldn't find that page.");
    expect([...view.querySelectorAll('a')].map((link) => link.getAttribute('href'))).toEqual(['/']);
  });

  it('gives the root not-found page the store header with its Logo link home', async () => {
    const view = await render(createElement(RootNotFound));
    expect(requiredElement<HTMLAnchorElement>(view, 'header a.logo').getAttribute('href')).toBe('/');
    expect(requiredElement(view, 'main').textContent).toContain("We couldn't find that page.");
  });
});

describe('Product details and error recovery', () => {
  it('omits equipment-only medicine rows and preserves description newlines as text', async () => {
    const equipment: PublicProductDetails = {
      ...details, genericName: null, dosageForm: null, category: null, description: 'a\nb',
    };
    const view = await render(createElement(ProductAbout, { product: equipment }));
    expect(view.textContent).toContain('a\nb');
    expect(view.textContent).not.toContain('Generic name');
    expect(view.textContent).not.toContain('Dosage form');
    expect(view.querySelector('img')).toBeNull();
  });

  it('renders untrusted-looking descriptions as text without creating markup', async () => {
    const injected: PublicProductDetails = { ...details, description: '<img src=x onerror=alert(1)>' };
    const view = await render(createElement(ProductAbout, { product: injected }));
    expect(view.querySelector('img')).toBeNull();
    expect(view.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('shows the review note only when the Product requires it', async () => {
    const required = await render(createElement(ProductDetailsView, { product: details }));
    expect(required.textContent).toContain('Our team reviews this product before dispatch. No prescription upload needed.');
    const optional = await render(createElement(ProductDetailsView, { product: { ...details, requireValidation: false } }));
    expect(optional.textContent).not.toContain('Our team reviews this product');
  });

  it('switches the main image when a thumbnail is selected', async () => {
    const view = await render(createElement(ProductGallery, { images: [firstImage, secondImage], name: card.name }));
    const thumbnails = [...view.querySelectorAll<HTMLButtonElement>('.gallery-thumbs button')];
    expect(thumbnails).toHaveLength(2);
    expect(thumbnails[0].getAttribute('aria-pressed')).toBe('true');
    expect(thumbnails[1].getAttribute('aria-pressed')).toBe('false');
    await act(async () => thumbnails[1].click());
    expect(requiredElement<HTMLImageElement>(view, '.gallery-main img').src).toContain('4c5d6e7f-8091-4a2b-9c3d-4e5f6a7b8c02.png');
    expect(thumbnails[1].getAttribute('aria-pressed')).toBe('true');
  });

  it('does not render thumbnail controls for a single image', async () => {
    const view = await render(createElement(ProductGallery, { images: [firstImage], name: card.name }));
    expect(view.querySelector('.gallery-thumbs')).toBeNull();
  });

  it('calls retry from its generic error state without showing diagnostic text', async () => {
    const retry = vi.fn();
    const view = await render(createElement(StorefrontError, { retry, error: new Error('private diagnostic') }));
    expect(view.textContent).not.toContain('private diagnostic');
    const button = requiredElement<HTMLButtonElement>(view, 'button');
    expect(button.textContent).toBe('Try again');
    await act(async () => button.click());
    expect(retry).toHaveBeenCalledOnce();
  });
});
