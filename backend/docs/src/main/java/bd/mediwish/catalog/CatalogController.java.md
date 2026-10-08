# CatalogController

Package-private staff catalog HTTP adapter at `/api/staff`. SecurityConfiguration explicitly authorizes all eight routes; CategoryService and ProductService repeat mutation permission checks against the current principal. RequestCorrelationFilter supplies no-store responses and server-generated request IDs. ApiExceptionHandler keeps validation, missing records and conflicts bounded and externalized.

Category GET returns the accepted page projection with defaults includeInactive=true, page=0 and size=20. Product GET list accepts q, categoryId, status, reviewRequired, page and size. CatalogRequests rejects malformed known values before service invocation; unknown query parameters are ignored. ProductSummary omits detail/history/version fields. Product GET by canonical UUID returns the public Product projection with edit metadata and the latest history.

Category and Product POST accept client UUIDs and return 201 for new records or 200 for identical retries. Product creation always delegates inactive fields without money. The service owns normalized comparisons and conflicting payload outcomes, so a retry returns the current stored state.

Category PUT binds name, active and version. Product catalog PUT binds catalog fields, requireValidation, active and version, excluding id, immutable kind and all money. The stored kind determines required medicine fields inside ProductService. Pricing PUT has its own record and route: required exact decimal sellingPrice, optional/null MRP and version. The services own field semantics, stale/no-op behavior, activation rules, transactions and history.

CatalogControllerTest exercises the accepted MockMvc boundary with real advice, correlation and principal resolution. CatalogSecurityTest executes the production filter chain over the complete route/actor matrix, denied pricing body ordering and PUT preflight. PostgreSQL and browser checks provide durable behavior and integration evidence separately.
