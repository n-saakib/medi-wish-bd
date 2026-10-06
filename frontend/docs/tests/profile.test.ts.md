# `tests/profile.test.ts`

Source: [`tests/profile.test.ts`](../../tests/profile.test.ts)

Checks the four `/me` profile client calls, their methods, request bodies and expected success statuses. It also checks that `projectProfile` rejects invalid versions, account states and impossible dates while accepting leap day, and that failed responses retain only bounded code and status instead of server text.
