# `src/app/(store)/categories/[categoryId]/page.tsx`

Source: [`src/app/(store)/categories/[categoryId]/page.tsx`](<../../../../../../src/app/(store)/categories/[categoryId]/page.tsx>)

## Purpose

Request-rendered public Product listing for one category, with a stable visible page number over the API's zero-based page parameter.

## Exports and behavior

`CategoryPageProps` models Next's asynchronous route and query inputs. `generateMetadata()` and `CategoryPage()` share `resolvePage()` and the request-cached read. It rejects malformed lower-case UUIDs before redirecting `?page=1`, rejects malformed or repeated page values, requests 24 Products per API page, and turns a correlated public not-found into the shared 404 view. The page renders a category breadcrumb, name/count, Product cards or the empty state, and previous/next links. Metadata uses a canonical URL for the current visible page; API failures other than not-found reach the generic error boundary.

## Verification

Ticket 17 browser tests cover server HTML, page-two canonical/link behavior, out-of-range and malformed URLs, empty categories and outage handling. They are authored but remain unrun while the baseline browser suite uses `.next`.
