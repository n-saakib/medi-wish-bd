# `src/app/(staff)/staff/backup-codes/page.tsx`

Source: [`src/app/(staff)/staff/backup-codes/page.tsx`](../../../../../../src/app/(staff)/staff/backup-codes/page.tsx)

## Purpose and exports

The server page for `/staff/backup-codes` uses the existing staff layout and `container page` / `auth-card` wrappers. `generateMetadata()` gets the English document title from `staffMfa.regenerate.pageTitle`. The default `BackupCodesPage()` renders the client `BackupCodesRegeneration` form, which owns session guards, step-up and once-only state. Existing `/staff/:path*` no-store headers apply without configuration changes.

There is no dedicated static design; the page reuses the established staff auth-card and step-up patterns, as accepted in Ticket 09.
