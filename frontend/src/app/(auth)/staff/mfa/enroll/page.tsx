import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { MfaEnrollment } from '../../../../../auth/MfaEnrollment';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('staffMfa');
  return { title: t('enrollTitle') };
}

export default function StaffMfaEnrollPage() {
  return <MfaEnrollment />;
}
