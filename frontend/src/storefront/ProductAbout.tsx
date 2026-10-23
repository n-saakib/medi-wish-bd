import { Fragment } from 'react';
import { useTranslations } from 'next-intl';
import type { PublicProductDetails } from '../lib/storefront';

export function ProductAbout({ product }: { product: PublicProductDetails }) {
  const t = useTranslations('storefront');
  const facts = [
    ['brand', product.brandName],
    ['genericName', product.genericName],
    ['dosageForm', product.dosageForm],
    ['manufacturer', product.manufacturer],
    ['saleUnit', product.saleUnit],
  ] as const;
  return (
    <section className="product-about" aria-labelledby="about-title">
      <h2 id="about-title">{t('about')}</h2>
      {product.description !== null && <p className="about-text">{product.description}</p>}
      <dl className="dl">
        {facts.map(([key, value]) => value !== null && (
          <Fragment key={key}><dt>{t(key)}</dt><dd>{value}</dd></Fragment>
        ))}
      </dl>
    </section>
  );
}
