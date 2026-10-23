# `src/test/java/bd/mediwish/mail/MailConfigurationTest.java`

Tests the actual Spring configuration startup seam with ApplicationContextRunner, the pinned Jackson JsonMapper and a UTC Clock. Default binding produces disabled delivery. A profile matrix accepts capture adapters only for local/test combinations, refuses no-profile or hosted/mixed environments, and permits disabled delivery everywhere.

Controlled temporary directories prove valid startup; missing, blank, nonexistent, regular-file and invalid paths are refused with only a bounded property message. No platform-specific ACL mutation is needed; configuration also checks Files.isWritable at startup. Captured logs prove unknown transport values and private path markers are omitted, and disabled sends log only the safe EmailKind. The configured executor's public settings prove one worker, a 200-task queue and mail- thread names. Context close releases its executor.
