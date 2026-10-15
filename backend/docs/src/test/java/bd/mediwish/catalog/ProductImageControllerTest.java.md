# ProductImageControllerTest.java

Standalone MVC tests map upload/replay, list, alt edit, reorder and remove to the service using a synthetic verified Admin. Nonmultipart upload returns bounded 415 INVALID_REQUEST without a service call. Production filter-chain authorization is covered separately by CatalogSecurityTest.

Verified 2026-10-12 on working changes over 7555e2d: focused Maven unit invocation passed 60 tests with no failures or skips, including ProductImageServiceTest. Evidence: .scratch/ticket15-implementation-20261012/t4-units.log. Full integration/browser acceptance remains separate.

Upload MVC fixtures supply id as a real plain MockPart so successful created/replay mappings exercise the body-provenance contract.
