# PublicCatalogController.java

`GET /api/categories`, `GET /api/categories/{id}/products` and `GET /api/products/{id}` delegate to the read-only public catalog service and serialize its public projection records. The category-page API uses zero-based `page` indexes and a fixed size of 24. Missing `page` means 0; only `0` or a nonzero decimal without leading zeros and with at most nine digits is accepted. Repeated, malformed and past-last pages share the bounded `404 NOT_FOUND` response.

The adapter ignores unknown query parameters, accepts the same case-insensitive UUID form as the inherited price API, and maps malformed identifiers to the same 404 before calling the service. The controller neither authenticates nor reads a bearer header; its three GET routes are explicitly permitted in `SecurityConfiguration`. The service owns active/price filtering and data consistency. There is no worker, retry or external adapter.
