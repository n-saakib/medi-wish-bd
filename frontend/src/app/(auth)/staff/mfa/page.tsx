import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { MfaChallenge } from '../../../../auth/MfaChallenge';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('staffMfa');
  return { title: t('challengeTitle') };
}

export default function StaffMfaPage() {
  return <MfaChallenge />;
}
