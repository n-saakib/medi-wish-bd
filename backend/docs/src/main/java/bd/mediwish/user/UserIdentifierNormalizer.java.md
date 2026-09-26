# `UserIdentifierNormalizer.java`

Source: [`src/main/java/bd/mediwish/user/UserIdentifierNormalizer.java`](../../../../../../../src/main/java/bd/mediwish/user/UserIdentifierNormalizer.java)

The one identifier-normalization policy shared by registration (`UserService`) and password sign-in (`AuthenticationService`).

| Member | Behavior |
| --- | --- |
| `username(value)` | Trims and lowercases with `Locale.ROOT`; `null` becomes an empty string. |
| `mobile(value)` | Trims only; `null` becomes an empty string. E.164 conversion and OTP verification remain Ticket 61 work. |
| `email(value)` | `null` or blank becomes `null`; otherwise trims and lowercases with `Locale.ROOT`. |
| `normalize(rawIdentifier)` | Applies all three to one sign-in identifier and returns `NormalizedIdentifier(username, mobile, email)`. |

Keeping the seam in `bd.mediwish.user` stops the User feature from depending on the auth package for normalization. Covered by `UserIdentifierNormalizerTest` and `UserServiceTest`.
