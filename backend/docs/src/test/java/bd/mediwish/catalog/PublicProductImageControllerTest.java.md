# PublicProductImageControllerTest.java

MVC tests observe public cache/security headers, stored bytes and exactly one Cache-Control value. Instrumented streams verify closure on GET, bodyless HEAD and write failure. Malformed filenames never reach the service, and unknown objects preserve no-store.

Verified 2026-10-12 on working changes over 7555e2d: focused Maven unit invocation passed 60 tests with no failures or skips, including ProductImageServiceTest. Evidence: .scratch/ticket15-implementation-20261012/t4-units.log. Full integration/browser acceptance remains separate.
