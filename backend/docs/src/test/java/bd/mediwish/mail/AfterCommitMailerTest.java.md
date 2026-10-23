# AfterCommitMailerTest.java

Source: [AfterCommitMailerTest.java](../../../../../../../src/test/java/bd/mediwish/mail/AfterCommitMailerTest.java)

## Transaction/executor behavior and safe diagnostics

Protects no send before commit, no queue on rollback, executor dispatch rather than synchronous transport I/O, one failure outcome without retry, rejected tasks, bounded callback failure, required transaction synchronization and kind-only message diagnostics. Controlled transport/executor boundaries avoid a real provider.
