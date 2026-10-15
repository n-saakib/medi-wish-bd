# DiscountSecurityTest.java

Runs the production security chain over probe endpoints. Every staff discount route admits only an MFA-verified current Admin, rejects anonymous requests with 401, restricted staff with MFA_REQUIRED and other roles with ACCESS_DENIED. Denied oversized commands stay 403 while admitted Admin commands are bounded to INVALID_REQUEST. PUT and end POST preflight require no bearer or CSRF. The anonymous product price read ignores malformed or expired Authorization headers without authenticating.

The probe returns `{"accepted":true}` only after the route passes the security chain. Verification is recorded in the Ticket 16 evidence; preparation and discovery alone are not acceptance.
