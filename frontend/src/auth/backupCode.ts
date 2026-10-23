/** Accepts D4's ASCII backup code with optional spaces and one separator, returning its display form. */
export function backupCodeInput(value: string): string | null {
  if (/[^\x00-\x7f]/.test(value)) return null;
  const code = value.trim().toUpperCase().replaceAll(' ', '').replace('-', '');
  if (!/^[ABCDEFGHJKMNPQRSTVWXYZ23456789]{8}$/.test(code)) return null;
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}
