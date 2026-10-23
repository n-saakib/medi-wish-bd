import { useTranslations } from 'next-intl';
import { formatTaka } from '../lib/catalog';
import type { PublicPrice } from '../lib/storefront';
import { priceBlock } from '../lib/storefrontView';

export function PriceBlock({ price, size, showBadge = true }: { price: PublicPrice; size: 'card' | 'large'; showBadge?: boolean }) {
  const t = useTranslations('storefront');
  const projected = priceBlock(price);
  const currency = t('currency');
  return (
    <div className="price-row">
      <span className={`price${size === 'large' ? ' price-large' : ''}`}>{formatTaka(projected.current, currency)}</span>
      {projected.struck && (
        <s className="price-was"><span className="sr-only">{t('wasPrice')} </span>{formatTaka(projected.struck, currency)}</s>
      )}
      {showBadge && projected.badge && (
        <span className="badge-sale">
          {projected.badge.kind === 'percent'
            ? t('percentOff', { value: projected.badge.value })
            : t('amountOff', { amount: formatTaka(projected.badge.value, currency) })}
        </span>
      )}
      {projected.mrp && <span className="mrp-label">{t('mrp', { amount: formatTaka(projected.mrp, currency) })}</span>}
    </div>
  );
}
