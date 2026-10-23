# `NotificationConfiguration.java`

Registers notification properties and selects the notifier bean. `disabled` works under any profile. `capture` requires at least one explicitly active profile, and every profile must be `local` or `test`; a mixed or production profile fails startup with `CAPTURE_PROFILE_RULE`. No SMS integration or additional dependency is introduced.
