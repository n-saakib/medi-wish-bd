# AuthProperties

Bound `app.auth` configuration for access/refresh lifetimes, JWT issuer and audience, Base64 HMAC secret and dummy password verifier. Lifetimes default to 15 minutes and 30 days; the secret and dummy verifier have no usable source fallback and are supplied by the runtime environment.
