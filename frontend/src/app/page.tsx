import { getTranslations } from 'next-intl/server';
import { UserAccessPanel } from './UserAccessPanel';

export default async function HomePage() {
  const t = await getTranslations('home');
  return (
    <main>
      <h1>{t('title')}</h1>
      <p>{t('description')}</p>
      <UserAccessPanel />
    </main>
  );
}
