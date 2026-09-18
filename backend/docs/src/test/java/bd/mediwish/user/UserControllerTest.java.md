# `UserControllerTest.java`

Source: [`src/test/java/bd/mediwish/user/UserControllerTest.java`](../../../../../../src/test/java/bd/mediwish/user/UserControllerTest.java)

## Purpose

Tests the public User registration HTTP seam with a standalone MVC harness and the request-correlation filter. It verifies the success projection excludes password fields and that malformed and duplicate requests use bounded, externalized error bodies.

## Verification

The suite covers the 201 registration response, 400 malformed JSON response, 409 duplicate response, request-ID propagation and absence of password/verifier fields in the public success projection.
