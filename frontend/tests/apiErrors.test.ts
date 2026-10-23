import { describe, expect, it } from 'vitest';
import { ApiError, errorMessageKey } from '../src/lib/api';
import messages from '../messages/en.json';

describe('shared administration errors', () => {
  it.each([
    ['CODE_INVALID', 400, 'codeInvalid', 'That code is wrong or has expired. Ask for a new code.'],
    ['CURRENT_PASSWORD_INVALID', 400, 'currentPasswordInvalid', 'Enter your current password to change your email.'],
    ['EMAIL_REQUIRED', 409, 'emailRequired', 'Add an email address to your profile first.'],
    ['IMAGE_INVALID', 400, 'imageInvalid', 'The file is not a valid JPG or PNG image within the size limits.'],
    ['IMAGE_LIMIT_REACHED', 409, 'imageLimitReached', 'This Product already has the maximum number of images.'],
    ['STORAGE_UNAVAILABLE', 503, 'storageUnavailable', 'Images cannot be saved right now. Try again shortly.'],
    ['DISCOUNT_ENDED', 409, 'discountEnded', 'This discount has ended and can no longer be changed.'],
    ['DISCOUNT_EXCEEDS_PRICE', 409, 'discountExceedsPrice', "The discount must be smaller than the product's selling price."],
    ['ADDRESS_BOOK_FULL', 409, 'addressBookFull', 'This address book is full. Remove an address to add another.'],
    ['ADDRESS_CHANGE_LIMIT_REACHED', 409, 'addressChangeLimit', "You've reached the address change limit for this week or month. You can still remove an address."],
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
