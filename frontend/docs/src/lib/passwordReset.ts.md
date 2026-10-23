# `src/lib/passwordReset.ts`

Public reset requests post only the trimmed email; confirmation posts email, six-digit code and the password verbatim. Only 202 for request and 204 for confirm succeed. Calls use the shared uncached, ten-second HTTP boundary without session headers. API text is discarded; failures retain only bounded code and status. Exports requestPasswordReset and confirmPasswordReset.
