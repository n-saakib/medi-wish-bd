# `tests/UserList.test.ts`

Source: [source](<../../tests/UserList.test.ts>).

## Purpose

Component units through real session/translation providers and the real session client with a synthetic HTTP adapter. They protect bounded rows and UUID links, loading/empty states, focused errors and retry, submitted filters, paging with applied filters, pagination reset, late-search suppression and Customer/MFA guards without loading user data.

Staff UI correction (2026-10-08): an `ACCESS_DENIED` list shows the heading and the focused denial with no form, search field or table; the recover-on-another-search case now covers the generic error only.
