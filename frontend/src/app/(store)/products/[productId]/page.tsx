import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { connection } from 'next/server';
import { notFound } from 'next/navigation';
import { ProductDetailsView } from '../../../../storefront/ProductDetailsView';
import { loadProduct } from '../../../../storefront/loaders';
import { isPublicId, productMetadata } from '../../../../lib/storefrontView';
import type { PublicProductDetails } from '../../../../lib/storefront';

type ProductPageProps = { params: Promise<{ productId: string }> };

async function resolveProduct({ params }: ProductPageProps): Promise<PublicProductDetails> {
  await connection();
  const { productId } = await params;
  if (!isPublicId(productId)) notFound();
  const product = await loadProduct(productId);
  if (!product) notFound();
  return product;
}

export async function generateMetadata(props: ProductPageProps): Promise<Metadata> {
  return productMetadata(await resolveProduct(props), await getTranslations('storefront'));
}

export default async function ProductPage(props: ProductPageProps) {
  return <ProductDetailsView product={await resolveProduct(props)} />;
}
