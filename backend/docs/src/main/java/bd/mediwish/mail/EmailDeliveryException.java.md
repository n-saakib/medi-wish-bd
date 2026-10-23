# EmailDeliveryException.java

Source: [EmailDeliveryException.java](../../../../../../../src/main/java/bd/mediwish/mail/EmailDeliveryException.java)

## Bounded delivery failure

An unchecked failure with no provider text, mailbox path, cause or payload. Transport adapters discard unsafe I/O diagnostics before crossing this boundary; AfterCommitMailer records only a safe outcome and kind.
