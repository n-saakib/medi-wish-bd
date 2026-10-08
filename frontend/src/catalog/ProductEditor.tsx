'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useSession } from '../auth/SessionProvider';
import { useSessionRedirect } from '../auth/sessionRedirect';
import { ApiError, errorMessageKey, type ErrorMessageKey } from '../lib/api';
import { createCatalogClient, formatTaka, isUuid, newId, type Category, type Product,
  type ProductDraft, type ProductKind, type ProductUpdate } from '../lib/catalog';
import { formatDateTime } from '../lib/dateTime';
import { fetchStaffAccess } from '../lib/staff';
import { Alert } from '../shell/Alert';

type Draft = Omit<ProductDraft, 'id'> & { active: boolean };
type Field = keyof Draft | 'sellingPrice' | 'mrp';
const empty: Draft = { kind: 'MEDICINE', name: '', brandName: null, genericName: null, dosageForm: null,
  manufacturer: null, categoryId: '', saleUnit: '', description: null, requireValidation: false, active: false };
/**
 * The Product just created in this tab. Creating navigates to the new Product's page, which mounts a fresh editor;
 * that editor confirms the save once and focuses the confirmation. Kept in memory only, never in the address.
 */
let justCreated: string | null = null;
const money = /^\d{1,7}(?:\.\d{1,2})?$/;
const decimal = /^\d+(?:\.\d{1,2})?$/;
const maxCents = 999_999_999n;

/**
 * Exact BDT minor units for the accepted positive input grammar; never converts through floating point. A decimal
 * outside 0.01–9,999,999.99 is `'range'`; anything else outside the grammar is `'format'`.
 */
function moneyCents(value: string): bigint | 'format' | 'range' {
  if (!decimal.test(value)) return 'format';
  const [whole, fraction = ''] = value.split('.');
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0') || '0');
  if (cents === 0n || cents > maxCents) return 'range';
  return money.test(value) ? cents : 'format';
}

function fromProduct(product: Product): Draft {
  return { kind: product.kind, name: product.name, brandName: product.brandName, genericName: product.genericName,
    dosageForm: product.dosageForm, manufacturer: product.manufacturer, categoryId: product.categoryId,
    saleUnit: product.saleUnit, description: product.description, requireValidation: product.requireValidation,
    active: product.active };
}

function normalized(draft: Draft): Draft {
  const optional = (text: string | null) => text?.trim() || null;
  return { ...draft, name: draft.name.trim(), brandName: optional(draft.brandName),
    genericName: draft.kind === 'MEDICINE' ? optional(draft.genericName) : null,
    dosageForm: draft.kind === 'MEDICINE' ? optional(draft.dosageForm) : null,
    manufacturer: optional(draft.manufacturer), saleUnit: draft.saleUnit.trim(), description: optional(draft.description) };
}

export function ProductEditor({ productId }: { productId?: string }) {
  const t = useTranslations('catalog');
  const errors = useTranslations('errors');
  const router = useRouter();
  const session = useSession();
  useSessionRedirect('staff');
  const ready = !!session.profile && session.mfa === 'VERIFIED';
  const { authenticatedFetch } = session;
  const [product, setProduct] = useState<Product | null>(null);
  const [draft, setDraft] = useState<Draft>(empty);
  const [categories, setCategories] = useState<Category[]>([]);
  const [admin, setAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadFailure, setLoadFailure] = useState<ErrorMessageKey | null>(null);
  const [failure, setFailure] = useState<ErrorMessageKey | null>(null);
  const [conflictingCreateId, setConflictingCreateId] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [stale, setStale] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<Field, string>>>({});
  const [saved, setSaved] = useState<'product' | 'pricing' | null>(null);
  const [sellingPrice, setSellingPrice] = useState('');
  const [mrp, setMrp] = useState('');
  const [pending, setPending] = useState(false);
  const [pricingPending, setPricingPending] = useState(false);
  const saving = pending || pricingPending;
  const [reload, setReload] = useState(0);
  const createId = useRef<string | null>(null);
  const pendingRef = useRef(false);
  const pricingPendingRef = useRef(false);
  const malformed = productId !== undefined && !isUuid(productId);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const savedRef = useRef<HTMLParagraphElement>(null);
  const staleRef = useRef<HTMLDivElement>(null);
  // Fields are disabled while saving, so a field error is focused once its field is enabled again.
  const focusField = useRef<Field | null>(null);
  // What to focus once the page has rendered: the saved message after a save, or the heading after a retry.
  const focusNext = useRef<'saved' | 'heading' | null>(null);

  useEffect(() => {
    if (!ready || malformed) return;
    let current = true;
    const client = createCatalogClient({ authenticatedFetch });
    const load = async () => {
      const [options, access, loaded] = await Promise.all([
        client.listCategoryOptions(), fetchStaffAccess({ authenticatedFetch }),
        productId ? client.loadProduct(productId) : Promise.resolve(null),
      ]);
      if (!current) return;
      setCategories(options); setAdmin(access.roles.includes('ADMIN'));
      setProduct(loaded); setDraft(loaded ? fromProduct(loaded) : empty);
      setSellingPrice(loaded?.sellingPrice ?? ''); setMrp(loaded?.mrp ?? '');
      setLoading(false); setLoadFailure(null); setFailure(null); setNotFound(false); setStale(false); setFieldErrors({}); setSaved(null);
      if (loaded && loaded.id === justCreated) { justCreated = null; setSaved('product'); focusNext.current = 'saved'; }
    };
    void load().catch((reason: unknown) => {
      if (!current) return;
      setLoading(false);
      if (reason instanceof ApiError && reason.status === 404) setNotFound(true);
      else setLoadFailure(errorMessageKey(reason));
    });
    return () => { current = false; };
  }, [authenticatedFetch, malformed, productId, ready, reload]);

  useEffect(() => {
    if (saving || !focusField.current) return;
    document.getElementById(`catalog-${focusField.current}`)?.focus();
    focusField.current = null;
  }, [fieldErrors, saving]);

  useEffect(() => {
    const target = focusNext.current === 'saved' ? savedRef.current
      : focusNext.current === 'heading' ? headingRef.current : null;
    if (!target) return;
    focusNext.current = null;
    target.focus();
  });

  // A refused stale save leaves the form in place, so its message takes focus to be read and acted on.
  useEffect(() => { if (stale) staleRef.current?.focus(); }, [stale]);

  function change<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((before) => ({ ...before, [key]: value }));
    setFieldErrors((before) => ({ ...before, [key]: undefined }));
    setSaved(null);
  }

  function showErrors(found: Partial<Record<Field, string>>) {
    setFieldErrors(found);
    focusField.current = (Object.keys(found)[0] as Field | undefined) ?? null;
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pendingRef.current || pricingPendingRef.current || loading) return;
    const clean = normalized(draft);
    const invalid: Partial<Record<Field, string>> = {};
    if (!clean.name) invalid.name = t('nameRequired');
    if (clean.kind === 'MEDICINE' && !clean.genericName) invalid.genericName = t('genericRequired');
    if (clean.kind === 'MEDICINE' && !clean.dosageForm) invalid.dosageForm = t('dosageRequired');
    if (!clean.saleUnit) invalid.saleUnit = t('saleUnitRequired');
    if (!clean.categoryId) invalid.categoryId = t('categoryRequired');
    // Only an Admin can price, so a Moderator is told who must add the price.
    const priceRequired = admin ? errors('priceRequired') : t('priceRequiredModerator');
    if (product && clean.active && !product.sellingPrice) invalid.active = priceRequired;
    if (Object.keys(invalid).length) { showErrors(invalid); return; }
    if (product && JSON.stringify(clean) === JSON.stringify(fromProduct(product))) {
      setSaved('product'); focusNext.current = 'saved'; return;
    }
    pendingRef.current = true; setPending(true); setFailure(null); setConflictingCreateId(null); setStale(false); setSaved(null);
    const client = createCatalogClient({ authenticatedFetch });
    try {
      if (product) {
        const { kind: _kind, active, ...fields } = clean;
        void _kind;
        const body: ProductUpdate = { ...fields, active, version: product.version };
        const updated = await client.updateProduct(product.id, body);
        setProduct(updated); setDraft(fromProduct(updated));
        // The form was disabled while saving, so the confirmation takes focus.
        focusNext.current = 'saved';
      } else {
        createId.current ??= newId();
        const { active: _active, ...fields } = clean;
        void _active;
        const created = await client.createProduct({ id: createId.current, ...fields });
        justCreated = created.id;
        router.replace(`/staff/products/${created.id}`);
      }
      setSaved('product');
    } catch (reason) {
      if (!product && reason instanceof ApiError && reason.code === 'ID_CONFLICT') {
        setConflictingCreateId(createId.current); setFailure(errorMessageKey(reason));
      } else if (reason instanceof ApiError && reason.code === 'STALE_UPDATE') setStale(true);
      else if (reason instanceof ApiError && reason.code === 'PRICE_REQUIRED') showErrors({ active: priceRequired });
      else if (reason instanceof ApiError && reason.status === 404) setNotFound(true);
      else setFailure(errorMessageKey(reason));
    } finally { pendingRef.current = false; setPending(false); }
  }

  async function savePricing(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!product || !admin || pricingPendingRef.current || pendingRef.current) return;
    const invalid: Partial<Record<Field, string>> = {};
    const selling = sellingPrice.trim(), listed = mrp.trim();
    const sellingCents = selling ? moneyCents(selling) : null;
    const mrpCents = listed ? moneyCents(listed) : null;
    const moneyError = (cents: bigint | 'format' | 'range' | null) =>
      cents === 'range' ? t('moneyRange') : cents === 'format' ? t('moneyFormat') : undefined;
    if (!selling) invalid.sellingPrice = t('sellingPriceRequired');
    else if (typeof sellingCents !== 'bigint') invalid.sellingPrice = moneyError(sellingCents);
    if (typeof mrpCents === 'string') invalid.mrp = moneyError(mrpCents);
    if (typeof sellingCents === 'bigint' && typeof mrpCents === 'bigint' && sellingCents > mrpCents)
      invalid.sellingPrice = t('priceAboveMrp');
    if (Object.keys(invalid).length) { showErrors(invalid); return; }
    setFieldErrors((before) => ({ ...before, sellingPrice: undefined, mrp: undefined }));
    if (product.sellingPrice === selling && (product.mrp ?? '') === listed) {
      setSaved('pricing'); focusNext.current = 'saved'; return;
    }
    pricingPendingRef.current = true; setPricingPending(true); setFailure(null); setStale(false); setSaved(null);
    try {
      const updated = await createCatalogClient({ authenticatedFetch }).updatePricing(product.id,
        { sellingPrice: selling, mrp: listed || null, version: product.version });
      setProduct(updated); setSellingPrice(updated.sellingPrice ?? ''); setMrp(updated.mrp ?? ''); setSaved('pricing');
      focusNext.current = 'saved';
      setFieldErrors((before) => ({ ...before, active: undefined }));
    } catch (reason) {
      if (reason instanceof ApiError && reason.code === 'STALE_UPDATE') setStale(true);
      else setFailure(errorMessageKey(reason));
    } finally { pricingPendingRef.current = false; setPricingPending(false); }
  }

  function field(key: Field, label: string, value: string, onChange: (value: string) => void,
                 options: { maxLength?: number; multiline?: boolean; hint?: string } = {}) {
    const id = `catalog-${key}`;
    return <div className="field" key={key}><label htmlFor={id}>{label}</label>
      {options.multiline ? <textarea id={id} className="input" rows={4} value={value} disabled={saving} maxLength={options.maxLength}
        aria-invalid={!!fieldErrors[key]} aria-describedby={fieldErrors[key] ? `${id}-error` : options.hint ? `${id}-hint` : undefined}
        onChange={(event) => onChange(event.target.value)} /> :
        <input id={id} className="input" value={value} disabled={saving} maxLength={options.maxLength}
          aria-invalid={!!fieldErrors[key]} aria-describedby={fieldErrors[key] ? `${id}-error` : options.hint ? `${id}-hint` : undefined}
          onChange={(event) => onChange(event.target.value)} />}
      {options.hint && <span id={`${id}-hint`} className="hint">{options.hint}</span>}
      {fieldErrors[key] && <span id={`${id}-error`} className="field-error">{fieldErrors[key]}</span>}
    </div>;
  }

  if (!ready) return null;
  const back = <nav className="breadcrumb" aria-label={t('breadcrumb')}>
    <Link className="btn btn-ghost" href="/staff/products">{t('products')}</Link></nav>;
  if (malformed || notFound) return <main className="container page">{back}<h1>{t('productNotFound')}</h1></main>;
  if (loading) return <main className="container page"><p role="status">{t('loading')}</p></main>;
  if (loadFailure) return <main className="container page">{back}<Alert tone="danger">{errors(loadFailure)}
    <button className="btn btn-secondary" onClick={() => { focusNext.current = 'heading'; setReload((value) => value + 1); }}>
      {t('retry')}</button></Alert></main>;

  const categoryChoices = [...categories];
  if (product && !categoryChoices.some((category) => category.id === product.categoryId)) {
    categoryChoices.push({ id: product.categoryId, name: product.categoryName, active: false, productCount: 0, version: 0 });
  }
  const status = product?.status === 'ACTIVE' ? 'activeStatus' : product?.status === 'INACTIVE' ? 'inactiveStatus' : 'needsPrice';
  return <main className="container page stack catalog-editor">
    {back}
    <div className="catalog-heading"><div><h1 ref={headingRef} tabIndex={-1}>{product?.name ?? t('newProduct')}</h1>
      {product && <p className="muted">{t('lastEdited', { username: product.updatedByUsername ?? '—', version: product.version })}</p>}</div>
      {product && <span className={product.status === 'ACTIVE' ? 'chip chip-success' : product.status === 'NEEDS_PRICE' ? 'chip chip-warn' : 'chip'}>{t(status)}</span>}</div>
    {saved && <p ref={savedRef} tabIndex={-1} className="alert alert-success" role="status">
      {t(saved === 'pricing' ? 'pricingSaved' : 'saved')}</p>}
    {stale && <div ref={staleRef} tabIndex={-1} className="alert alert-warn" role="alert">{t('productStale')}
      <button className="btn btn-secondary" onClick={() => { headingRef.current?.focus(); setReload((value) => value + 1); }}>
        {t('reload')}</button></div>}
    {failure && <Alert tone="danger" focusOnShow>{errors(failure)}
      {conflictingCreateId && <button className="btn btn-secondary" type="button"
        onClick={() => router.replace(`/staff/products/${conflictingCreateId}`)}>{t('reload')}</button>}</Alert>}
    <form className="stack" onSubmit={(event) => void save(event)} aria-busy={pending}>
      <section className="card card-pad stack"><h2>{t('productDetails')}</h2>
        {!product ? <fieldset className="catalog-kind"><legend>{t('productKind')}</legend>
          <label className="catalog-check"><input id="catalog-kind-medicine" type="radio" name="kind" disabled={saving} checked={draft.kind === 'MEDICINE'}
            onChange={() => change('kind', 'MEDICINE' as ProductKind)} />{t('medicine')}</label>
          <label className="catalog-check"><input id="catalog-kind-equipment" type="radio" name="kind" disabled={saving} checked={draft.kind === 'EQUIPMENT'}
            onChange={() => change('kind', 'EQUIPMENT' as ProductKind)} />{t('equipment')}</label></fieldset>
          : <p>{t(product.kind === 'MEDICINE' ? 'medicine' : 'equipment')}</p>}
        <div className="catalog-form-grid">
          {field('name', t('name'), draft.name, (value) => change('name', value), { maxLength: 160 })}
          {field('brandName', t('brandName'), draft.brandName ?? '', (value) => change('brandName', value), { maxLength: 120 })}
          {draft.kind === 'MEDICINE' && field('genericName', t('genericName'), draft.genericName ?? '',
            (value) => change('genericName', value), { maxLength: 200 })}
          {field('manufacturer', t('manufacturer'), draft.manufacturer ?? '',
            (value) => change('manufacturer', value), { maxLength: 120 })}
          {draft.kind === 'MEDICINE' && field('dosageForm', t('dosageForm'), draft.dosageForm ?? '',
            (value) => change('dosageForm', value), { maxLength: 120 })}
          <div className="field"><label htmlFor="catalog-categoryId">{t('category')}</label>
            <select id="catalog-categoryId" className="input" value={draft.categoryId} disabled={saving}
              aria-invalid={!!fieldErrors.categoryId} aria-describedby={fieldErrors.categoryId ? 'catalog-categoryId-error' : undefined}
              onChange={(event) => change('categoryId', event.target.value)}>
              <option value="">{t('categoryRequired')}</option>{categoryChoices.map((category) => <option key={category.id} value={category.id}>
                {category.active ? category.name : t('inactiveCategory', { name: category.name })}</option>)}</select>
            {fieldErrors.categoryId && <span className="field-error" id="catalog-categoryId-error">{fieldErrors.categoryId}</span>}</div>
          {field('saleUnit', t('saleUnit'), draft.saleUnit, (value) => change('saleUnit', value),
            { maxLength: 80, hint: t('saleUnitHint') })}
        </div>
        {field('description', t('description'), draft.description ?? '', (value) => change('description', value),
          { maxLength: 4000, multiline: true })}
      </section>
      <section className="card card-pad stack"><h2>{t('availability')}</h2>
        {product && <div><label className="catalog-check" htmlFor="catalog-active"><input id="catalog-active" type="checkbox"
          checked={draft.active} disabled={saving} aria-describedby={fieldErrors.active ? 'catalog-active-error' : undefined}
          onChange={(event) => change('active', event.target.checked)} />{t('active')}</label>
          {fieldErrors.active && <span className="field-error" id="catalog-active-error">{fieldErrors.active}</span>}</div>}
        <label className="catalog-check"><input type="checkbox" checked={draft.requireValidation} disabled={saving}
          onChange={(event) => change('requireValidation', event.target.checked)} />{t('requireValidation')}</label>
      </section>
      <button className="btn btn-primary" type="submit" disabled={saving}>{pending ? t('saving') : t('save')}</button>
    </form>
    {product && <section className="card card-pad stack" role="region" aria-label={t('pricing')}>
      <h2>{t('pricing')}</h2><form className="catalog-form-grid" onSubmit={(event) => void savePricing(event)} aria-busy={pricingPending}>
        <div className="field"><label htmlFor="catalog-mrp">{t('mrpInput', { currency: t('currency') })}</label>
          <input id="catalog-mrp" className="input" inputMode="decimal" value={mrp} disabled={!admin || saving}
            aria-invalid={!!fieldErrors.mrp} aria-describedby={fieldErrors.mrp ? 'catalog-mrp-error' : admin ? undefined : 'catalog-pricing-note'}
            onChange={(event) => { setMrp(event.target.value); setFieldErrors((before) => ({ ...before, mrp: undefined })); }} />
          {fieldErrors.mrp && <span className="field-error" id="catalog-mrp-error">{fieldErrors.mrp}</span>}</div>
        <div className="field"><label htmlFor="catalog-sellingPrice">{t('sellingPrice', { currency: t('currency') })}</label>
          <input id="catalog-sellingPrice" className="input" inputMode="decimal" value={sellingPrice} disabled={!admin || saving}
            aria-invalid={!!fieldErrors.sellingPrice}
            aria-describedby={fieldErrors.sellingPrice ? 'catalog-sellingPrice-error' : admin ? undefined : 'catalog-pricing-note'}
            onChange={(event) => { setSellingPrice(event.target.value); setFieldErrors((before) => ({ ...before, sellingPrice: undefined })); }} />
          {fieldErrors.sellingPrice && <span className="field-error" id="catalog-sellingPrice-error">{fieldErrors.sellingPrice}</span>}</div>
        {admin && <button className="btn btn-primary" type="submit" disabled={saving}>{t('savePricing')}</button>}
      </form>{!admin && <p id="catalog-pricing-note">{t('moderatorPricingNote')}</p>}
    </section>}
    {product && <section className="card card-pad stack"><h2>{t('changeHistory')}</h2>
      <ol aria-label={t('changeHistory')} className="catalog-history">{product.history.map((change, index) => {
        const username = change.actorUsername ?? '—';
        let line: string;
        switch (change.changeType) {
          case 'CREATED': line = t('createdBy', { username }); break;
          case 'ACTIVATED': line = t('activatedBy', { username }); break;
          case 'DEACTIVATED': line = t('deactivatedBy', { username }); break;
          case 'PRICE_CHANGED': line = change.newMrp
            ? t('priceSetBy', { price: formatTaka(change.newSellingPrice!, t('currency')),
              mrp: formatTaka(change.newMrp, t('currency')), username })
            : t(change.oldMrp ? 'priceSetMrpRemoved' : 'priceSetWithoutMrp',
              { price: formatTaka(change.newSellingPrice!, t('currency')), username }); break;
          case 'REQUIRE_VALIDATION_CHANGED': line = t(change.newRequireValidation
            ? 'reviewTurnedOnBy' : 'reviewTurnedOffBy', { username }); break;
          default: line = t('catalogUpdatedBy', { username });
        }
        return <li key={`${change.occurredAt}-${index}`}><strong>{line}</strong>
          <time dateTime={change.occurredAt}>{formatDateTime(change.occurredAt)}</time></li>;
      })}</ol>
    </section>}
  </main>;
}
