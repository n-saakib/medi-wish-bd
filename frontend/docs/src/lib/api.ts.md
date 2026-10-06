# `src/lib/api.ts`

Source: [source](<../../../src/lib/api.ts>).

## Purpose

Shared API boundary with injected fetch/base URL, a 10 s timeout, no-store/error-on-redirect requests and a 16 KiB streaming JSON reader. `ApiError` retains only code/status. `errorMessageKey` maps known authentication/MFA and administration codes to externalized keys; unknown codes use genericError. Exports also include endpoint, isRecord, boundedText, readJsonResponse, boundedError, invalidResponse, requestFailure and apiRequest. Administration mappings are verified in `tests/apiErrors.test.ts`; existing clients protect transport/response bounds.
