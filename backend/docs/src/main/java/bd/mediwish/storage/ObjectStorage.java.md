# ObjectStorage.java

Minimal provider boundary for create-only put, streamed optional get and idempotent delete. Namespace selection belongs to configuration, not callers. Put distinguishes newly created from identical existing objects to support safe rollback compensation.
