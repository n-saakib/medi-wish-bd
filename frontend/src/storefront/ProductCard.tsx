import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { formatTaka } from '../lib/catalog';
import { imageAlt, productImageSrc } from '../lib/productImages';
import type { PublicCard } from '../lib/storefront';
import { ProductImage } from '../catalog/ProductImage';
import { PriceBlock } from './PriceBlock';

const publicImageApiUrl = process.env.NEXT_PUBLIC_MEDI_WISH_API_URL ?? 'http://127.0.0.1:8080';

export function ProductCard({ product }: { product: PublicCard }) {
  const t = useTranslations('storefront');
  const tImages = useTranslations('productImages');
  const safeImage = product.image && productImageSrc(product.image.url, publicImageApiUrl) ? product.image : null;
  return (
    <article className="product-card">
      {product.price.discount && (
        <span className="badge-sale">
          {product.price.discount.kind === 'PERCENTAGE'
            ? t('percentOff', { value: product.price.discount.value })
            : t('amountOff', { amount: formatTaka(product.price.discount.value, t('currency')) })}
        </span>
      )}
      <Link className="product-card-image-link" href={`/products/${product.id}`} aria-hidden="true" tabIndex={-1}>
        <ProductImage image={safeImage} alt={safeImage ? imageAlt(safeImage, product.name, 0, tImages) : product.name}
          sizes="(max-width: 600px) 50vw, (max-width: 860px) 33vw, (max-width: 1100px) 25vw, 20vw"
          className="product-card-image" />
      </Link>
      <Link className="name" href={`/products/${product.id}`}>{product.name}</Link>
      {product.genericName && <span className="generic">{product.genericName}</span>}
      <span className="unit">{product.saleUnit}</span>
      <PriceBlock price={product.price} size="card" showBadge={false} />
    </article>
  );
}
