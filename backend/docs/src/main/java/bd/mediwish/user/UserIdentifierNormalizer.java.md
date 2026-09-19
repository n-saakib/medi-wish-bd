# UserIdentifierNormalizer

Shared user-owned normalization seam for registration and authentication. Usernames and emails trim and lowercase with `Locale.ROOT`; mobile values trim only. It does not add E.164 conversion or OTP verification, which remain Ticket 61 work. Keeping the seam in `bd.mediwish.user` prevents the shared User feature from depending on the authentication package.
