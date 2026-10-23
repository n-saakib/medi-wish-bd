# EmailVerificationController.java

Source: [EmailVerificationController.java](../../../../../../../src/main/java/bd/mediwish/auth/EmailVerificationController.java)

Authenticated owner-bound POST request and confirm adapters. Request takes no body and ignores any supplied body under the shared filter limit. Confirm accepts exactly one six-ASCII-digit code and returns the service ProfileView without changing its version. Owner identity comes from the bearer principal.
