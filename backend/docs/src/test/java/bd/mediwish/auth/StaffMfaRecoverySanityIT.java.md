# StaffMfaRecoverySanityIT.java

Ticket 09 T7 sanity and measurement checks over real HTTP and PostgreSQL. Tagged `integration` and `sanity`; uses AuthApi.Shared.

- **Smoke:** with the fixture (application, schema, enrolled Moderator) prepared first, the timed HTTP journey signs in with a password, gets 400 for one wrong code, uses a backup code, starts and verifies the new authenticator and reaches `/api/staff/me`. It must finish in under 10 s; the time is printed.
- **Measurement (recorded, no threshold, Q23 belongs to Ticket 59):** the median and maximum of five no-match `/recovery` calls against ten unused codes (the worst Argon2 matching case), clearing the throttle before each; and Hibernate prepared-statement counts for one successful `/recovery` call and one replacement verify call. Counts are per HTTP call, so authentication and filter queries are included; enrollment start is outside the verify boundary. Statistics are switched on only around the measured calls, as in `ConcurrentMfaIT`.

Output is numeric only; the logs are checked for secrets after each test.
