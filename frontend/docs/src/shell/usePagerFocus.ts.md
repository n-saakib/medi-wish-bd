# `src/shell/usePagerFocus.ts`

Source: [`src/shell/usePagerFocus.ts`](../../../src/shell/usePagerFocus.ts)

## Purpose

Client hook that keeps keyboard focus in a list's pager across a page turn. Lists keep their rows and pager mounted while the next page loads, so focus normally stays on the pressed button. When the loaded page disables that button (the first or last page), focus would fall to the document body; the hook moves it to the pager's enabled button instead.

## Export

### `usePagerFocus(loaded)`

Returns `{ pager, markTurn }`. Attach `pager` to the pager container and call `markTurn()` before requesting another page. After the next `loaded` result arrives, the hook acts once: if focus is on the body or a disabled button, it focuses the first enabled pager button; otherwise it leaves focus where the user put it.

## Use cases and boundaries

Used by [`ProductList`](../catalog/ProductList.tsx.md), [`CategoryManager`](../catalog/CategoryManager.tsx.md) and [`UserList`](../admin/UserList.tsx.md). It changes only focus; paging state and requests stay in each list.

## Verification

Pager focus tests in [`tests/catalogPages.test.ts`](../../tests/catalogPages.test.ts.md) and [`tests/UserList.test.ts`](../../tests/UserList.test.ts.md); browser product paging in [`catalogUi.spec.ts`](../../tests/browser/catalogUi.spec.ts.md).
