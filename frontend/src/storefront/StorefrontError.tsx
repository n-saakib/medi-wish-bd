'use client';
import { useTranslations } from 'next-intl';

export function StorefrontError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const t = useTranslations('storefront');
  return (
    <main className="container page">
      <section className="center storefront-error" role="alert">
        <h1>{t('errorTitle')}</h1>
        <p className="muted">{t('errorText')}</p>
        <button className="btn btn-secondary" type="button" onClick={retry}>{t('tryAgain')}</button>
      </section>
    </main>
  );
}
