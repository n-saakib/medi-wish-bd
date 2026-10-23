# AfterCommitMailer.java

Source: [AfterCommitMailer.java](../../../../../../../src/main/java/bd/mediwish/mail/AfterCommitMailer.java)

## Mail authorized by a committed transaction

sendAfterCommit requires active transaction synchronization and registers an afterCommit callback. The callback submits transient delivery to mailExecutor; rollback submits nothing. Transport failure or executor rejection logs only mail.failed and kind and invokes onFailure once, without retry. A failure of the separate audit callback cannot undo an already committed account change.
