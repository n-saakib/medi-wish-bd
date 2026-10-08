# `tests/UserList.test.ts`

Source: [source](<../../tests/UserList.test.ts>).

## Purpose

Component units through real session/translation providers and the real session client with a synthetic HTTP adapter. They protect bounded rows and UUID links, loading/empty states, focused errors and retry, submitted filters, paging with applied filters, pagination reset, late-search suppression and Customer/MFA guards without loading user data.

A pager regression checks that keyboard focus moves to Previous when Next loads the last page.
