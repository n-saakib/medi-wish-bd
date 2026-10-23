# `tests/ForgotPasswordForm.test.tsx`

Tests the rendered form against fake fetch at the HTTP seam, using real session/translation providers. Covers email/code/password validation, request serialization, exact confirmation values, generic request results, repeated code failures and focus, resend, bounded errors, private browser state, pagehide cleanup, late completion drop and signed-in redirect.

An accepted send response pins the code step to the submitted email even when the editable email draft changed while the request was open. A held HTTP request test protects the subsequent confirmation address.
