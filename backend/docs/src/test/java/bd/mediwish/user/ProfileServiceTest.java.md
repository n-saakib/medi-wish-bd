# `ProfileServiceTest.java`

Source: [`ProfileServiceTest.java`](../../../../../../../src/test/java/bd/mediwish/user/ProfileServiceTest.java)

Tests owner-only profile projection, validated updates, normalized no-op behavior, stale version rejection, duplicate email handling and the Dhaka date boundary. A closing-account test refuses invalid, identical and stale requests before field inspection, pending lookup or uniqueness checks. A missing-caller test refuses reads and writes before pending data is accessed. Database rollback and persistence guarantees are proven separately by the integration tests.