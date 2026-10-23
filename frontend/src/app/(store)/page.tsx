import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { connection } from 'next/server';
import { SignOutNotice } from '../../auth/SignOutNotice';
import { HomeCategories } from '../../storefront/HomeCategories';
import { canonicalUrl } from '../../lib/storefrontView';

export async function generateMetadata(): Promise<Metadata> {
  await connection();
  return { alternates: { canonical: canonicalUrl('/') } };
}

export default async function HomePage() {
  await connection();
  const t = await getTranslations('home');
  return (
    <main className="container page stack">
      <SignOutNotice />
      <section className="hero-main" aria-labelledby="home-title">
        <h1 id="home-title">{t('title')}</h1>
        <p>{t('description')}</p>
      </section>
      <HomeCategories />
    </main>
  );
}
