import { getTranslations } from 'next-intl/server';
import { SignOutNotice } from '../../auth/SignOutNotice';

export default async function HomePage() {
  const t = await getTranslations('home');
  return (
    <main className="container page stack">
      <SignOutNotice />
      <section className="hero-main" aria-labelledby="home-title">
        <h1 id="home-title">{t('title')}</h1>
        <p>{t('description')}</p>
      </section>
    </main>
  );
}
