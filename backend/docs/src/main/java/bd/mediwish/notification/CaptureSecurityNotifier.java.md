# `CaptureSecurityNotifier.java`

Local/test adapter storing the latest 50 notices in memory without logs. `notices()` returns an immutable snapshot; `clear()` removes notices and resets failure control. Synchronized queue/control access supports concurrent replacements. `failNext(THROW)` throws once; `failNext(HANG)` waits outside the monitor until interruption and returns `FAILED`. Failed sends are not captured, and the next send resumes normal operation.
