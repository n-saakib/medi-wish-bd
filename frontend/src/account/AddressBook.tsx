'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useSession } from '../auth/SessionProvider';
import { useSessionRedirect } from '../auth/sessionRedirect';
import { ApiError, errorMessageKey, type ErrorMessageKey } from '../lib/api';
import { createAddress, deleteAddress, loadAddresses, updateAddress, type AddressBook as Book, type AddressDraft, type SavedAddress } from '../lib/addresses';
import { Alert } from '../shell/Alert';
import { AddressDialog } from './AddressDialog';

export function AddressBook() {
  const session = useSession();
  const t = useTranslations('addresses');
  useSessionRedirect('account');
  if (!session.profile || session.signingOut || (session.mfa !== 'NOT_REQUIRED' && session.mfa !== 'VERIFIED')) return session.restoring ? <p role="status" className="muted">{t('loading')}</p> : null;
  return <BookEditor key={session.generation} />;
}
function BookEditor() {
  const t = useTranslations('addresses');
  const errors = useTranslations('errors');
  const session = useSession();
  const [book, setBook] = useState<Book | null>(null);
  const [loadError, setLoadError] = useState<ErrorMessageKey | null>(null);
  const [notice, setNotice] = useState<{ text: string; tone?: 'warn' | 'danger'; focus?: boolean } | null>(null);
  const [dialog, setDialog] = useState<{ address?: SavedAddress; id: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const active = useRef(true);
  const flight = useRef(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const refresh = useCallback(async () => {
    setLoadError(null);
    try { const loaded = await loadAddresses(session); if (active.current) setBook(loaded); return loaded; }
    catch (reason) { if (active.current) { setBook(null); setLoadError(errorMessageKey(reason)); } throw reason; }
  }, [session]);
  // authenticatedFetch is stable through a token refresh; do not reload when unrelated session state changes.
  const fetcher = session.authenticatedFetch;
  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(async () => {
      if (cancelled) return;
      try { const loaded = await loadAddresses({ authenticatedFetch: fetcher }); if (!cancelled && active.current) setBook(loaded); }
      catch (reason) { if (!cancelled && active.current) setLoadError(errorMessageKey(reason)); }
    });
    return () => { cancelled = true; };
  }, [fetcher]);
  const returnFocus = useCallback(() => {
    const element = trigger.current;
    if (element?.isConnected && !element.disabled) element.focus(); else title.current?.focus();
  }, []);
  function close(unknownOutcome = false) {
    if (flight.current) return;
    setDialog(null);
    if (unknownOutcome) { flight.current = true; setBusy(true); setBook(null); void refresh().catch(() => {}).finally(() => { flight.current = false; if (active.current) setBusy(false); }); }
  }
  async function command(draft: AddressDraft, remove: boolean): Promise<void> {
    if (!dialog || !book || flight.current || book.accountState !== 'ACTIVE') return;
    flight.current = true;
    setBusy(true);
    setNotice(null);
    try {
      const result = remove && dialog.address ? await deleteAddress(session, dialog.address)
        : dialog.address ? await updateAddress(session, dialog.address, draft) : await createAddress(session, dialog.id, draft);
      if (!active.current) return;
      setBook(result);
      setDialog(null);
      if (remove && dialog.address?.isDefault) {
        const promoted = result.items.find((item) => item.isDefault);
        if (promoted) setNotice({ text: t('promoted', { label: promoted.label ?? promoted.city }) });
      }
    } catch (reason) {
      if (!active.current) return;
      const code = reason instanceof ApiError ? reason.code : '';
      if (code === 'ACCOUNT_CLOSING') {
        setBook({ ...book, accountState: 'CLOSURE_REQUESTED' });
        setDialog(null);
        setNotice({ text: errors('accountClosing'), tone: 'warn', focus: true });
      } else if (['ID_CONFLICT', 'NOT_FOUND', 'ADDRESS_BOOK_FULL', 'ADDRESS_CHANGE_LIMIT_REACHED'].includes(code)) {
        setDialog(null);
        if (!(remove && code === 'NOT_FOUND')) setNotice({
          text: code === 'ID_CONFLICT' ? t('savedEarlier') : errors(errorMessageKey(reason)),
          tone: code === 'ADDRESS_CHANGE_LIMIT_REACHED' ? 'warn' : code === 'ID_CONFLICT' ? undefined : 'danger', focus: true,
        });
        await refresh().catch(() => {});
      } else throw reason;
    } finally { flight.current = false; if (active.current) setBusy(false); }
  }
  async function reloadDialog(): Promise<SavedAddress | undefined> {
    if (flight.current) return;
    flight.current = true;
    setBusy(true);
    try {
      const loaded = await loadAddresses(session);
      if (!active.current) return;
      setBook(loaded);
      const address = loaded.items.find((item) => item.id === dialog?.address?.id);
      if (!address || loaded.accountState !== 'ACTIVE') setDialog(null);
      else setDialog((current) => current && { ...current, address });
      return address;
    } finally { flight.current = false; if (active.current) setBusy(false); }
  }
  const closing = book?.accountState === 'CLOSURE_REQUESTED';
  return <section aria-labelledby="addresses-title">
    <div className="row-between"><h1 id="addresses-title" ref={title} tabIndex={-1} className="mb-0">{t('title')}</h1>{book && <span className="small muted">{t('count', { count: book.items.length, limit: book.limit })}</span>}</div>
    {notice && (notice.tone ? <Alert key={notice.text} tone={notice.tone} focusOnShow={notice.focus}>{notice.text}</Alert> : <p role="status" tabIndex={-1}>{notice.text}</p>)}
    {closing && notice?.text !== errors('accountClosing') && <Alert tone="warn">{errors('accountClosing')}</Alert>}
    {loadError ? <><Alert tone="danger" focusOnShow>{errors(loadError)}</Alert><button className="btn btn-secondary" onClick={() => void refresh().catch(() => {})}>{t('reload')}</button></> : !book ? <p role="status" className="muted">{t('loading')}</p> : <>
      {!book.items.length && <p className="muted">{t('empty')}</p>}
      <div className="grid-3 mt-16">{book.items.map((address) => <article key={address.id} className={`card card-pad address-card${address.isDefault ? ' is-default' : ''}`}>
        <div className="row-between mb-8"><strong>{address.label ?? address.city}</strong>{address.isDefault && <span className="chip chip-brand no-dot">{t('default')}</span>}</div>
        <p className="small mb-0">{address.recipientName} · {address.mobile}<br />{address.addressLine}, {address.city}</p>
        {!closing && <button className="btn btn-ghost btn-sm mt-8" disabled={busy} onClick={(event) => { trigger.current = event.currentTarget; setDialog({ address, id: address.id }); }}>{t('edit')}</button>}
      </article>)}
        {!closing && book.items.length < book.limit && <button className="empty-slot" disabled={busy} onClick={(event) => { trigger.current = event.currentTarget; setDialog({ id: crypto.randomUUID() }); }}>{t('add')}</button>}
      </div>
      {!closing && book.items.length >= book.limit && <p className="muted">{t('full', { limit: book.limit })}</p>}
      {dialog && <AddressDialog key={dialog.id} address={dialog.address} first={!book.items.length} allowance={book.changeAllowance} disabled={busy}
        onClose={close} returnFocus={returnFocus} onSubmit={command} onReload={reloadDialog} />}
    </>}
  </section>;
}
