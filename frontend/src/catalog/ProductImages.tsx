'use client';

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useTranslations } from 'next-intl';
import { useSession } from '../auth/SessionProvider';
import { ApiError, errorMessageKey } from '../lib/api';
import { createProductImageClient, imageAlt, precheckImageFile, type ImageUpload, type ProductImage as ImageMetadata } from '../lib/productImages';
import { Icon } from '../shell/Icon';
import { ProductImage } from './ProductImage';

/** Product-scoped images, with explicit upload replay and optimistic metadata/order commands. */
export function ProductImages({ productId, productName }: { productId: string; productName: string }) {
  const t = useTranslations('productImages');
  const errors = useTranslations('errors');
  const { authenticatedFetch, profile, mfa } = useSession();
  const ready = !!profile && mfa === 'VERIFIED';
  const client = useMemo(() => createProductImageClient({ authenticatedFetch }), [authenticatedFetch]);
  const [images, setImages] = useState<ImageMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [retry, setRetry] = useState<ImageUpload | null>(null);
  const [selected, setSelected] = useState<ImageMetadata | null>(null);
  const [alt, setAlt] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const dialogErrorRef = useRef<HTMLParagraphElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const replacement = useRef<ImageMetadata | null>(null);
  const uploadButton = useRef<HTMLButtonElement>(null);
  const status = useRef<HTMLParagraphElement>(null);
  const loadError = useRef<HTMLDivElement>(null);
  const thumbnails = useRef(new Map<string, HTMLButtonElement>());
  const pending = useRef(false);
  const generation = useRef(0);
  const listSequence = useRef(0);
  const focusNext = useRef<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    const current = ++generation.current;
    const request = ++listSequence.current;
    pending.current = false;
    void client.list(productId).then((list) => {
      if (current !== generation.current || request !== listSequence.current) return;
      setImages(list.images); setLoading(false); setBusy(false);
    }).catch(() => {
      if (current !== generation.current || request !== listSequence.current) return;
      setLoading(false); setLoadFailed(true); setBusy(false);
    });
    return () => { generation.current += 1; };
  }, [client, productId, ready, reload]);

  useEffect(() => {
    if (selected) dialog.current?.showModal();
  }, [selected]);
  useEffect(() => { if (dialogError && !busy) dialogErrorRef.current?.focus(); }, [dialogError, busy]);
  useEffect(() => {
    if (busy || loading || !focusNext.current) return;
    const key = focusNext.current;
    const target = key === 'loadError' ? loadError.current : key === 'message' ? status.current : thumbnails.current.get(key) ?? uploadButton.current;
    if (target) { focusNext.current = null; target.focus(); }
  });

  function close() {
    if (dialog.current?.open) dialog.current.close(); setSelected(null); setConfirmRemove(false); setDialogError(null);
  }
  function open(image: ImageMetadata) {
    if (pending.current) return;
    setAlt(image.altText ?? ''); setDialogError(null); setConfirmRemove(false); setSelected(image);
  }
  async function refresh(current: number) {
    const request = ++listSequence.current;
    const list = await client.list(productId);
    if (current !== generation.current || request !== listSequence.current) return;
    setImages(list.images);
    return list.images;
  }
  function failedRead(current: number) {
    if (current !== generation.current) return;
    setLoadFailed(true); setMessage(null); focusNext.current = 'loadError';
  }
  function start() {
    if (pending.current) return null;
    pending.current = true; setBusy(true); setRetry(null); setMessage(null); setDialogError(null);
    return generation.current;
  }
  function finish(current: number) {
    if (current !== generation.current) return;
    pending.current = false; setBusy(false);
  }
  async function failed(reason: unknown, current: number, operation: 'upload' | 'alt' | 'order' | 'remove', command?: ImageUpload) {
    if (current !== generation.current) return;
    const stale = reason instanceof ApiError && (reason.code === 'STALE_UPDATE' || reason.status === 404);
    const limit = reason instanceof ApiError && reason.code === 'IMAGE_LIMIT_REACHED';
    if (stale || limit) {
      close();
      try { await refresh(current); } catch { failedRead(current); return; }
      if (current !== generation.current) return;
      setMessage(limit ? errors('imageLimitReached') : t(operation === 'remove' && reason instanceof ApiError && reason.status === 404 ? 'alreadyRemoved' : 'orderChanged'));
    } else {
      const copy = errors(errorMessageKey(reason));
      if (operation === 'alt') { setDialogError(copy); return; }
      setMessage(copy);
      if (command && reason instanceof ApiError && (reason.status === 0 || reason.status === 503)) setRetry(command);
    }
    focusNext.current = 'message';
  }
  async function upload(command: ImageUpload) {
    const current = start(); if (current === null) return;
    setMessage(t('uploading'));
    try {
      await client.upload(command);
      if (current !== generation.current) return;
      try { await refresh(current); }
      catch {
        failedRead(current);
        return;
      }
      if (current !== generation.current) return;
      setMessage(t(command.replaces ? 'replaced' : 'uploaded')); focusNext.current = command.id;
    } catch (reason) { await failed(reason, current, 'upload', command); }
    finally { finish(current); }
  }
  function choose(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = '';
    const replaced = replacement.current; replacement.current = null;
    if (!file || pending.current) return;
    setRetry(null); close();
    const refusal = precheckImageFile(file);
    if (refusal) { setMessage(t(refusal)); focusNext.current = 'message'; status.current?.focus(); return; }
    void upload({ productId, id: crypto.randomUUID(), file,
      ...(replaced ? { replaces: replaced.id, ...(replaced.altText === null ? {} : { altText: replaced.altText }) } : {}) });
  }
  async function saveAlt() {
    if (!selected) return;
    const image = selected;
    const current = start(); if (current === null) return;
    try {
      const updated = await client.updateAlt(productId, image.id, alt.replace(/^ +| +$/g, '') || null, image.version);
      if (current !== generation.current) return;
      setImages((before) => before.map((item) => item.id === updated.id ? updated : item));
      close(); setMessage(t('altSaved')); focusNext.current = image.id;
    } catch (reason) { await failed(reason, current, 'alt'); }
    finally { finish(current); }
  }
  async function makeMain() {
    if (!selected) return;
    const image = selected;
    const current = start(); if (current === null) return;
    close();
    try {
      const list = await client.reorder({ productId, imageIds: [image.id, ...images.filter((item) => item.id !== image.id).map((item) => item.id)],
        expectedImageIds: images.map((item) => item.id) });
      if (current !== generation.current) return;
      setImages(list.images); setMessage(t('madeMain')); focusNext.current = image.id;
    } catch (reason) { await failed(reason, current, 'order'); }
    finally { finish(current); }
  }
  async function remove() {
    if (!selected) return;
    const image = selected;
    const current = start(); if (current === null) return;
    const index = images.findIndex((item) => item.id === image.id);
    close();
    try {
      await client.remove(productId, image.id);
      if (current !== generation.current) return;
      let remaining: ImageMetadata[] | undefined;
      try { remaining = await refresh(current); } catch { failedRead(current); return; }
      if (current !== generation.current) return;
      setMessage(t('removed')); focusNext.current = remaining?.[Math.min(index, remaining.length - 1)]?.id ?? 'upload';
    } catch (reason) { await failed(reason, current, 'remove'); }
    finally { finish(current); }
  }
  const selectedIndex = selected ? images.findIndex((image) => image.id === selected.id) : -1;
  if (!ready) return null;
  return <section className="card card-pad stack" aria-busy={busy}>
    <div className="image-card-head"><h2>{t('title')}</h2><span className="small muted">{t('formats')}</span></div>
    <input ref={fileInput} type="file" accept="image/jpeg,image/png" hidden disabled={busy} onChange={choose} />
    {loading ? <p className="muted">{t('loading')}</p> : loadFailed ? <div ref={loadError} className="alert alert-danger" role="alert" tabIndex={-1}>{t('loadFailed')}
      <button className="btn btn-ghost" disabled={busy} onClick={() => { setLoading(true); setLoadFailed(false); setMessage(null); setRetry(null); setReload((before) => before + 1); }}>{t('retry')}</button></div> : <>
      <div className="grid-4">{images.map((image, index) => <button key={image.id} type="button" className={`thumb${index === 0 ? ' image-main' : ''}`}
        disabled={busy} aria-label={t('openImage', { n: index + 1, alt: imageAlt(image, productName, index, t) })}
        ref={(element) => { if (element) thumbnails.current.set(image.id, element); else thumbnails.current.delete(image.id); }} onClick={() => open(image)}>
        <ProductImage image={image} alt={imageAlt(image, productName, index, t)} sizes="(max-width: 700px) 50vw, 25vw" /></button>)}
        {images.length < 8 ? <button ref={uploadButton} className="empty-slot image-upload-slot" type="button" disabled={busy}
          onClick={() => { replacement.current = null; fileInput.current?.click(); }}><Icon name="image" /><span className="small">{t('upload')}</span></button>
          : <p className="small muted">{t('maxReached')}</p>}
      </div><p className="small muted">{t('mainHint')}</p>
    </>}
    {message && <p ref={status} role="status" tabIndex={-1}>{message}{retry && <button className="btn btn-ghost" disabled={busy}
      onClick={() => void upload(retry)}>{t('retry')}</button>}</p>}
    <dialog ref={dialog} className="profile-dialog image-dialog" aria-labelledby="image-title"
      onCancel={(event) => { event.preventDefault(); if (!pending.current) { focusNext.current = selected?.id ?? 'upload'; close(); } }}>
      {selected && <div className="stack"><div className="image-card-head"><h2 id="image-title">{t('dialogTitle', { n: selectedIndex + 1 })}</h2>
        <button className="icon-btn" disabled={busy} aria-label={t('close')} onClick={() => { focusNext.current = selected.id; close(); }}>×</button></div>
        <ProductImage image={selected} alt={imageAlt(selected, productName, selectedIndex, t)} className="image-preview" sizes="440px" />
        <div className="field"><label htmlFor="image-alt">{t('altLabel')}</label><input id="image-alt" className="input" maxLength={160}
          disabled={busy} value={alt} aria-describedby="image-alt-hint" onChange={(event) => setAlt(event.target.value)} />
          <span id="image-alt-hint" className="hint">{t('altHint')}</span></div>
        {dialogError && <p ref={dialogErrorRef} role="alert" tabIndex={-1}>{dialogError}</p>}
        <div className="image-actions"><button className="btn btn-primary" disabled={busy} onClick={() => void saveAlt()}>{t('saveAlt')}</button>
          {selectedIndex !== 0 && <button className="btn btn-secondary" disabled={busy} onClick={() => void makeMain()}>{t('makeMain')}</button>}
          <button className="btn btn-secondary" disabled={busy} onClick={() => { replacement.current = selected; fileInput.current?.click(); }}>{t('replace')}</button></div>
        {confirmRemove ? <div><p>{t('removeConfirm')}</p><div className="image-actions"><button className="btn btn-danger" disabled={busy} onClick={() => void remove()}>{t('confirmRemove')}</button>
          <button className="btn btn-secondary" disabled={busy} onClick={() => setConfirmRemove(false)}>{t('cancel')}</button></div></div>
          : <button className="btn btn-ghost" disabled={busy} onClick={() => setConfirmRemove(true)}>{t('remove')}</button>}
        <button className="btn btn-secondary" disabled={busy} onClick={() => { focusNext.current = selected.id; close(); }}>{t('close')}</button>
      </div>}
    </dialog>
  </section>;
}
