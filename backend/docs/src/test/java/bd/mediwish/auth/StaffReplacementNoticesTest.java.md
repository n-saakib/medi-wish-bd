# `StaffReplacementNoticesTest.java`

Synthetic coordinator coverage checks both verified contacts, email only, mobile only, exclusion of unverified contacts, no verified contact, SENT-over-FAILED precedence, partial failures, all failures and disabled mail without invoking its no-op transport. Captured email has the replacement kind and private payload. Real resource-bundle mobile/email text retains its apostrophe and Dhaka timestamp.

Lookup, message, adapter and audit failures cannot escape. Latch-controlled hanging adapters demonstrate that both channels share one deadline and both are cancelled; successful mobile delivery still wins over email timeout. Interrupted waits clear the flag for `recordInNewTransaction` and restore it afterwards. Mockito isolates external delivery and database effects; `StaffReplacementNoticesIT` covers actual replacement and committed audit composition.
