'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useSession } from '../auth/SessionProvider';
import { useSessionRedirect } from '../auth/sessionRedirect';
import { errorMessageKey, type ErrorMessageKey } from '../lib/api';
import { fetchStaffAccess, type StaffAccess } from '../lib/staff';
import { Alert } from '../shell/Alert';

/**
 * The staff landing page, reachable only with an MFA-verified session. It proves staff access by loading
 * `GET /api/staff/me` and shows the username, roles and, as text, whether this Admin is the Super Admin.
 */
export function StaffHome() {
  const t = useTranslations('staffHome');
  const tErrors = useTranslations('errors');
  const session = useSession();
  useSessionRedirect('staff');
  const { authenticatedFetch } = session;
  const verified = session.profile !== null && session.mfa === 'VERIFIED';
  const [access, setAccess] = useState<StaffAccess | null>(null);
  const [failure, setFailure] = useState<ErrorMessageKey | null>(null);

  useEffect(() => {
    if (!verified) return;
    let current = true;
    fetchStaffAccess({ authenticatedFetch }).then(
      (loaded) => {
        if (current) setAccess(loaded);
      },
      (reason: unknown) => {
        if (current) setFailure(errorMessageKey(reason));
      },
    );
    return () => {
      current = false;
    };
  }, [verified, authenticatedFetch]);

  if (!verified || (!access && !failure)) {
    return verified || session.restoring || session.profile
      ? <p className="muted" role="status">{t('checking')}</p>
      : null;
  }

  if (!access) return <Alert tone="danger" focusOnShow>{tErrors(failure ?? 'genericError')}</Alert>;

  return (
    <section className="card card-pad stack" aria-labelledby="staff-home-title">
      <h1 id="staff-home-title">{t('title')}</h1>
      <dl className="dl">
        <dt>{t('username')}</dt>
        <dd>{access.username}</dd>
        <dt>{t('roles')}</dt>
        <dd>{access.roles.map((role) => (t.has(`roleNames.${role}`) ? t(`roleNames.${role}`) : role)).join(', ')}</dd>
      </dl>
      {access.superAdmin && <p><span className="chip chip-brand">{t('superAdmin')}</span></p>}
      {(access.roles.includes('ADMIN') || access.roles.includes('MODERATOR')) &&
        <nav className="catalog-home-links" aria-label={t('title')}>
          <Link className="btn btn-secondary" href="/staff/products">{t('products')}</Link>
          <Link className="btn btn-secondary" href="/staff/categories">{t('categories')}</Link>
        </nav>}
    </section>
  );
}
