import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { RegistrationForm } from '../../../auth/RegistrationForm';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('register');
  return { title: t('title') };
}

export default function RegisterPage() {
  return <RegistrationForm />;
}
