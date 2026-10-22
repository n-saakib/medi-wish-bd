# `src/storefront/ProductCard.tsx`

Source: [`src/storefront/ProductCard.tsx`](../../../src/storefront/ProductCard.tsx)

Public Product card linking image and name to the Product details route. It renders the safe optional image or labelled placeholder, one discount badge, optional generic name, Sale Unit and price. It deliberately has no cart controls, stock claims or staff fields.

The image link is hidden from assistive technology and skipped by Tab (`aria-hidden`, `tabIndex={-1}`). The name link is the single keyboard and screen-reader stop for a card, so each Product has one accessible link with its name. Mouse users can still click the image.

Verification: [`StorefrontComponents.test.tsx`](../../tests/StorefrontComponents.test.tsx.md) covers the ID-bound destination, labels, price, image fallback and absent purchase controls. The browser specs in [`storefrontA11y.spec.ts`](../../tests/browser/storefrontA11y.spec.ts.md) check the Tab order and link names on real cards.
