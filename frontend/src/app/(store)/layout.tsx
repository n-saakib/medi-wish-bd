import { SiteHeader } from '../../shell/SiteHeader';

export default function StoreLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <SiteHeader />
      {children}
    </>
  );
}
