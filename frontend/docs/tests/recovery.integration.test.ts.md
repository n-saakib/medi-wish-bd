# `tests/recovery.integration.test.ts`

Two live HTTP checks require `MEDI_WISH_API_URL`: malformed public reset request returns `400 INVALID_REQUEST`, and anonymous saved-email verification returns `401 AUTHENTICATION_REQUIRED`. Both responses must use `no-store`, exactly the bounded error keys and matching header/body request correlation. No fake adapter or credentials are used; these protect the real recovery boundary alongside browser and PostgreSQL integration coverage.
