# SessionServiceTest

Checks generation-zero creation with 32 random bytes, one rotation that consumes the old generation and creates the next generation, replay revocation of the entire family, revocation of every active session family returned for one User, and rejection when a valid active session belongs to a different User than the token identity. The multi-family unit case verifies that each family is mutated and persisted with the bounded reason; real PostgreSQL locking remains an integration obligation for T5/T6.
