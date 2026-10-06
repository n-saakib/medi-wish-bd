# `MobileChangeServiceTest.java`

Source: [`MobileChangeServiceTest.java`](../../../../../../../src/test/java/bd/mediwish/user/MobileChangeServiceTest.java)

Tests staging and replacement under the User lock, idempotent cancellation, strict pending UUID activation, duplicate-number handling and rollback-sensitive database flush behavior. Ordered repository assertions prove bulk deletion precedes each pending-row insert. Closing and missing-caller cases refuse stage, cancel and activation before pending data is accessed or mutated. The activation seam is internal until Ticket 61 supplies OTP verification; real database rollback is covered by integration tests.