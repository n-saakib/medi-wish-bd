# `src/app/(staff)/staff/products/[productId]/layout.tsx`

Source: [`src/app/(staff)/staff/products/[productId]/layout.tsx`](../../../../../../../src/app/(staff)/staff/products/[productId]/layout.tsx)

A pass-through server layout for the Product edit route. Its `generateMetadata` titles the page with `catalog.editProduct` (`Edit product · Medi Wish`), because the route's [`page.tsx`](page.tsx.md) is a client component and cannot export metadata. It renders its children unchanged and reads no Product data. Browser check E2E-14-06 asserts the title.
