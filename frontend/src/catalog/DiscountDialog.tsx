'use client';

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useTranslations } from 'next-intl';
import { ApiError, errorMessageKey, type ErrorMessageKey } from '../lib/api';
import { createCatalogClient, moneyCents, newId, type CatalogSession } from '../lib/catalog';
import { createDiscountClient, dhakaToday, type Discount, type DiscountDraft, type DiscountKind, type DiscountTargetType } from '../lib/discounts';
import { Alert } from '../shell/Alert';

type Props = CatalogSession & { open: boolean; editing: Discount | 'new'; onClose: (changed?: boolean, uncertain?: boolean) => void; onReload: () => void };
type Field = 'target' | 'value' | 'starts' | 'ends';
type Option = { id: string; name: string };

export function DiscountDialog({ open, editing, authenticatedFetch, onClose, onReload }: Props) {
  const t = useTranslations('discounts');
  const catalog = useTranslations('catalog');
  const errors = useTranslations('errors');
  const item = editing === 'new' ? null : editing;
  const [targetType, setTargetType] = useState<DiscountTargetType>(item?.targetType ?? 'CATEGORY');
  const [targetId, setTargetId] = useState(item?.targetId ?? '');
  const [kind, setKind] = useState<DiscountKind>(item?.kind ?? 'PERCENTAGE');
  const [value, setValue] = useState(item?.value ?? '');
  const [starts, setStarts] = useState(item?.startsOn ?? dhakaToday());
  const [ends, setEnds] = useState(item?.endsOn ?? '');
  const [search, setSearch] = useState('');
  const [options, setOptions] = useState<Option[]>([]);
  const [loading, setLoading] = useState(!item);
  const [pickerError, setPickerError] = useState<ErrorMessageKey | null>(null);
  const [pickerRetry, setPickerRetry] = useState(0);
  const [failure, setFailure] = useState<ErrorMessageKey | null>(null);
  const [stale, setStale] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<Field, string>>>({});
  const [pending, setPending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const pendingRef = useRef(false);
  const createId = useRef<string | null>(null);
  const attempted = useRef<DiscountDraft | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const focusField = useRef<Field | null>(null);
  const endAction = useRef<HTMLButtonElement>(null);
  const previousConfirmation = useRef(false);
  const today = dhakaToday();
  const started = !!item && item.startsOn <= today;
  const locked = pending || uncertain;

  useEffect(() => {
    const element = dialog.current;
    if (open) element?.showModal();
    else element?.close();
    return () => { element?.close(); };
  }, [open]);
  useEffect(() => {
    if (item) return;
    let current = true;
    const client = createCatalogClient({ authenticatedFetch });
    const result = targetType === 'CATEGORY' ? client.listCategoryOptions()
      : client.listProducts({ q: search.trim() || undefined, size: 20 }).then((page) => page.items);
    result.then((loaded) => { if (current) { setOptions(loaded); setLoading(false); setPickerError(null); } },
      (reason: unknown) => { if (current) { setOptions([]); setLoading(false); setPickerError(errorMessageKey(reason)); } });
    return () => { current = false; };
  }, [authenticatedFetch, item, targetType, search, pickerRetry]);
  useEffect(() => {
    if (pending || !focusField.current) return;
    document.getElementById(`discount-${focusField.current}`)?.focus();
    focusField.current = null;
  }, [fieldErrors, pending]);
  useEffect(() => {
    if (previousConfirmation.current === confirming) return;
    previousConfirmation.current = confirming;
    endAction.current?.focus();
  }, [confirming]);

  function close() {
    if (pendingRef.current) return;
    // Release the native modal's inert background before its opener receives focus.
    dialog.current?.close();
    onClose(false, uncertain);
  }
  function keepFocus(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== 'Tab' || event.altKey || event.ctrlKey || event.metaKey) return;
    const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex]'))
      .filter((control) => control.tabIndex >= 0 && !control.matches(':disabled, input[type="radio"]:not(:checked)'));
    const first = controls[0];
    const last = controls.at(-1);
    const active = document.activeElement;
    if (!first || !last) { event.preventDefault(); return; }
    if (!controls.some((control) => control === active) || (event.shiftKey ? active === first : active === last)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    }
  }
  function retryPicker() {
    // Retry disappears during loading; keep focus on the selected, usable target type.
    dialog.current?.querySelector<HTMLInputElement>('input[name="targetType"]:checked')?.focus();
    setLoading(true); setPickerError(null); setPickerRetry((before) => before + 1);
  }
  function selectType(next: DiscountTargetType) {
    setTargetType(next); setTargetId(''); setOptions([]); setLoading(true); setPickerError(null); setFieldErrors({});
  }
  function updateSearch(next: string) { setSearch(next); setTargetId(''); setOptions([]); setLoading(true); setPickerError(null); }
  function clear(field: Field) { setFieldErrors((before) => ({ ...before, [field]: undefined })); }
  function validate(): boolean {
    const found: Partial<Record<Field, string>> = {};
    if (!targetId) found.target = t('targetRequired');
    if (!value) found.value = t('valueRequired');
    else if (kind === 'PERCENTAGE' && !/^[1-9][0-9]?$/.test(value)) found.value = t('percentFormat');
    else if (kind === 'FLAT') {
      const amount = moneyCents(value);
      if (amount === 'format' || amount === 'range') found.value = catalog(amount === 'format' ? 'moneyFormat' : 'moneyRange');
    }
    if (!starts) found.starts = t('startsRequired');
    else if (!started && starts < today) found.starts = t('startsPast');
    if (ends && ends < (starts > today ? starts : today)) found.ends = t('endsBeforeStart');
    setFieldErrors(found); focusField.current = (Object.keys(found)[0] as Field | undefined) ?? null;
    return Object.keys(found).length === 0;
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pendingRef.current || (!uncertain && !validate())) return;
    pendingRef.current = true; setPending(true); setFailure(null); setStale(false);
    try {
      const client = createDiscountClient({ authenticatedFetch });
      if (item) await client.updateDiscount(item.id, { kind, value, startsOn: starts, endsOn: ends || null, version: item.version });
      else {
        createId.current ??= newId();
        attempted.current ??= { id: createId.current, targetType, targetId, kind, value, startsOn: starts, endsOn: ends || null };
        await client.createDiscount(attempted.current);
      }
      onClose(true);
    } catch (reason) {
      if (reason instanceof ApiError && reason.code === 'STALE_UPDATE') setStale(true);
      else setFailure(errorMessageKey(reason));
      if (!item) {
        // A transport or invalid success response may have committed; retain exactly the submitted intent.
        const ambiguous = !(reason instanceof ApiError) || reason.status === 0 || reason.code === 'INVALID_RESPONSE' || reason.status >= 500;
        if (ambiguous) setUncertain(true);
        else if (!uncertain) attempted.current = null;
      }
    } finally { pendingRef.current = false; setPending(false); }
  }
  async function end() {
    if (!item || pendingRef.current) return;
    pendingRef.current = true; setPending(true); setFailure(null); setStale(false);
    try { await createDiscountClient({ authenticatedFetch }).endDiscount(item.id, item.version); onClose(true); }
    catch (reason) {
      if (reason instanceof ApiError && reason.code === 'STALE_UPDATE') setStale(true);
      else setFailure(errorMessageKey(reason));
    } finally { pendingRef.current = false; setPending(false); }
  }
  const error = (field: Field) => fieldErrors[field] && <span className="field-error" id={`discount-${field}-error`}>{fieldErrors[field]}</span>;
  const described = (field: Field) => fieldErrors[field] ? `discount-${field}-error` : undefined;
  return <dialog ref={dialog} className="discount-dialog" aria-labelledby="discount-dialog-title"
    onKeyDown={keepFocus}
    onCancel={(event) => { event.preventDefault(); close(); }}>
    <form className="stack" noValidate onSubmit={(event) => void save(event)} aria-busy={pending}>
      <h2 id="discount-dialog-title">{t(item ? 'editTitle' : 'newTitle')}</h2>
      {failure && <Alert tone="danger" focusOnShow>{errors(failure)}</Alert>}
      {uncertain && <Alert tone="warn">{t('unknown')}</Alert>}
      {stale && <Alert tone="warn" focusOnShow>{errors('staleUpdate')}
        <button type="button" className="btn btn-secondary" onClick={onReload} disabled={pending}>{t('reload')}</button></Alert>}
      {item ? <p>{t('appliesTo')}: <strong>{item.targetName}</strong> ({t(item.targetType === 'CATEGORY' ? 'category' : 'product')})</p>
        : <>
          <fieldset disabled={locked}><legend>{t('appliesTo')}</legend><div className="catalog-home-links">
            <label className="catalog-check"><input type="radio" name="targetType" checked={targetType === 'CATEGORY'}
              onChange={() => selectType('CATEGORY')} />{t('category')}</label>
            <label className="catalog-check"><input type="radio" name="targetType" checked={targetType === 'PRODUCT'}
              onChange={() => selectType('PRODUCT')} />{t('oneProduct')}</label></div></fieldset>
          {targetType === 'PRODUCT' && <div className="field"><label htmlFor="discount-search">{t('searchProducts')}</label>
            <input id="discount-search" className="input" maxLength={100} disabled={locked} value={search} onChange={(event) => updateSearch(event.target.value)} /></div>}
          {pickerError && <Alert tone="danger">{errors(pickerError)}<button type="button" className="btn btn-secondary" disabled={locked} onClick={retryPicker}>{t('retry')}</button></Alert>}
          {loading && <p role="status">{t('loadingTargets')}</p>}
          <div className="field"><label htmlFor="discount-target">{t(targetType === 'CATEGORY' ? 'category' : 'productLabel')}</label>
            <select id="discount-target" className="input" disabled={locked || loading || !!pickerError} value={targetId}
              aria-invalid={!!fieldErrors.target} aria-describedby={described('target')}
              onChange={(event) => { setTargetId(event.target.value); clear('target'); }}>
              <option value="">{t('chooseTarget')}</option>{options.map((option) => <option value={option.id} key={option.id}>{option.name}</option>)}</select>{error('target')}</div>
        </>}
      <div className="field"><label htmlFor="discount-kind">{t('type')}</label><select id="discount-kind" className="input" disabled={locked}
        value={kind} onChange={(event) => { setKind(event.target.value as DiscountKind); clear('value'); }}>
        <option value="PERCENTAGE">{t('percentage')}</option><option value="FLAT">{t('flatInput')}</option></select></div>
      <div className="field"><label htmlFor="discount-value">{t('value')}</label><input id="discount-value" className="input" inputMode="decimal" disabled={locked}
        value={value} maxLength={16} aria-invalid={!!fieldErrors.value} aria-describedby={described('value')}
        onChange={(event) => { setValue(event.target.value); clear('value'); }} />{error('value')}</div>
      <div className="catalog-form-grid">
        <div className="field"><label htmlFor="discount-starts">{t('starts')}</label><input id="discount-starts" className="input" type="date" min={today}
          disabled={locked || started} value={starts} aria-invalid={!!fieldErrors.starts} aria-describedby={described('starts')}
          onChange={(event) => { setStarts(event.target.value); clear('starts'); }} />{error('starts')}</div>
        <div className="field"><label htmlFor="discount-ends">{t('endsOptional')}</label><input id="discount-ends" className="input" type="date" min={starts > today ? starts : today}
          disabled={locked} value={ends} aria-invalid={!!fieldErrors.ends} aria-describedby={described('ends')}
          onChange={(event) => { setEnds(event.target.value); clear('ends'); }} />{error('ends')}</div>
      </div>
      {confirming ? <div className="stack"><p>{t('endConfirm')}</p><div className="catalog-home-links">
        <button ref={endAction} type="button" className="btn btn-secondary" disabled={pending} onClick={() => void end()}>{t('confirm')}</button>
        <button type="button" className="btn btn-secondary" disabled={pending} onClick={() => setConfirming(false)}>{t('cancel')}</button></div></div>
        : <div className="catalog-home-links">
          <button className="btn btn-primary" type="submit" disabled={pending || loading || !!pickerError}>{t('save')}</button>
          <button data-cancel className="btn btn-secondary" type="button" disabled={pending} onClick={close}>{t('cancel')}</button>
          {item && <button ref={endAction} type="button" className="btn btn-secondary" disabled={pending} onClick={() => setConfirming(true)}>{t('endNow')}</button>}
        </div>}
    </form>
  </dialog>;
}
