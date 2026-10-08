'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { useSession } from '../auth/SessionProvider';
import { useSessionRedirect } from '../auth/sessionRedirect';
import { ApiError, errorMessageKey, type ErrorMessageKey } from '../lib/api';
import { createCatalogClient, newId, type Category, type Page } from '../lib/catalog';
import { Alert } from '../shell/Alert';
import { usePagerFocus } from '../shell/usePagerFocus';

export function CategoryManager() {
  const t = useTranslations('categories');
  const errors = useTranslations('errors');
  const session = useSession();
  useSessionRedirect('staff');
  const ready = !!session.profile && session.mfa === 'VERIFIED';
  const { authenticatedFetch } = session;
  const [page, setPage] = useState(0);
  const [result, setResult] = useState<Page<Category> | null>(null);
  const [failure, setFailure] = useState<ErrorMessageKey | null>(null);
  const [createConflict, setCreateConflict] = useState(false);
  const [reload, setReload] = useState(0);
  const [editing, setEditing] = useState<Category | 'new' | null>(null);
  const [name, setName] = useState('');
  const [active, setActive] = useState(true);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const createId = useRef<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  // The name field is disabled while a save is pending, so a refused name is focused once it is enabled again.
  const focusName = useRef(false);
  const { pager, markTurn } = usePagerFocus(result);

  useEffect(() => {
    if (!ready) return;
    let current = true;
    createCatalogClient({ authenticatedFetch }).listCategories(page).then(
      (value) => { if (current) { setResult(value); setFailure(null); } },
      (reason: unknown) => { if (current) { setResult(null); setFailure(errorMessageKey(reason)); } },
    );
    return () => { current = false; };
  }, [authenticatedFetch, ready, page, reload]);

  useEffect(() => {
    if (pending || !focusName.current) return;
    focusName.current = false;
    nameRef.current?.focus();
  }, [pending]);

  function open(category: Category | 'new') {
    if (pendingRef.current) return;
    setEditing(category); setName(category === 'new' ? '' : category.name);
    setActive(category === 'new' ? true : category.active);
    setFieldError(null); setStale(false); setSaved(false); setCreateConflict(false);
    createId.current = category === 'new' ? newId() : null;
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pendingRef.current || !editing) return;
    const normalized = name.trim();
    if (!normalized) { setFieldError(t('required')); nameRef.current?.focus(); return; }
    if (editing !== 'new' && normalized === editing.name && active === editing.active) {
      setEditing(null); return;
    }
    pendingRef.current = true; setPending(true); setFieldError(null); setStale(false); setFailure(null); setCreateConflict(false);
    try {
      const client = createCatalogClient({ authenticatedFetch });
      if (editing === 'new') {
        await client.createCategory({ id: createId.current!, name: normalized });
      }
      else await client.updateCategory(editing.id, { name: normalized, active, version: editing.version });
      setEditing(null); setSaved(true); setResult(null); setReload((value) => value + 1);
    } catch (reason) {
      if (reason instanceof ApiError && reason.code === 'CATEGORY_NAME_TAKEN') {
        setFieldError(t('nameTaken')); focusName.current = true;
      } else if (editing === 'new' && reason instanceof ApiError && reason.code === 'ID_CONFLICT') {
        setCreateConflict(true); setFailure(errorMessageKey(reason));
      } else if (reason instanceof ApiError && reason.code === 'STALE_UPDATE') setStale(true);
      else setFailure(errorMessageKey(reason));
    } finally { pendingRef.current = false; setPending(false); }
  }

  function reloadPage() {
    if (pendingRef.current) return;
    setEditing(null); setStale(false); setFieldError(null); setCreateConflict(false); setResult(null); setReload((value) => value + 1);
    // The pressed Reload or Try again button disappears with its message; the page heading keeps focus instead.
    headingRef.current?.focus();
  }
  function turnPage(next: number) {
    if (pendingRef.current) return;
    markTurn(); setPage(next);
  }
  const editor = editing && <form onSubmit={(event) => void save(event)} className="catalog-inline-form">
    <div className="field"><label htmlFor="category-name">{t('name')}</label>
      <input ref={nameRef} id="category-name" className="input" value={name} maxLength={80} disabled={pending}
        aria-invalid={!!fieldError} aria-describedby={fieldError ? 'category-name-error' : undefined}
        onChange={(event) => { setName(event.target.value); setFieldError(null); }} />
      {fieldError && <span id="category-name-error" className="field-error">{fieldError}</span>}
    </div>
    {editing !== 'new' && <label className="catalog-check"><input type="checkbox" checked={active} disabled={pending}
      onChange={(event) => setActive(event.target.checked)} />{t('active')}</label>}
    <button className="btn btn-primary" type="submit" disabled={pending}>{t('save')}</button>
    <button className="btn btn-secondary" type="button" disabled={pending}
      onClick={() => { if (!pendingRef.current) setEditing(null); }}>{t('cancel')}</button>
  </form>;

  return <main className="container page stack">
    <div className="catalog-heading"><h1 ref={headingRef} tabIndex={-1}>{t('title')}</h1>
      <button className="btn btn-primary" type="button" disabled={pending} onClick={() => open('new')}>{t('add')}</button></div>
    {saved && <Alert tone="success" focusOnShow>{t('saved')}</Alert>}
    {stale && <div role="alert" className="alert alert-warn">{t('stale')}
      <button className="btn btn-secondary" type="button" onClick={reloadPage}>{t('reload')}</button></div>}
    {failure && <Alert tone="danger" focusOnShow>{errors(failure)}
      <button className="btn btn-secondary" type="button" onClick={reloadPage}>{t(createConflict ? 'reload' : 'retry')}</button></Alert>}
    {editing === 'new' && <div className="card card-pad">{editor}</div>}
    {ready && !result && !failure && <p role="status">{t('loading')}</p>}
    {result && <div className="card"><div className="catalog-table-scroll">
      <table className="catalog-table"><thead><tr><th>{t('category')}</th><th>{t('products')}</th>
        <th>{t('status')}</th><th><span className="sr-only">{t('edit')}</span></th></tr></thead>
        <tbody>{result.items.map((category) => <tr key={category.id}>
          <td>{category.name}{editing !== 'new' && editing?.id === category.id && editor}</td>
          <td>{category.productCount}</td>
          <td><span className={category.active ? 'chip chip-success' : 'chip'}>{t(category.active ? 'active' : 'inactive')}</span></td>
          <td><button className="btn btn-secondary" type="button" disabled={pending}
            aria-label={t('editNamed', { name: category.name })} onClick={() => open(category)}>{t('edit')}</button></td>
        </tr>)}</tbody></table></div>
      {result.totalItems === 0 && <p className="card-pad">{t('empty')}</p>}
      {result.totalItems > 0 && <div className="catalog-pager" ref={pager}>
        <span aria-live="polite">{result.items.length === 0 ? t('emptyPage') : t('showing', { start: result.page * result.size + 1,
          end: Math.min(result.page * result.size + result.items.length, result.totalItems), total: result.totalItems })}</span>
        <div><button className="btn btn-secondary" disabled={pending || page === 0} onClick={() => turnPage(page - 1)}>{t('previous')}</button>
          <button className="btn btn-secondary" disabled={pending || (page + 1) * result.size >= result.totalItems}
            onClick={() => turnPage(page + 1)}>{t('next')}</button></div>
      </div>}
    </div>}
  </main>;
}
