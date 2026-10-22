import { connection } from 'next/server';
import { CategoryNav } from '../../storefront/CategoryNav';
import { SiteHeader } from '../../shell/SiteHeader';

export default async function StoreLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await connection();
  return (
    <>
      <SiteHeader />
      <CategoryNav />
      {children}
    </>
  );
}
