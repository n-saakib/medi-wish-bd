# `src/catalog/CategoryManager.tsx`

Source: [`src/catalog/CategoryManager.tsx`](../../../src/catalog/CategoryManager.tsx)

The verified staff Categories page. It lists 20 categories per page with product counts and status, and uses one inline form at a time to add, rename or deactivate a category. Opening a new category draft supplies one client UUID, retained across every create retry including name changes after an uncertain response. An identical retry recovers the stored category; an edited retry returns `ID_CONFLICT` with generic error copy and preserves the entered name. Its explicit Reload action closes the creation editor and refreshes the current list to show the stored category without duplication. Opening another new draft allocates a new UUID. Updates include the version. Blank and duplicate names are explained at the field; stale updates preserve the form and offer Reload. While a save is pending, inputs and editor/page controls are disabled and their handlers guard against switching drafts, so the response cannot close a newer edit. A successful save reloads the current page and announces completion. Pagination is component state, absent from the URL.

After a successful save or stale Reload, the outdated table is replaced by the loading state until the refreshed page arrives, so stale rows and paging controls cannot imply that the new category is missing. The table scrolls internally on narrow screens. `tests/catalogPages.test.ts` checks inline duplicate-name responses and a held post-save reload; Ticket 14 browser tests cover create, rename, deactivate and paging.

Category status chips use success green for Active and the neutral base chip for Inactive, retaining their readable labels.
