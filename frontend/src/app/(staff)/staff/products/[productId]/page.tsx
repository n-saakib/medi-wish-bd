'use client';

import { useParams } from 'next/navigation';
import { ProductEditor } from '../../../../../catalog/ProductEditor';

export default function EditProductPage() {
  const { productId } = useParams<{ productId: string }>();
  return <ProductEditor productId={productId} />;
}
