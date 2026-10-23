'use client';

import type { Ref } from 'react';

/** The six digits of an authenticator code typed with at most one space, such as `123 456`, or null. */
export function authenticatorCodeDigits(value: string): string | null {
  const digits = value.trim().replace(' ', '');
  return /^\d{6}$/.test(digits) ? digits : null;
}

type AuthenticatorCodeFieldProps = {
  id: string;
  label: string;
  value: string;
  disabled?: boolean;
  inputRef?: Ref<HTMLInputElement>;
  invalid?: boolean;
  describedBy?: string;
  onChange(value: string): void;
};

/** One labelled numeric input for a 6-digit authenticator code; seven characters allow one separating space. */
export function AuthenticatorCodeField({ id, label, value, disabled = false, inputRef, invalid, describedBy, onChange }: AuthenticatorCodeFieldProps) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input ref={inputRef} className="input code-input" id={id} name="code" inputMode="numeric"
        aria-invalid={invalid || undefined} aria-describedby={describedBy}
        autoComplete="one-time-code" maxLength={7} required disabled={disabled} value={value}
        onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}
