# `tests/profile.integration.test.ts`

The live API check requires MEDI_WISH_API_URL. It sends an anonymous GET to the fixed self-profile resource and asserts 401, no-store, exactly the bounded error keys and matching response/header request correlation. This protects ownership at the real HTTP boundary; it does not inject a fake adapter.