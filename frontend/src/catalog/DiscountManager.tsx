'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useSession } from '../auth/SessionProvider';
import { useSessionRedirect } from '../auth/sessionRedirect';
import { errorMessageKey, type ErrorMessageKey } from '../lib/api';
import { formatTaka } from '../lib/catalog';
import { createDiscountClient, type Discount, type DiscountPage, type DiscountStatus } from '../lib/discounts';
import { formatDate } from '../lib/dateTime';
import { fetchStaffAccess } from '../lib/staff';
import { Alert } from '../shell/Alert';
import { usePagerFocus } from '../shell/usePagerFocus';
import { DiscountDialog } from './DiscountDialog';

export function DiscountManager() {
  const t = useTranslations('discounts');
  const errors = useTranslations('errors');
  const session = useSession();
  useSessionRedirect('staff');
  const { authenticatedFetch } = session;
  const ready = !!session.profile && session.mfa === 'VERIFIED';
  const [admin, setAdmin] = useState<boolean | null>(null);
  const [status, setStatus] = useState<DiscountStatus>('ACTIVE');
  const [page, setPage] = useState(0);
  const [result, setResult] = useState<DiscountPage | null>(null);
  const [counts, setCounts] = useState<DiscountPage['counts'] | null>(null);
  const [failure, setFailure] = useState<ErrorMessageKey | null>(null);
  const [reload, setReload] = useState(0);
  const [editing, setEditing] = useState<Discount | 'new' | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const [unknown, setUnknown] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const activeTab = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const { pager, markTurn } = usePagerFocus(result);

  useEffect(() => {
    if (!ready) return;
    let current = true;
    fetchStaffAccess({ authenticatedFetch }).then((access) => {
      if (current) setAdmin(access.roles.includes('ADMIN'));
    }, (reason: unknown) => { if (current) setFailure(errorMessageKey(reason)); });
    return () => { current = false; };
  }, [ready, authenticatedFetch, reload]);

  useEffect(() => {
    if (!ready || !admin) return;
    let current = true;
    createDiscountClient({ authenticatedFetch }).listDiscounts(status, page).then((value) => {
      if (current) { setResult(value); setCounts(value.counts); setFailure(null); }
    }, (reason: unknown) => { if (current) { setResult(null); setFailure(errorMessageKey(reason)); } });
    return () => { current = false; };
  }, [ready, admin, authenticatedFetch, status, page, reload]);

  useEffect(() => {
    // The selected tab survives a reload even when End removes the Edit opener.
    if (saved) activeTab.current?.focus();
  }, [saved, reload]);

  function refresh() {
    setResult(null); setFailure(null); setReload((value) => value + 1);
    heading.current?.focus();
  }
  function open(item: Discount | 'new') {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSaved(false); setEditing(item); setDialogOpen(true);
  }
  function close(changed = false, uncertain = false) {
    setDialogOpen(false);
    if (!uncertain) setEditing(null);
    if (changed || uncertain) {
      setSaved(changed); setUnknown(uncertain); refresh();
      if (uncertain) activeTab.current?.focus();
    } else opener.current?.focus();
  }
  function turn(nextStatus: DiscountStatus, nextPage: number) {
    markTurn(); setResult(null); setFailure(null); setStatus(nextStatus); setPage(nextPage);
  }
  if (!ready) return null;
  if (admin === false) return <main className="container page"><Alert tone="danger" focusOnShow>{errors('accessDenied')}</Alert></main>;
  return <main className="container page stack">
    <div className="catalog-heading"><h1 ref={heading} tabIndex={-1}>{t('title')}</h1>
      {admin && <button className="btn btn-primary" disabled={unknown || !result} onClick={() => open('new')}>{t('new')}</button>}
      <Link className="btn btn-ghost" href="/staff/categories">{t('categories')}</Link></div>
    <p>{t('intro')}</p>
    {saved && <Alert tone="success">{t('saved')}</Alert>}
    {unknown && <Alert tone="warn">{t('unknown')}
      <button className="btn btn-secondary" onClick={() => setDialogOpen(true)}>{t('retryPending')}</button></Alert>}
    {failure && <Alert tone="danger" focusOnShow>{errors(failure)}
      <button className="btn btn-secondary" onClick={refresh}>{t('retry')}</button></Alert>}
    {admin && <div className="pill-tabs" aria-label={t('title')}>
      {(['ACTIVE', 'SCHEDULED', 'ENDED'] as const).map((tab) => <button key={tab} data-status={tab} ref={status === tab ? activeTab : undefined}
        aria-pressed={status === tab} onClick={() => turn(tab, 0)}>{t(tab)}
        {tab !== 'ENDED' && counts && <> <span className="n">{counts[tab === 'ACTIVE' ? 'active' : 'scheduled']}</span></>}
      </button>)}
    </div>}
    {!failure && !result && <p role="status">{t('loading')}</p>}
    {result && <div className="card">
      {result.items.length > 0 ? <div className="catalog-table-scroll"><table className="catalog-table" aria-label={t('title')}>
        <thead><tr>{['appliesTo', 'type', 'value', 'starts', 'ends', 'status', 'edit'].map((key) =>
          <th key={key}>{key === 'edit' ? <span className="sr-only">{t(key)}</span> : t(key)}</th>)}</tr></thead>
        <tbody>{result.items.map((item) => <tr key={item.id}>
          <td><strong>{item.targetName}</strong><span className="catalog-secondary">{item.targetType === 'CATEGORY'
            ? t('categoryCount', { count: item.productCount! }) : t('product')}</span></td>
          <td>{t(item.kind === 'PERCENTAGE' ? 'percentage' : 'flat')}</td>
          <td>{item.kind === 'PERCENTAGE' ? `${item.value}%` : formatTaka(item.value, t('currency'))}</td>
          <td>{formatDate(item.startsOn)}</td><td>{item.endsOn ? formatDate(item.endsOn) : t('noEnd')}</td>
          <td><span className={item.status === 'ACTIVE' ? 'chip chip-success' : item.status === 'SCHEDULED' ? 'chip chip-info' : 'chip'}>{t(item.status)}</span></td>
          <td>{item.status !== 'ENDED' && <button className="btn btn-secondary" disabled={unknown} onClick={() => open(item)}>{t('edit')}</button>}</td>
        </tr>)}</tbody></table></div> : <p className="card-pad">{t(result.totalItems === 0 ? `empty${status}` : 'emptyPage')}</p>}
      {result.totalItems > 0 && <div className="catalog-pager" ref={pager}><span aria-live="polite">{result.items.length === 0 ? t('emptyPage')
        : t('showing', { start: page * result.size + 1, end: page * result.size + result.items.length, total: result.totalItems })}</span>
        <div><button className="btn btn-secondary" disabled={page === 0} onClick={() => turn(status, page - 1)}>{t('previous')}</button>
          <button className="btn btn-secondary" disabled={(page + 1) * result.size >= result.totalItems} onClick={() => turn(status, page + 1)}>{t('next')}</button></div>
      </div>}
    </div>}
    <p className="small muted">{t('footer')}</p>
    {editing && <DiscountDialog open={dialogOpen} editing={editing} authenticatedFetch={authenticatedFetch} onClose={close} onReload={() => close(true)} />}
  </main>;
}
