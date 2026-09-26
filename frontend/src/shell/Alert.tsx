'use client';

import { useEffect, useRef } from 'react';
import { Icon, type IconName } from './Icon';

type AlertTone = 'success' | 'warn' | 'danger';

const toneIcons: Record<AlertTone, IconName> = { success: 'check', warn: 'alert', danger: 'alert' };

type AlertProps = {
  tone: AlertTone;
  children: React.ReactNode;
  /** Move focus here when shown, so the message is read even when it replaces the page's context. */
  focusOnShow?: boolean;
};

/** A design-system alert. Danger alerts use `role="alert"`; the others are polite status messages. */
export function Alert({ tone, children, focusOnShow = false }: AlertProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focusOnShow) ref.current?.focus();
  }, [focusOnShow]);
  return (
    <div ref={ref} className={`alert alert-${tone}`} role={tone === 'danger' ? 'alert' : 'status'}
      tabIndex={focusOnShow ? -1 : undefined}>
      <Icon name={toneIcons[tone]} />
      <p>{children}</p>
    </div>
  );
}
