# DirectoryEmailTransportTest.java

Source: [DirectoryEmailTransportTest.java](../../../../../../../src/test/java/bd/mediwish/mail/DirectoryEmailTransportTest.java)

## Real filesystem mailbox contract

Writes two messages at the same fixed time and verifies unique published JSON names, exact property keys, complete values and no remaining temporary files. Boolean comparisons keep mailbox contents out of failure diagnostics. Uses a run-owned JUnit temporary directory and no external provider.
