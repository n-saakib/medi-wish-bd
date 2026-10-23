# UserServiceTest

Unit tests cover normalized shared-User registration, Customer-role assignment, optional and blank email, password-verifier storage, whitespace-preserving passwords, duplicate checks and conversion of PostgreSQL SQL state `23505` to the bounded duplicate outcome. Identifier boundaries now follow accepted P12: username lengths 3 and 20 with a letter, exactly 11 ASCII mobile digits, and the optional 254-character dot-atom email subset with local and domain label limits. Invalid formats are rejected before persistence or password hashing. `IdentifierFormatsTest` covers the shared grammar in more detail.

## Ticket 05 integration

Shared helper boundary cases are covered by PasswordPolicyTest; existing registration cases continue to protect unchanged validation and exact encoder input.
