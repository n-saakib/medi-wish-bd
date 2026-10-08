# `src/catalog/ProductList.tsx`

Source: [`src/catalog/ProductList.tsx`](../../../src/catalog/ProductList.tsx)

The verified staff Products page. It loads a bounded product page and all active category options, applies search/category/status/review filters only when the user submits Apply, and resets paging on filter changes. Rows show names, generic/strength/manufacturer context, category, Sale Unit, MRP, price, Review flag, status and Edit. BDT strings are formatted without numeric conversion. Empty catalog, no matches, loading and failed request states are explicit; stale async results cannot overwrite a later request.

The table scrolls within its card at narrow widths. Buttons and links use the shared 44 px styles. `tests/catalogPages.test.ts` covers a real mounted page with synthetic API responses.

Unset amounts show the accepted “Not set” copy. Status choices distinguish “Any status” and “Needs price (not purchasable)” from the shorter row status chips; all copy comes from messages.

Status labels use the static design tones: Active uses the success green chip, Needs price uses warning amber, Inactive uses the neutral base chip, and Review uses the information blue chip. Text remains present in every chip.

Money headers and cells use the design numeric style for right alignment and tabular figures. Nonempty page ranges count the rows actually returned. An empty page with a positive total says No products on this page instead of displaying an inverted range; Previous remains available to return to existing results.
