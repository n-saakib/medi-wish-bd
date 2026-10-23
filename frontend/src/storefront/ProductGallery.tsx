'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { imageAlt } from '../lib/productImages';
import type { PublicImage } from '../lib/storefront';
import { ProductImage } from '../catalog/ProductImage';

export function ProductGallery({ images, name }: { images: PublicImage[]; name: string }) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const t = useTranslations('storefront');
  const tImages = useTranslations('productImages');
  const selected = images[selectedIndex] ?? null;
  const alt = selected ? imageAlt(selected, name, selectedIndex, tImages) : name;
  return (
    <section aria-label={t('images')}>
      <div className="gallery-main">
        <ProductImage image={selected} alt={alt} sizes="(max-width: 700px) 100vw, 50vw" className="gallery-main-image" preload />
      </div>
      {images.length > 1 && (
        <div className="gallery-thumbs">
          {images.map((image, index) => (
            <button key={`${image.url}-${index}`} className="thumb" type="button" aria-pressed={selectedIndex === index}
              aria-label={t('imageN', { n: index + 1 })} onClick={() => setSelectedIndex(index)}>
              <ProductImage image={image} alt={imageAlt(image, name, index, tImages)} sizes="96px" />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
