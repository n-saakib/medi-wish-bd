'use client';
import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ApiError, errorMessageKey, type ErrorMessageKey } from '../lib/api';
import type { AddressDraft, ChangeAllowance, SavedAddress } from '../lib/addresses';
import { Alert } from '../shell/Alert';
type Props = { address?: SavedAddress; first: boolean; allowance: ChangeAllowance; disabled: boolean; onClose: (unknownOutcome?: boolean) => void; returnFocus: () => void; onSubmit: (draft: AddressDraft, remove: boolean) => Promise<void>; onReload: () => Promise<SavedAddress | undefined> };
const limits = { label: 40, recipientName: 100, mobile: 11, addressLine: 200, city: 60 };
type Field = keyof typeof limits;
function trim(value: string): string { return value.replace(/^[\x00-\x20]+|[\x00-\x20]+$/g, ''); }
function draftOf(address: SavedAddress | undefined, first: boolean): AddressDraft { return { label: address?.label ?? '', recipientName: address?.recipientName ?? '', mobile: address?.mobile ?? '', addressLine: address?.addressLine ?? '', city: address?.city ?? '', isDefault: address?.isDefault ?? first }; }
export function AddressDialog({ address, first, allowance, disabled, onClose, returnFocus, onSubmit, onReload }: Props) {
  const t = useTranslations('addresses');
  const errors = useTranslations('errors');
  const element = useRef<HTMLDialogElement>(null);
  const mounted = useRef(true);
  const flight = useRef(false);
  const unknownOutcome = useRef(false);
  const [draft, setDraft] = useState(() => draftOf(address, first));
  const [invalid, setInvalid] = useState<Field[]>([]);
  const [error, setError] = useState<ErrorMessageKey | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    mounted.current = true;
    const dialog = element.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => { mounted.current = false; if (dialog?.open) dialog.close(); returnFocus(); };
  }, [returnFocus]);
  function close() { if (!flight.current && !disabled) onClose(unknownOutcome.current); }
  async function run(remove: boolean) {
    if (flight.current || disabled) return;
    if (!remove) {
      const fields = (Object.keys(limits) as Field[]).filter((field) => {
        const value = trim(draft[field] ?? '');
        return /[\p{Cc}\p{Zl}\p{Zp}]/u.test(draft[field] ?? '') || value.length > limits[field] || (field !== 'label' && !value) || (field === 'mobile' && !/^[0-9]{11}$/.test(value));
      });
      setInvalid(fields);
      if (fields.length) { document.getElementById(`address-${fields[0]}`)?.focus(); return; }
    }
    flight.current = true; setBusy(true); setError(null);
    try { await onSubmit({ ...draft, label: draft.label === null ? null : trim(draft.label) || null }, remove); }
    catch (reason) { if (mounted.current) {
      setError(errorMessageKey(reason));
      if (reason instanceof ApiError && reason.code === 'STALE_UPDATE') setStale(true);
      if (!(reason instanceof ApiError) || reason.status === 0 || reason.status >= 500 || reason.code === 'INVALID_RESPONSE') unknownOutcome.current = true;
    } }
    finally { flight.current = false; if (mounted.current) setBusy(false); }
  }
  async function reload() {
    if (flight.current || disabled) return;
    flight.current = true; setBusy(true);
    try { const loaded = await onReload(); if (mounted.current && loaded) { setDraft(draftOf(loaded, false)); setConfirm(false); setInvalid([]); setError(null); setStale(false); unknownOutcome.current = false; } }
    catch (reason) { if (mounted.current) setError(errorMessageKey(reason));
      if (reason instanceof ApiError && reason.code === 'STALE_UPDATE') setStale(true); }
    finally { flight.current = false; if (mounted.current) setBusy(false); }
  }
  function trapFocus(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== 'Tab') return;
    const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('input:not(:disabled), button:not(:disabled), [tabindex="0"]')];
    const first = controls[0];
    const last = controls.at(-1);
    if ((!event.shiftKey && document.activeElement === last) || (event.shiftKey && document.activeElement === first)) {
      event.preventDefault();
      (event.shiftKey ? last : first)?.focus();
    }
  }
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); void run(false); }
  return <dialog ref={element} className="profile-dialog" aria-labelledby="address-dialog-title" aria-describedby="address-change-notice"
    onKeyDown={trapFocus} onCancel={(event) => { event.preventDefault(); close(); }} onClose={() => { if (!element.current?.open && mounted.current) close(); }}>
    <form className="stack" noValidate onSubmit={submit}>
      <h2 id="address-dialog-title">{t(address ? 'dialogEditTitle' : 'dialogAddTitle')}</h2>
      {error && <Alert key={error} tone="danger" focusOnShow>{errors(error)}</Alert>}
      {stale && <button type="button" className="btn btn-secondary" disabled={busy || disabled} onClick={() => void reload()}>{t('reload')}</button>}
      {(Object.keys(limits) as Field[]).map((field) => <div className="field" key={field}>
        <label htmlFor={`address-${field}`}>{t(field)}</label>
        <input id={`address-${field}`} className="input" type={field === 'mobile' ? 'tel' : 'text'} inputMode={field === 'mobile' ? 'numeric' : undefined}
          maxLength={limits[field]} value={draft[field] ?? ''} disabled={disabled || busy} aria-invalid={invalid.includes(field) || undefined}
          aria-describedby={invalid.includes(field) ? `address-${field}-error` : undefined}
          placeholder={field === 'label' ? t('labelPlaceholder') : field === 'addressLine' ? t('addressLinePlaceholder') : undefined}
          onChange={(event) => { setDraft((current) => ({ ...current, [field]: event.target.value })); setInvalid((current) => current.filter((name) => name !== field)); }} />
        {invalid.includes(field) && <p id={`address-${field}-error`} className="error-text" role="alert">{t('fieldInvalid')}</p>}
      </div>)}
      <label className="catalog-check"><input type="checkbox" checked={draft.isDefault} disabled={disabled || busy || first || address?.isDefault} onChange={(event) => setDraft((current) => ({ ...current, isDefault: event.target.checked }))} />{t('makeDefault')}</label>
      {(first || address?.isDefault) && <p className="small muted mb-0">{t(first ? 'firstIsDefault' : 'defaultHint')}</p>}
      <p id="address-change-notice" className="muted">{t('changeNotice', allowance)}</p>
      {confirm ? <div key="confirmation" className="profile-actions"><p>{t('removeConfirm')}</p><button type="button" className="btn btn-danger-ghost" disabled={busy || disabled} onClick={() => void run(true)}>{t('remove')}</button><button type="button" className="btn btn-secondary" disabled={busy || disabled} onClick={() => setConfirm(false)}>{t('keep')}</button></div>
        : <div key="actions" className="profile-actions">{address && <button type="button" className="btn btn-ghost btn-danger-ghost" disabled={busy || disabled} onClick={() => setConfirm(true)}>{t('remove')}</button>}
          <button type="button" className="btn btn-secondary" disabled={busy || disabled} onClick={close}>{t('cancel')}</button><button type="submit" className="btn btn-primary" disabled={busy || disabled}>{t(busy ? 'saving' : 'save')}</button></div>}
    </form>
  </dialog>;
}
