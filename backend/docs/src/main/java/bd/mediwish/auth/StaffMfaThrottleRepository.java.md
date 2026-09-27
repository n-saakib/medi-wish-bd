# `StaffMfaThrottleRepository.java`

Source: [`src/main/java/bd/mediwish/auth/StaffMfaThrottleRepository.java`](../../../../../../../src/main/java/bd/mediwish/auth/StaffMfaThrottleRepository.java)

Public Spring Data repository for `StaffMfaThrottle`, keyed by User ID, with no custom queries. Callers read and change a row only while holding that User's row lock, so each counter has one writer at a time. Covered through `StaffMfaServiceTest` and the staff MFA integration tests.
