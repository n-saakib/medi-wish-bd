import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ProfileForm } from '../../../../account/ProfileForm';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('profile');
  return { title: t('title') };
}

export default function ProfilePage() {
  return <main className="container page"><ProfileForm /></main>;
}
