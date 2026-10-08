# `tests/catalogPages.test.ts`

Source: [`tests/catalogPages.test.ts`](../../tests/catalogPages.test.ts)

Mounted jsdom coverage for staff catalog UI with synthetic session and API responses. It checks new-product loading failure/retry, failed-create draft preservation, field boundaries and required errors, Equipment create body, an existing inactive category, Moderator read-only pricing, no-op saves, stale update handling, a pending pricing submission, positive whole and mixed-scale decimal pricing, zero-money rejection, clearing a selling-price error after correcting only MRP, clearing the activation price error after pricing succeeds without losing the catalog draft, price-version reuse, the visible Dhaka-local history timestamp with its original API instant, product list formatting/paging/empty/error states, and category duplicate/rename/stale/paging/current-page refresh and held-save editor guards. Mounted copy regressions verify unset price/MRP and exact status choices, plus details history and both review-flag directions. These protect the fixed acceptance strings rather than changing the product policy. Held-response regressions check that both forms lock during catalog and pricing saves, then unlock with drafts preserved after either success or failure; a failed create also restores its kind and draft controls. The real browser suite covers navigation, access, keyboard and layout behavior.

The post-save category reload is held pending in a mounted regression: the success notice remains while outdated rows/paging are replaced by loading, then the renamed row appears after the held response settles.

Product-create response-loss regressions use a stateful API boundary: the first POST stores the Product before rejecting transport, an identical retry returns it, and an edited retry must retain the UUID, refuse duplication and preserve the entered draft until the operator selects Reload.

Category-create response-loss regressions similarly commit a synthetic category before transport fails. Identical retry recovers it and refreshes the list; edited retry retains the UUID and entered name, shows bounded generic error copy, and offers Reload to close the editor and refresh the stored category without creating another one.

Mounted design regressions verify status text and chip tones for all three Product list and editor states, Review information tone and both Category states. These assertions preserve readable text alongside color.

On 2026-10-07 the focused file passed 43/43 tests after the new list and editor/category tone regressions demonstrated failures against the old chip-brand rendering. The complete frontend verify gate passed 354 units in 17 files, lint, types and production build; browser checks remain separate.

On 2026-10-08, mounted shared-error copy regressions protect the exact plan strings. Pager regressions simulate the total shrinking while navigating: both lists show truthful empty-page copy, preserve Previous, disable Next, and display the actual row range after going back. A numeric-column regression checks the MRP and Price headings and cells use the design alignment style. Pager and numeric regressions failed before their fixes; all 49 catalog component tests then passed.

The complete frontend verification also passed on 2026-10-08: lint, TypeScript, 360 unit tests in 17 files, and the production build. Browser and live integration evidence are recorded separately.

Accessibility regressions (2026-10-08): both lists keep the page and keyboard focus in the pager while Next loads the last page; a server price-required refusal focuses Active once the form re-enables; a created Product shows one focused confirmation on its own page and not on a later visit; category duplicate names focus the name field, the saved notice takes focus, and stale Reload focuses the heading on both editors; Edit controls carry `Edit {name}` labels. These failed against the previous components (11 failures) and the focused file then passed 81/81.

UX regressions (2026-10-08): the history time reads exactly `27 Sep 2026, 5:00 pm`; an MRP removal names it; malformed and edit pages link back to Products and not-found is the heading; zero, too-large, malformed and leading-zero amounts get the range or format message without a request; spaces around amounts are trimmed before sending. All seven failed before the change.
