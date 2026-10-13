# LocalObjectStorageTest.java

Exercises create-only storage, identical replay, conflicting bytes, idempotent deletion and an open NIO reader surviving deletion. Uses a test-owned temporary directory.


Rejects traversal, absolute/backslash/uppercase keys for every operation; checks temporary-file cleanup on replay/conflict and bounded failure when the configured root is a regular file.
