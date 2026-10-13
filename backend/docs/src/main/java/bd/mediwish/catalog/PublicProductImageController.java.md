# PublicProductImageController.java

Servlet-only public GET and HEAD stream stored image bytes by strict lowercase UUID and png/jpg extension. Success replaces the default no-store with exactly one public, max-age=60 header, supplies length and type plus nosniff, sandbox CSP and inline disposition, and always closes the object stream. HEAD never reads content. Malformed identities bypass the service; missing/removed objects are bounded NOT_FOUND with no-store. The security chain rejects all unsafe public methods even with valid CSRF.
