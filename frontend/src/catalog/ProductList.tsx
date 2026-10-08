'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useSession } from '../auth/SessionProvider';
import { useSessionRedirect } from '../auth/sessionRedirect';
import { errorMessageKey, type ErrorMessageKey } from '../lib/api';
import { createCatalogClient, formatTaka, type Category, type Page, type ProductFilter, type ProductSummary,
  type ProductStatus } from '../lib/catalog';
import { Alert } from '../shell/Alert';
import { usePagerFocus } from '../shell/usePagerFocus';

export function ProductList() {
  const t = useTranslations('catalog');
  const errors = useTranslations('errors');
  const session = useSession();
  useSessionRedirect('staff');
  const ready = !!session.profile && session.mfa === 'VERIFIED';
  const { authenticatedFetch } = session;
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [status, setStatus] = useState('');
  const [reviewOnly, setReviewOnly] = useState(false);
  const [filter, setFilter] = useState<ProductFilter>({ page: 0 });
  const [categories, setCategories] = useState<Category[]>([]);
  const [result, setResult] = useState<Page<ProductSummary> | null>(null);
  const [categoryFailure, setCategoryFailure] = useState<ErrorMessageKey | null>(null);
  const [productFailure, setProductFailure] = useState<ErrorMessageKey | null>(null);
  const failure = categoryFailure ?? productFailure;
  const [retry, setRetry] = useState(0);
  const reload = useCallback(() => setRetry((value) => value + 1), []);
  const { pager, markTurn } = usePagerFocus(result);

  useEffect(() => {
    if (!ready) return;
    let current = true;
    createCatalogClient({ authenticatedFetch }).listCategoryOptions().then(
      (value) => { if (current) { setCategories(value); setCategoryFailure(null); } },
      (reason: unknown) => { if (current) setCategoryFailure(errorMessageKey(reason)); },
    );
    return () => { current = false; };
  }, [authenticatedFetch, ready, retry]);

  useEffect(() => {
    if (!ready) return;
    let current = true;
    createCatalogClient({ authenticatedFetch }).listProducts(filter).then(
      (value) => { if (current) { setResult(value); setProductFailure(null); } },
      (reason: unknown) => { if (current) { setResult(null); setProductFailure(errorMessageKey(reason)); } },
    );
    return () => { current = false; };
  }, [authenticatedFetch, ready, filter, retry]);

  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setResult(null);
    setFilter({ q: search.trim() || undefined, categoryId: categoryId || undefined,
      status: (status || undefined) as ProductStatus | undefined, reviewRequired: reviewOnly || undefined, page: 0 });
  }

  const showing = result && result.items.length > 0 ? t('showing', {
    start: result.page * result.size + 1,
    end: Math.min(result.page * result.size + result.items.length, result.totalItems), total: result.totalItems,
  }) : null;
  return <main className="container page stack">
    <div className="catalog-heading"><h1>{t('products')}</h1><Link className="btn btn-primary" href="/staff/products/new">{t('newProduct')}</Link></div>
    {ready && <form className="card card-pad catalog-filters" onSubmit={apply}>
      <div className="field"><label htmlFor="product-search">{t('searchProducts')}</label>
        <input id="product-search" className="input" value={search} maxLength={100} onChange={(event) => setSearch(event.target.value)} /></div>
      <div className="field"><label htmlFor="product-category">{t('category')}</label>
        <select id="product-category" className="input" value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
          <option value="">{t('allCategories')}</option>{categories.map((category) =>
            <option value={category.id} key={category.id}>{category.name}</option>)}</select></div>
      <div className="field"><label htmlFor="product-status">{t('status')}</label>
        <select id="product-status" className="input" value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">{t('allStatuses')}</option><option value="ACTIVE">{t('activeStatus')}</option>
          <option value="INACTIVE">{t('inactiveStatus')}</option><option value="NEEDS_PRICE">{t('needsPriceFilter')}</option>
        </select></div>
      <label className="catalog-check"><input type="checkbox" checked={reviewOnly}
        onChange={(event) => setReviewOnly(event.target.checked)} />{t('reviewOnly')}</label>
      <button className="btn btn-secondary" type="submit">{t('apply')}</button>
    </form>}
    {failure && <Alert tone="danger" focusOnShow>{errors(failure)} <button className="btn btn-secondary" onClick={reload}>{t('retry')}</button></Alert>}
    {ready && !failure && !result && <p role="status">{t('loading')}</p>}
    {result && result.totalItems === 0 && <div className="card card-pad stack">
      <p>{Object.values(filter).some((value) => value !== undefined && value !== 0) ? t('noMatches') : t('noProducts')}</p>
      <Link className="btn btn-primary" href="/staff/products/new">{t('newProduct')}</Link></div>}
    {result && result.totalItems > 0 && <div className="card">
      <div className="catalog-table-scroll"><table className="catalog-table" aria-label={t('products')}><thead><tr>
        <th>{t('product')}</th><th>{t('category')}</th><th>{t('saleUnitColumn')}</th><th className="num">{t('mrp')}</th>
        <th className="num">{t('price')}</th><th>{t('flags')}</th><th>{t('status')}</th><th><span className="sr-only">{t('edit')}</span></th>
      </tr></thead><tbody>{result.items.map((item) => <tr key={item.id}>
        <td><strong>{item.name}</strong><span className="catalog-secondary">{[item.genericName, item.dosageForm, item.manufacturer].filter(Boolean).join(' · ')}</span></td>
        <td>{item.categoryName}</td><td>{item.saleUnit}</td>
        <td className="num">{item.mrp ? formatTaka(item.mrp, t('currency')) : t('notSet')}</td>
        <td className="num">{item.sellingPrice ? formatTaka(item.sellingPrice, t('currency')) : t('notSet')}</td>
        <td>{item.requireValidation && <span className="chip chip-info">{t('review')}</span>}</td>
        <td><span className={item.status === 'ACTIVE' ? 'chip chip-success' : item.status === 'NEEDS_PRICE' ? 'chip chip-warn' : 'chip'}>{t(item.status === 'ACTIVE' ? 'activeStatus' : item.status === 'INACTIVE' ? 'inactiveStatus' : 'needsPrice')}</span></td>
        <td><Link className="btn btn-secondary" href={`/staff/products/${item.id}`}
          aria-label={t('editNamed', { name: item.name })}>{t('edit')}</Link></td>
      </tr>)}</tbody></table></div>
      <div className="catalog-pager" ref={pager}><span aria-live="polite">{showing ?? t('emptyPage')}</span><div>
        <button className="btn btn-secondary" disabled={result.page === 0} onClick={() => { markTurn(); setFilter({ ...filter, page: result.page - 1 }); }}>{t('previous')}</button>
        <button className="btn btn-secondary" disabled={(result.page + 1) * result.size >= result.totalItems}
          onClick={() => { markTurn(); setFilter({ ...filter, page: result.page + 1 }); }}>{t('next')}</button>
      </div></div>
    </div>}
  </main>;
}
