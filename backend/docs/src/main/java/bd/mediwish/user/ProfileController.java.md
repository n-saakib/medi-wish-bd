# ProfileController.java

Source: [ProfileController.java](../../../../../../../src/main/java/bd/mediwish/user/ProfileController.java)

## Purpose and contract

The signed-in caller alone reads and updates their full profile through GET/PUT /api/user/me/profile, stages a mobile with POST /api/user/me/mobile-change (202), and cancels with DELETE (204 empty, idempotent). There is no activation route or user ID in the URL.

## Input boundary

Jackson reads a JSON tree; the controller checks the exact property set and JSON token types before constructing ProfileEdit. All four edit keys are required; optional text/date values may be null. Version is a nonnegative JSON integer that fits a Java long, never a fractional number, boolean or string. Dates have exactly yyyy-MM-dd syntax and use strict LocalDate.parse. Mobile is one required string. This keeps strictness local without changing existing authentication request coercion.

Field normalization, account-state checks, stale versions and uniqueness run in transactional services after the caller's row lock. ProfileControllerTest exercises this MVC boundary and proves no operation invokes activation.
