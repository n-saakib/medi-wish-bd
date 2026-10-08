'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { useSession } from '../auth/SessionProvider';
import { useSessionRedirect } from '../auth/sessionRedirect';
import { isUserId, loadUserRoles, saveRole, userRoles, type UserRole, type UserRoles } from '../lib/adminUsers';
import { errorMessageKey } from '../lib/api';
import { formatDateTime } from '../lib/dateTime';
import { Alert } from '../shell/Alert';

type Failure = 'staleUpdate' | 'roleChangeRefused' | 'accessDenied' | 'notFound' | 'genericError';
function failureKey(reason: unknown): Failure {
  const key = errorMessageKey(reason);
  switch (key) {
    case 'staleUpdate':
    case 'roleChangeRefused':
    case 'accessDenied':
    case 'notFound':
      return key;
    default: return 'genericError';
  }
}

/** Loads a UUID detail and replaces one role. Failed saves retain the intent and version for a safe retry. */
export function UserRoleForm({ userId }: { userId: string }) {
  const t = useTranslations('adminUsers');
  const roles = useTranslations('staffHome.roleNames');
  const session = useSession();
  useSessionRedirect('staff');
  const verified = session.profile !== null && session.mfa === 'VERIFIED';
  const { authenticatedFetch } = session;
  const [loaded, setLoaded] = useState<{ id: string; data?: UserRoles; failure?: Failure } | null>(null);
  const [selected, setSelected] = useState<UserRole | null>(null);
  const [reloads, setReloads] = useState(0);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [success, setSuccess] = useState(false);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);

  useEffect(() => {
    if (!verified || !isUserId(userId)) return;
    let current = true;
    loadUserRoles({ authenticatedFetch }, userId).then(
      (data) => { if (current) { setLoaded({ id: userId, data }); setSelected(data.role); } },
      (reason: unknown) => { if (current) setLoaded({ id: userId, failure: failureKey(reason) }); },
    );
    return () => { current = false; };
  }, [authenticatedFetch, userId, verified, reloads]);

  function reload() {
    setLoaded(null);
    setFailure(null);
    setSuccess(false);
    setReloads((value) => value + 1);
  }
  const data = loaded?.id === userId ? loaded.data : undefined;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data || !selected || saving.current || selected === data.role || !data.assignableRoles.includes(selected)) return;
    saving.current = true;
    setBusy(true);
    setFailure(null);
    setSuccess(false);
    try {
      const updated = await saveRole({ authenticatedFetch }, userId, selected, data.rolesVersion);
      setLoaded({ id: userId, data: updated });
      setSelected(updated.role);
      setSuccess(true);
    } catch (reason) {
      setFailure(failureKey(reason));
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  if (!verified) return null;
  const loadFailure = !isUserId(userId) ? 'notFound' : loaded?.id === userId ? loaded.failure : undefined;
  const adminDisabled = data ? !data.assignableRoles.includes('ADMIN') : false;
  const note = data?.self ? 'selfNote' : data?.superAdmin ? 'superAdminNote' : adminDisabled ? 'adminNote' : null;
  return (
    <main className="container page stack admin-users">
      <nav className="breadcrumb" aria-label={t('breadcrumb')}><Link className="btn btn-ghost" href="/admin/users">{t('title')}</Link></nav>
      {loadFailure ? <Alert tone="danger" focusOnShow>{t(loadFailure)}</Alert>
        : !data ? <p role="status" className="muted">{t('checkingRole')}</p>
        : <>
          <div><h1>{data.username}</h1><p className="muted">{t('joinedDate', {
            date: new Intl.DateTimeFormat('en', { month: 'short', year: 'numeric' }).format(new Date(data.createdAt)),
          })}</p>{data.superAdmin && <span className="chip chip-brand">{t('superAdmin')}</span>}</div>
          {failure && <Alert tone="danger" focusOnShow>{t(failure)}{failure === 'staleUpdate' && <>
            {' '}<button type="button" className="btn btn-secondary" onClick={reload}>{t('reload')}</button>
          </>}</Alert>}
          {success && <Alert tone="success" focusOnShow>{t('saved', { username: data.username })}</Alert>}
          <section className="card" aria-labelledby="admin-role-heading">
            <div className="card-head"><h2 id="admin-role-heading">{t('role')}</h2></div>
            <form method="post" onSubmit={(event) => void submit(event)}>
              <div className="card-body stack">
                <div role="radiogroup" aria-labelledby="admin-role-heading" className="stack-s">
                  {userRoles.map((role) => <label className={`choice${selected === role ? ' is-selected' : ''}`} key={role}>
                    <input type="radio" name="role" value={role} checked={selected === role}
                      disabled={busy || !data.assignableRoles.includes(role)}
                      aria-describedby={role === 'ADMIN' && adminDisabled && note ? 'admin-role-note' : undefined}
                      onChange={() => { setSelected(role); setSuccess(false); }} />
                    <span>{role === 'MODERATOR' ? t('moderatorOption') : role === 'ADMIN' ? t('adminOption') : roles(role)}</span>
                  </label>)}
                </div>
                {note && <p id="admin-role-note" className="muted">{t(note)}</p>}
              </div>
              <div className="card-foot row-between"><p className="small muted mb-0">{t('footerNote')}</p>
                <button type="submit" className="btn btn-primary" disabled={busy || !selected || selected === data.role || !data.assignableRoles.includes(selected)}>
                  {t(busy ? 'saving' : 'save')}
                </button>
              </div>
            </form>
          </section>
          <section className="card card-pad"><h2>{t('history')}</h2>
            {data.roleChanges.length === 0 ? <p className="muted">{t('emptyHistory')}</p>
              : <ul className="role-history" aria-label={t('history')}>{data.roleChanges.map((change, index) => <li key={index}>
                {t('change', { oldRole: roles(change.oldRole), newRole: roles(change.newRole),
                  actor: change.actorUsername ?? t('deletedActor'), date: formatDateTime(change.occurredAt) })}
              </li>)}</ul>}
          </section>
        </>}
    </main>
  );
}
