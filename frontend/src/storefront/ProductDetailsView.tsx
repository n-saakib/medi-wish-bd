import { useTranslations } from 'next-intl';
import type { PublicProductDetails } from '../lib/storefront';
import { Icon } from '../shell/Icon';
import { Breadcrumb } from './Breadcrumb';
import { PriceBlock } from './PriceBlock';
import { ProductAbout } from './ProductAbout';
import { ProductGallery } from './ProductGallery';

export function ProductDetailsView({ product }: { product: PublicProductDetails }) {
  const t = useTranslations('storefront');
  return (
    <main className="container page">
      <Breadcrumb category={product.category} />
      <div className="grid-2 product-details-grid">
        <ProductGallery key={product.id} images={product.images} name={product.name} />
        <div className="stack product-details-copy">
          <h1>{product.name}</h1>
          <PriceBlock price={product.price} size="large" />
          <p className="muted mb-0">{product.saleUnit}</p>
          {product.requireValidation && (
            <p className="small muted row review-note"><Icon name="shield" className="icon-s" />{t('reviewNote')}</p>
          )}
          <ProductAbout product={product} />
        </div>
      </div>
    </main>
  );
}
