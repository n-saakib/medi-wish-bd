import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { AccountSummary } from '../../../account/AccountSummary';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('account');
  return { title: t('title') };
}

export default function AccountPage() {
  return (
    <main className="container page">
      <div className="auth-card">
        <AccountSummary />
      </div>
    </main>
  );
}
