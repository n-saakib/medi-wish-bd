# `CaptureSecurityNotifierTest.java`

Synthetic capture-adapter tests protect the 50-notice bound, retained ordering, snapshot isolation, clear behavior, silent output and payload redaction. THROW is consumed once. HANG blocks until interrupted, does not retain the failed notice, and permits the following send. Uses latches and timed waits instead of sleeps; virtual-thread cleanup runs in a finally block.
