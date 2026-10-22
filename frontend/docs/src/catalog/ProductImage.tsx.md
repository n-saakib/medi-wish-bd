# src/catalog/ProductImage.tsx

Renders validated public image metadata through next/image with intrinsic dimensions, accessible alt text and responsive sizes. Only the accepted public API path reaches the optimizer. Missing/unsafe URLs and optimizer errors render a labelled image placeholder. The failed-source marker does not suppress a fresh replacement URL.

Ticket 17 also accepts null public image metadata and renders the same labelled placeholder used for unsafe or failed image sources. Public and staff image consumers share this component without widening the image URL allowlist.
