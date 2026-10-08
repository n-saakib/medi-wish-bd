# `src/catalog/CategoryManager.tsx`

Source: [`src/catalog/CategoryManager.tsx`](../../../src/catalog/CategoryManager.tsx)

The verified staff Categories page. It lists 20 categories per page with product counts and status, and uses one inline form at a time to add, rename or deactivate a category. Opening a new category draft supplies one client UUID, retained across every create retry including name changes after an uncertain response. An identical retry recovers the stored category; an edited retry returns `ID_CONFLICT` with generic error copy and preserves the entered name. Its explicit Reload action closes the creation editor and refreshes the current list to show the stored category without duplication. Opening another new draft allocates a new UUID. Updates include the version. Blank and duplicate names are explained at the field; stale updates preserve the form and offer Reload. While a save is pending, inputs and editor/page controls are disabled and their handlers guard against switching drafts, so the response cannot close a newer edit. A successful save reloads the current page and announces completion. Pagination is component state, absent from the URL.

After a successful save or stale Reload, the outdated table is replaced by the loading state until the refreshed page arrives, so stale rows and paging controls cannot imply that the new category is missing. The table scrolls internally on narrow screens. `tests/catalogPages.test.ts` checks inline duplicate-name responses and a held post-save reload; Ticket 14 browser tests cover create, rename, deactivate and paging.

Category status chips use success green for Active and the neutral base chip for Inactive, retaining their readable labels.

Nonempty page ranges count the categories actually returned. If concurrent changes leave the current page empty while earlier pages still exist, it says No categories on this page and preserves Previous navigation instead of displaying an inverted range.

Accessibility correction (2026-10-08): Previous and Next keep the current rows and pager mounted while the next page loads, and [`usePagerFocus`](../shell/usePagerFocus.ts.md) keeps keyboard focus in the pager when the pressed button becomes disabled on the first or last page; the range text is a polite live region. A duplicate or blank name returns focus to the name field once the form is enabled again. The saved notice is a focused success alert, stale Reload moves focus to the page heading, and each Edit button is named `Edit {category}`.

Closing-pass fixes (2026-10-08): The add and edit form opens in a card above the table (an edit form inside its row scrolled sideways with the table at 375 px and hid Save). Add category and Edit move focus to the name field; Cancel, or saving with nothing changed, closes the editor and returns focus to the control that opened it. A stale refusal focuses its warning with Reload. The table is named `Categories`.
