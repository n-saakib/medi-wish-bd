# `AdminUserControllerTest.java`

Source: [AdminUserControllerTest.java](../../../../../../../src/test/java/bd/mediwish/admin/AdminUserControllerTest.java)

Focused strict-input tests: unknown properties and old staffRoles arrays, unknown/lowercase roles, null/missing values, numeric strings, fractions, long overflow and malformed/short UUIDs never call the service. Search defaults and trim/lowercase normalization are pinned. Security and persistence are verified at separate public boundaries.

A valid command delegates the exact single role and a Long.MAX_VALUE version without numeric coercion; the service decides whether that version is stale.
