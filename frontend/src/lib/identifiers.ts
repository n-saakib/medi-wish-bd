/** The accepted ASCII dot-atom address subset used for new profile email input. */
export function isProfileEmail(value: string): boolean {
  if (value.length === 0 || value.length > 254) return false;
  const parts = value.split('@');
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  if (local.length === 0 || local.length > 64) return false;
  if (!local.split('.').every((atom) => /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+$/i.test(atom))) return false;
  const labels = domain.split('.');
  return labels.length >= 2 && labels.every((label) => label.length <= 63
    && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label));
}
