# ProductImageTestApi.java

Real HTTP companion to CatalogTestApi and its guarded PostgreSQL schema. Builds multipart bodies, checks bounded response correlation/cache headers, fetches public GET/HEAD as bytes, generates synthetic PNGs and resolves only the run-owned storage namespace. Closes the client before application/database cleanup.
`start(int)` allows bounded lock-observed races to use the established longer JDBC timeout. `uploadRequest` exposes the same multipart request before sending so concurrency tests can cancel a real async request after PostgreSQL observes it queued; normal upload retains its response-header checks.
