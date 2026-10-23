# `tests/EmailVerificationDialog.test.tsx`

Exercises the rendered native modal at its public callback seam: local format validation, normalized code, bounded rejection/refocus, resend status with focus moved from **Send a new code** back to **Code**, cancel cleanup/focus return and queued close after reopening. jsdom showModal/close stubs reproduce modal open state and initial input focus; real browser acceptance remains in the Ticket 05 browser suite.
