# `tests/productImages.integration.test.ts`

Real-backend, fixture-free Ticket 15 probes for anonymous public-image GET/HEAD and protected multipart upload. They assert exact bounded errors, request correlation, `no-store`, the Bearer challenge and HEAD's empty body. Upload authorization must precede record/input validation.

Run with `MEDI_WISH_API_URL` set to the isolated test backend: `npx vitest run --project integration tests/productImages.integration.test.ts`. No mocks, conditional skips or development database fixtures are used. This is executable acceptance coverage written before the image feature; passing execution is recorded separately in the Ticket 15 E2E evidence.
