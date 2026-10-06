# `src/admin/UserList.tsx`

Source: [source](<../../../src/admin/UserList.tsx>).

## Purpose

The Admin's client list, loaded only in an MFA-verified session. The API decides whether that staff member is an Admin. The component renders usernames, one role, staff MFA, joined month and UUID Open links, with loading, empty, focused error and access-denied states.

Search and exact-role filters apply on submission and remain in component memory. Pagination carries applied filters; a new search resets page zero. The POST form has no named search controls, so native submission cannot serialize a username into a URL. Late search responses are ignored after a filter change or unmount. The static design supplies the toolbar/table/pager; full names/mobile, closure status and tabs are deferred. `tests/UserList.test.ts` covers filtering, paging, guards, privacy and recovery.
