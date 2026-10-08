import { describe, expect, it } from 'vitest';
import { ApiError, errorMessageKey } from '../src/lib/api';
import messages from '../messages/en.json';

describe('shared administration errors', () => {
  it.each([
    ['STALE_UPDATE', 409, 'staleUpdate', 'This record changed after you opened it. Reload and try again.'],
    ['ROLE_CHANGE_REFUSED', 409, 'roleChangeRefused', 'This role change is not allowed.'],
    ['ACCESS_DENIED', 403, 'accessDenied', 'You don’t have permission to do that.'],
    ['NOT_FOUND', 404, 'notFound', 'This could not be found.'],
  ])('maps %s to the bounded translated copy', (code, status, key, copy) => {
    const result = errorMessageKey(new ApiError(code, status));
    expect(result).toBe(key);
    expect(messages.errors[result]).toBe(copy);
  });
});
