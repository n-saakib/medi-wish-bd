'use client';
import Image from 'next/image';
import { useState } from 'react';
import { productImageSrc, type ProductImage as ImageMetadata } from '../lib/productImages';
import { Icon } from '../shell/Icon';
export function ProductImage({ image, alt, sizes, className }: { image: Pick<ImageMetadata, 'url' | 'width' | 'height'> | null; alt: string; sizes: string; className?: string }) {
  const src = image ? productImageSrc(image.url) : null;
  const [failedSource, setFailedSource] = useState<string | null>(null);
  if (!image || !src || failedSource === src) return <span role="img" aria-label={alt} className={`thumb image-placeholder ${className ?? ''}`}><Icon name="image" /></span>;
  return <Image src={src} width={image.width} height={image.height} alt={alt} sizes={sizes} className={className}
    onError={() => setFailedSource(src)} />;
}
