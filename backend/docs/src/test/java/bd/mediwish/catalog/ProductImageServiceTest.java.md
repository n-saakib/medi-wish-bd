# ProductImageServiceTest.java

Verifies replay without writes, cross-Product and retired identity rejection, eight-image limit, mandatory stale alt checks, including unchanged text, compensation ownership/reference safeguards, and synchronous after-commit deletion with success preserved when storage deletion fails. Uses a lightweight transaction manager for synchronization behavior; database constraints need real PostgreSQL integration coverage.



Additional cases verify authorization before decode, invalid input/storage failures, under-lock replay/retirement, no deletion after remove rollback, original error preserved if compensation fails, replacement positioning/retirement/deletion, and decoder saturation with permit release after failed inspection.

Captures after-commit/compensation warnings to assert exactly the exception class with no attached cause or diagnostic text. Also verifies unverified Admin refusal and bounded create-only storage conflict translation.
