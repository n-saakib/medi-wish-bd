import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { UserRolePage } from '../../../../../admin/UserRolePage';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('adminUsers');
  return { title: t('pageTitle') };
}
export default function AdminUserPage() {
  return <UserRolePage />;
}
