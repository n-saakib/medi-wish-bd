import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { StaffHome } from '../../../staff/StaffHome';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('staffHome');
  return { title: t('pageTitle') };
}

export default function StaffPage() {
  return (
    <main className="container page">
      <div className="auth-card">
        <StaffHome />
      </div>
    </main>
  );
}
