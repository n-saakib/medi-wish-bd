'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Alert } from '../shell/Alert';

type BackupCodesPanelProps = {
  codes: string[];
  /** Forgets the codes; called before leaving for the staff page. */
  onSaved(): void;
};

/** The once-only backup codes, with Copy all and I've saved them. The codes live only in the caller's state. */
export function BackupCodesPanel({ codes, onSaved }: BackupCodesPanelProps) {
  const t = useTranslations('staffMfa');
  const router = useRouter();
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle');
  const headingRef = useRef<HTMLHeadingElement>(null);

  // The codes replace the setup form, so move focus to their heading.
  useEffect(() => headingRef.current?.focus(), []);

  async function copyAll() {
    try {
      await navigator.clipboard.writeText(codes.join('\n'));
      setCopy('copied');
    } catch {
      setCopy('failed');
    }
  }

  function saved() {
    onSaved();
    router.replace('/staff');
  }

  return (
    <>
      <div className="steps-mini" aria-hidden="true"><span className="is-done" /><span className="is-done" /></div>
      <h1 ref={headingRef} tabIndex={-1}>{t('backupTitle')}</h1>
      <div className="secret mt-16">
        <p className="small mb-0"><strong>{t('backupWarningStrong')}</strong> {t('backupWarning')}</p>
        <ul className="code-grid" aria-label={t('backupListLabel')}>
          {codes.map((code) => <li key={code}><code>{code}</code></li>)}
        </ul>
        <button className="btn btn-secondary" type="button" onClick={() => void copyAll()}>{t('copyAll')}</button>
        {copy === 'copied' && <p className="small mt-8 mb-0" role="status">{t('copied')}</p>}
      </div>
      {copy === 'failed' && <div className="mt-16"><Alert tone="danger">{t('copyFailed')}</Alert></div>}
      <button className="btn btn-primary btn-block mt-16" type="button" onClick={saved}>{t('saved')}</button>
    </>
  );
}
