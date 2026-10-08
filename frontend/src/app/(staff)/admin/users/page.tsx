import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { UserList } from '../../../../admin/UserList';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('adminUsers');
  return { title: t('pageTitle') };
}
export default function AdminUsersPage() {
  return <UserList />;
}
