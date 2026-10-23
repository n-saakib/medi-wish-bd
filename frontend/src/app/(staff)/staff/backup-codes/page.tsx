import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { BackupCodesRegeneration } from '../../../../staff/BackupCodesRegeneration';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('staffMfa.regenerate');
  return { title: t('pageTitle') };
}

export default function BackupCodesPage() {
  return (
    <main className="container page">
      <div className="auth-card">
        <BackupCodesRegeneration />
      </div>
    </main>
  );
}
