# `src/main/java/bd/mediwish/mail/MailConfiguration.java`

Creates exactly one EmailTransport for both web and offline operator startup. Disabled is the hosted default and works in every profile. Memory and directory capture require at least one active profile and all active profiles must be local or test; mixing a hosted profile is refused. Directory capture requires an existing writable directory, with absent, blank, invalid or unavailable paths refused. Startup exceptions contain only bounded property rules and discard path parser causes.

The existing application ObjectMapper and UTC Clock are passed to DirectoryEmailTransport. No transport selector values or paths enter diagnostics. mailExecutor has core/max one worker, queue capacity 200, mail- thread names and graceful completion for up to ten seconds during shutdown; Spring owns its initialization and destruction. This keeps transient after-commit sends ordered and bounded without a persistent outbox or retry layer.

MailConfigurationTest exercises real Spring binding/startup, adapter/profile combinations, directory availability, private-value omission, disabled logging and the public executor settings.
