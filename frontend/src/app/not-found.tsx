import { SiteHeader } from '../shell/SiteHeader';
import { NotFoundView } from '../storefront/NotFoundView';

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main className="container page"><NotFoundView /></main>
    </>
  );
}
