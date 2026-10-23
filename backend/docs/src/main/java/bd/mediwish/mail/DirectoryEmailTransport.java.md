# DirectoryEmailTransport.java

Source: [DirectoryEmailTransport.java](../../../../../../../src/main/java/bd/mediwish/mail/DirectoryEmailTransport.java)

## Atomic local/test mailbox publication

send serializes exactly to, subject, body and kind to a temporary file, then atomically renames it to an epoch-millisecond/UUID JSON filename. Readers see complete published JSON, including leading-zero codes. No delivery retry is retained. I/O failures become bounded EmailDeliveryException; temporary files are removed when possible and the run-owned directory is removed by the harness. Filenames order timestamps, not globally ordered commits or same-millisecond UUIDs.
