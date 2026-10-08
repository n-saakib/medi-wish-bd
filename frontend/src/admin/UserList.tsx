'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { useSession } from '../auth/SessionProvider';
import { useSessionRedirect } from '../auth/sessionRedirect';
import { listUsers, userRoles, type UserFilter, type UserPage, type UserRole } from '../lib/adminUsers';
import { ApiError } from '../lib/api';
import { Alert } from '../shell/Alert';

/** The Admin's bounded list. Filters live only in memory and search bodies; the API decides authorization. */
export function UserList() {
  const t = useTranslations('adminUsers');
  const roles = useTranslations('staffHome.roleNames');
  const session = useSession();
  useSessionRedirect('staff');
  const verified = session.profile !== null && session.mfa === 'VERIFIED';
  const { authenticatedFetch } = session;
  const [username, setUsername] = useState('');
  const [role, setRole] = useState<UserRole | ''>('');
  const [filter, setFilter] = useState<UserFilter>({});
  const [loaded, setLoaded] = useState<UserPage | null>(null);
  const [failure, setFailure] = useState<'accessDenied' | 'genericError' | null>(null);

  useEffect(() => {
    if (!verified) return;
    let current = true;
    listUsers({ authenticatedFetch }, filter).then(
      (page) => { if (current) setLoaded(page); },
      (reason: unknown) => { if (current) setFailure(reason instanceof ApiError && reason.code === 'ACCESS_DENIED'
        ? 'accessDenied' : 'genericError'); },
    );
    return () => { current = false; };
  }, [authenticatedFetch, filter, verified]);

  function load(next: UserFilter) {
    setLoaded(null);
    setFailure(null);
    setFilter(next);
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    load({ ...(username.trim() ? { username: username.trim() } : {}), ...(role ? { role } : {}), page: 0 });
  }
  if (!verified) return null;
  return (
    <main className="container page stack admin-users">
      <div><h1>{t('title')}</h1><p className="muted">{t('intro')}</p></div>
      <section className="card">
        <form method="post" className="toolbar" onSubmit={submit}>
          <div className="field admin-search"><label htmlFor="admin-user-search">{t('searchLabel')}</label>
            <input id="admin-user-search" className="input" value={username} maxLength={50}
              placeholder={t('searchPlaceholder')} onChange={(event) => setUsername(event.target.value)} />
          </div>
          <div className="field"><label htmlFor="admin-user-role">{t('role')}</label>
            <select id="admin-user-role" className="select" value={role} onChange={(event) => setRole(event.target.value as UserRole | '')}>
              <option value="">{t('anyRole')}</option>{userRoles.map((value) => <option key={value} value={value}>{roles(value)}</option>)}
            </select>
          </div>
          <button type="submit" className="btn btn-primary">{t('search')}</button>
        </form>
        {failure ? <div className="card-body"><Alert tone="danger" focusOnShow>{t(failure)}</Alert></div>
          : !loaded ? <p className="card-body muted" role="status">{t('checking')}</p>
          : loaded.items.length === 0 ? <p className="card-body">{t('empty')}</p>
          : <>
            <div className="table-wrap"><table className="table" aria-label={t('users')}>
              <thead><tr><th>{t('user')}</th><th>{t('role')}</th><th>{t('staffMfa')}</th><th>{t('joined')}</th><th><span className="sr-only">{t('open')}</span></th></tr></thead>
              <tbody>{loaded.items.map((user) => <tr key={user.id}>
                <td><strong>{user.username}</strong>{user.superAdmin && <div><span className="chip chip-brand">{t('superAdmin')}</span></div>}</td>
                <td><span className="chip chip-brand">{roles(user.role)}</span></td>
                <td><span className={`chip ${user.staffMfa === 'ENROLLED' ? 'chip-success' : user.staffMfa === 'SETUP_REQUIRED' ? 'chip-warn' : ''}`}>{t(`mfaStates.${user.staffMfa}`)}</span></td>
                <td>{new Intl.DateTimeFormat('en', { month: 'short', year: 'numeric' }).format(new Date(user.createdAt))}</td>
                <td><Link className="btn btn-secondary" href={`/admin/users/${user.id}`} aria-label={t('openUser', { username: user.username })}>{t('open')}</Link></td>
              </tr>)}</tbody>
            </table></div>
            <div className="pager"><span>{t('showing', { start: loaded.page * loaded.size + 1,
              end: loaded.page * loaded.size + loaded.items.length, total: loaded.totalItems })}</span>
              <div className="row"><button type="button" className="btn btn-secondary" disabled={loaded.page === 0}
                onClick={() => load({ ...filter, page: loaded.page - 1 })}>{t('previous')}</button>
                <button type="button" className="btn btn-secondary" disabled={(loaded.page + 1) * loaded.size >= loaded.totalItems}
                  onClick={() => load({ ...filter, page: loaded.page + 1 })}>{t('next')}</button></div>
            </div>
          </>}
      </section>
    </main>
  );
}
