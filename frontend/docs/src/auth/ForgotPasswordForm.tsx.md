# `src/auth/ForgotPasswordForm.tsx`

Guest-only email request and code/new-password steps share a page. An accepted request always displays the same focused status, and resending renews it. Client validation links errors and focuses the first invalid field. A ref serializes submissions and resend, and a request marker drops answers after unmount. Confirmation preserves password whitespace; successful reset clears secrets, sets the passwordReset notice and replaces the route with /sign-in without creating a session. Invalid codes clear/refocus Code and retain the password. pagehide clears code/password. Email and secrets stay only in React state. The design uses email only, one labeled Code input, a resend button and plain support text.

An accepted send response pins the code step to the submitted email even when the editable email draft changed while the request was open. A held HTTP request test protects the subsequent confirmation address.
