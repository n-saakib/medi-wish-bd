# `Totp.java`

Source: [`src/main/java/bd/mediwish/auth/Totp.java`](../../../../../../../src/main/java/bd/mediwish/auth/Totp.java)

Package-private RFC 6238 TOTP (Ticket 06 D2): HMAC-SHA1, 6 digits, 30-second steps (`STEP_SECONDS`), accepting one step either side of now.

| Member | Behavior |
| --- | --- |
| `step(at)` | `floor(epochSecond / 30)`. |
| `code(seed, step)` | HMAC-SHA1 of the big-endian step, dynamic truncation, modulo 10^6, zero-padded to six digits with `Locale.ROOT`, so a host whose default locale uses another script still produces ASCII digits. |
| `matchStep(seed, code, now, lastUsedStep)` | Compares the code with the codes of steps `now-1`, `now` and `now+1` using `MessageDigest.isEqual`, always comparing all three. Returns the earliest matching step that is greater than `lastUsedStep`, or empty. Because the factor stores the accepted step, the same code, or any code from an earlier step, is never accepted again (replay protection). |

The seed is supplied decrypted by `StaffMfaService`, which zeroes it after use. Covered by `TotpTest` (the RFC 6238 Appendix B SHA1 vectors, the ±1 window, rejection of older steps and of another seed's code) and by `StaffMfaRegressionIT` over HTTP.
